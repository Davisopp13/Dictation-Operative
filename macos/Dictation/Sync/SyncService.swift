import AppKit
import CryptoKit
import Foundation
import Observation
import Security

@MainActor @Observable
final class SyncService {
  struct Configuration: Codable {
    var device = SyncDevice(id: UUID().uuidString, name: Host.current().localizedName ?? "My Mac")
    var pairs: [SyncPairRecord] = []
    var selected = ""
    var paused = false
    var automatic = false
    var sendDictation = false
  }
  var config = Configuration()
  private(set) var status = "Pair a device to get started."
  private(set) var error: String?
  private(set) var busy = false
  private(set) var progress = 0.0
  private(set) var state: SyncPairState?
  var invitation = ""
  private(set) var pairing: SyncPairing?
  private(set) var pairingState: SyncPairingState?
  private(set) var pairingVerification = ""
  private(set) var pairingExpired = false
  private var connectedRoom: String?
  private var latestSeen: String?
  private var lastSent: String?
  private var fingerprint: String?
  private var clipboardCount = NSPasteboard.general.changeCount
  private var localCopyAt = Date()
  private var loop: Task<Void, Never>?
  private let clipboard = MacClipboardAdapter()
  var pair: SyncPairRecord? { config.pairs.first { $0.id == config.selected } }
  var available: Bool { pair != nil && state?.approved == true && !config.paused && !busy }
  init() {
    do {
      if let data = try SyncKeychain.load() {
        config = try JSONDecoder().decode(Configuration.self, from: data)
      }
    } catch {
      self.error = "Could not load trusted devices from Keychain. Sync remains disabled."
      config.paused = true
    }
  }
  func persist(reset: Bool = false) {
    do {
      try SyncKeychain.save(JSONEncoder().encode(config))
      if reset {
        connectedRoom = nil
        state = nil
        latestSeen = nil
        clipboardCount = clipboard.changeCount
        fingerprint = nil
        invitation = ""
      }
    } catch {
      self.error = "Could not save Sync settings to Keychain."
      config.paused = true
    }
  }
  func start() {
    guard loop == nil else { return }
    loop = Task { [weak self] in
      while !Task.isCancelled {
        await self?.tick()
        try? await Task.sleep(for: .milliseconds(1000))
      }
    }
  }
  func perform(_ action: @escaping @MainActor () async throws -> Void) {
    guard !busy else { return }
    busy = true
    error = nil
    progress = 0
    Task {
      defer { busy = false }
      do { try await action() } catch {
        self.error =
          (error as? SyncFailure)?.message ?? (error as? SyncPairingError)?.message
          ?? "Sync could not finish. Check your connection and try again."
      }
    }
  }
  func createInvitation() {
    perform { [self] in
      guard !config.device.name.trimmingCharacters(in: .whitespaces).isEmpty else {
        throw SyncFailure("Name this device first.")
      }
      try await clearPairing()
      let pending = try await SyncPairing.create(device: config.device)
      pairing = pending
      pairingState = pending.state
      pairingExpired = false
      status = "Scan the QR code or enter the code on your other device."
    }
  }
  private func clearPairing() async throws {
    if let pairing {
      do { try await pairing.request("cancel") }
      catch let e as SyncPairingError where e.status == 410 { /* Already expired. */ }
    }
    pairing = nil; pairingState = nil; pairingVerification = ""; pairingExpired = false
  }
  func cancelPairing() {
    perform { [self] in try await clearPairing(); status = "Pairing cancelled." }
  }
  private func savePaired(_ record: SyncPairRecord) throws {
    var next = config
    next.pairs.removeAll { $0.id == record.id }
    next.pairs.append(record); next.selected = record.id; next.paused = false
    try SyncKeychain.save(JSONEncoder().encode(next))
    config = next
    persist(reset: true)
    pairing = nil; pairingState = nil; pairingVerification = ""; pairingExpired = false
    status = "Connected to \(record.peerName)."
  }
  func approvePairing() {
    guard let pairing else { return }
    perform { [self] in try savePaired(await pairing.approve()) }
  }
  private func pollPairing() async {
    guard let pending = pairing, !pairingExpired else { return }
    if Int64(Date().timeIntervalSince1970 * 1000) >= pending.state.expiresAt {
      pairingExpired = true; status = "Pairing code expired. Create a new code."; return
    }
    do {
      let value = try await pending.request("status")
      guard !busy, pairing === pending else { return }
      pairingState = value
      pairingVerification = value.guest == nil ? "" : try pending.verification()
      error = nil
      if value.approved && pending.role == "guest" {
        let record = try await pending.finish()
        guard !busy, pairing === pending else { return }
        try savePaired(record)
      } else {
        status = value.guest == nil ? "Waiting for your other device…" : "Compare the confirmation on both devices."
      }
    } catch {
      guard !busy, pairing === pending else { return }
      self.error = (error as? SyncFailure)?.message ?? (error as? SyncPairingError)?.message
        ?? "Pairing connection interrupted. Retrying…"
      if (error as? SyncPairingError)?.status == 410 { pairingExpired = true }
    }
  }
  func join(_ code: String) {
    perform { [self] in
      if !code.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("dosync1:") {
        try await clearPairing()
        let pending = try await SyncPairing.claim(code, device: config.device)
        pairing = pending; pairingState = pending.state; pairingExpired = false
        pairingVerification = try pending.verification()
        status = "Approve this Mac on your other device."
        return
      }
      let p = try SyncPairRecord.parse(code, device: config.device)
      guard !config.pairs.contains(where: { $0.id == p.id }) else {
        throw SyncFailure("This device already has that invitation.")
      }
      try await SyncTransport(pair: p).join()
      config.pairs.append(p)
      config.selected = p.id
      persist(reset: true)
      status = "Approve this Mac on the inviting device."
    }
  }
  func approve() {
    guard let p = pair, let guest = state?.guest else { return }
    perform { [self] in
      try await SyncTransport(pair: p).approve(guest.id)
      invitation = ""
      state = try await SyncTransport(pair: p).state()
      status = "Device paired."
    }
  }
  func remove() {
    guard let p = pair else { return }
    perform { [self] in
      try await SyncTransport(pair: p).revoke()
      config.pairs.removeAll { $0.id == p.id }
      config.selected = config.pairs.first?.id ?? ""
      persist(reset: true)
      status = "Trust revoked on both devices; queued content deleted."
    }
  }
  func rename() {
    perform { [self] in
      guard !config.device.name.trimmingCharacters(in: .whitespaces).isEmpty else {
        throw SyncFailure("Name this device first.")
      }
      for index in config.pairs.indices {
        try await SyncTransport(pair: config.pairs[index]).rename(config.device)
        config.pairs[index].device = config.device
      }
      persist()
      status = "Device name saved."
    }
  }
  func sendClipboard() { perform { [self] in try await send(clipboard.read()) } }
  func sendText(_ text: String) {
    perform { [self] in try await send(SyncPayload(mime: "text/plain", bytes: Data(text.utf8))) }
  }
  func completedDictation(_ text: String) {
    if config.sendDictation && !config.paused {
      if busy {
        status = "Sync is busy. Send the last dictation from the menu when ready."
      } else {
        sendText(text)
      }
    }
  }
  private func send(_ payload: SyncPayload) async throws {
    guard let p = pair, !config.paused else {
      throw SyncFailure("Select a device and resume Sync first.")
    }
    let e = try await SyncTransport(pair: p).send(payload) { value in
      await MainActor.run { self.progress = value }
    }
    lastSent = e.id
    fingerprint = payload.fingerprint
    status = "Sent. Waiting for receipt (expires in 2 minutes)."
  }
  func receiveLatest() {
    perform { [self] in
      guard let p = pair, !config.paused else {
        throw SyncFailure("Select a device and resume Sync first.")
      }
      let current = try await SyncTransport(pair: p).state()
      guard let e = current.latest else {
        throw SyncFailure("No pending transfer. Send from your other device first.")
      }
      try await receive(e, pair: p)
    }
  }
  private func receive(_ e: SyncEnvelope, pair p: SyncPairRecord) async throws {
    let count = clipboard.changeCount
    let payload = try await SyncTransport(pair: p).receive(e) { value in
      await MainActor.run { self.progress = value }
    }
    guard !config.paused, pair?.id == p.id else {
      throw SyncFailure("Sync paused or destination changed.")
    }
    try clipboard.write(payload, expectedCount: count)
    clipboardCount = clipboard.changeCount
    fingerprint = payload.fingerprint
    latestSeen = e.id
    // A failed acknowledgement never causes another clipboard write: the local ID is already recorded.
    try await SyncTransport(pair: p).ack(e.id)
    status = "Copied to this Mac. Paste into another app."
  }
  private func tick() async {
    if !busy, pairing != nil { await pollPairing(); return }
    guard !busy, let p = pair, !config.paused else {
      if config.paused {
        connectedRoom = nil
        status = "Sync paused."
      }
      return
    }
    do {
      let current = try await SyncTransport(pair: p).state()
      guard !busy, pair?.id == p.id, !config.paused else { return }
      let wasOnline = state?.peerOnline ?? false
      state = current
      error = nil
      if current.peerOnline && !wasOnline { status = "Connected · end-to-end encrypted" }
      if let index = config.pairs.firstIndex(where: { $0.id == p.id }),
        let name = p.role == "host" ? current.guest?.name : current.host.name,
        config.pairs[index].peerName != name
      {
        config.pairs[index].peerName = name
        persist()
      }
      if !current.approved {
        status =
          current.guest == nil ? "Waiting for your other device…" : "Waiting for pairing approval."
        return
      }
      if connectedRoom != p.id {
        connectedRoom = p.id
        latestSeen = current.latest?.id
        clipboardCount = clipboard.changeCount
        localCopyAt = Date()
        if config.automatic { fingerprint = try? clipboard.read().fingerprint }
        status =
          current.latest == nil
          ? "Connected · end-to-end encrypted" : "A transfer is waiting. Choose Receive latest."
        return
      }
      if let lastSent, current.ack?.id == lastSent {
        self.lastSent = nil
        status = "Received and copied on your paired device."
      }
      if !current.peerOnline && lastSent == nil {
        status = "Paired · other device is offline or asleep."
      }
      guard config.automatic else { return }
      if clipboard.changeCount != clipboardCount {
        clipboardCount = clipboard.changeCount
        localCopyAt = Date()
        if !clipboard.isAutomaticExcluded {
          let payload = try clipboard.read()
          if payload.fingerprint != fingerprint {
            busy = true
            defer { busy = false }
            try await send(payload)
            // A simultaneous remote copy remains available manually, never overwrites this local copy.
            latestSeen = current.latest?.id
            return
          }
        }
      }
      if let e = current.latest, e.id != latestSeen {
        latestSeen = e.id
        guard Date(timeIntervalSince1970: Double(e.createdAt) / 1000) >= localCopyAt else {
          status = "Remote copy kept pending because this Mac has a newer clipboard."
          return
        }
        busy = true
        defer { busy = false }
        try await receive(e, pair: p)
      }
    } catch {
      connectedRoom = nil
      state = nil
      status = "Sync disconnected. Pending content must be received manually after reconnecting."
      self.error =
        (error as? SyncFailure)?.message ?? (error as? SyncPairingError)?.message
        ?? "Check your connection. Sync will reconnect while running."
    }
  }
}
private enum SyncKeychain {
  static let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.davisopp.dictation.sync",
    kSecAttrAccount as String: "trusted-devices-v1",
  ]
  static func load() throws -> Data? {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw SyncFailure("Keychain unavailable.") }
    return result as? Data
  }
  static func save(_ data: Data) throws {
    let status = SecItemUpdate(
      query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var q = query
      q[kSecValueData as String] = data
      q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else {
        throw SyncFailure("Keychain save failed.")
      }
    } else if status != errSecSuccess {
      throw SyncFailure("Keychain save failed.")
    }
  }
}
