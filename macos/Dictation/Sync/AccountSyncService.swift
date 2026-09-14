import AppKit
import Foundation
import Observation

@MainActor @Observable final class AccountSyncService {
  struct Configuration: Codable {
    var account: SyncAccountRecord?
    var followSettings = false
    var applyKey = false
    var automaticClipboard = false
    var appliedRevision = 0
  }
  var config = Configuration()
  var paused = false
  var settings: SettingsStore?
  private(set) var state: SyncAccountState?
  private(set) var message = "Connect your account through a trusted device."
  private(set) var error: String?
  private(set) var busy = false
  private var loop: Task<Void, Never>?
  private var baseline = false
  private var lastClipboardID: String?
  private var clipboardCount = NSPasteboard.general.changeCount
  private var localCopyAt = Date()
  private var fingerprint: String?
  private let clipboard = MacClipboardAdapter()
  init() {
    if let raw = KeychainHelper.get("account-sync-v1") {
      do { config = try JSONDecoder().decode(Configuration.self, from: Data(raw.utf8)); try config.account?.validate() }
      catch { config = Configuration(); self.error = "Could not load account sync. Local dictation remains available." }
    }
  }
  func persist() throws {
    try KeychainHelper.setChecked(String(decoding: JSONEncoder().encode(config), as: UTF8.self), for: "account-sync-v1")
  }
  func saveOptions() {
    do { config.appliedRevision = 0; try persist(); baseline = false }
    catch { self.error = error.localizedDescription; config.followSettings = false; config.automaticClipboard = false }
  }
  func perform(_ action: @escaping @MainActor () async throws -> Void) {
    guard !busy else { return }; busy = true; error = nil
    Task { defer { busy = false }; do { try await action() } catch { self.error = (error as? SyncFailure)?.message ?? "Account sync failed. Please retry." } }
  }
  func start() {
    guard loop == nil else { return }
    loop = Task { [weak self] in
      while !Task.isCancelled { await self?.tick(); try? await Task.sleep(for: .seconds(5)) }
    }
  }
  func connect(_ pair: SyncPairRecord) {
    perform { [self] in
      guard config.account == nil else { throw SyncFailure("Remove this Mac from its current account first.") }
      let value = try await AccountTransport.receiveInvitation(pair)
      let current = try await AccountTransport(account: value).state()
      var next = Configuration(); next.account = value
      try KeychainHelper.setChecked(String(decoding: JSONEncoder().encode(next), as: UTF8.self), for: "account-sync-v1")
      config = next; state = current; baseline = false
      _ = try await SyncTransport(pair: pair).request("account-invite-ack", method: "POST", json: [:])
      message = "Account connected. Choose whether to apply shared Groq settings."
    }
  }
  func rename(to name: String) async throws {
    guard var a = config.account else { return }
    _ = try await AccountTransport(account: a).request("rename", body: ["name": name])
    a.device.name = name; config.account = a; try persist()
  }
  func invite(_ pair: SyncPairRecord) {
    guard let a = config.account else { return }
    perform { [self] in try await AccountTransport(account: a).invite(pair); message = "Account invitation sent. Receive it on your paired device within 5 minutes." }
  }
  func remove(_ id: String) {
    guard let a = config.account else { return }
    perform { [self] in
      _ = try await AccountTransport(account: a).request("revoke", body: ["id": id])
      if id == a.device.id { config = Configuration(); try persist(); state = nil; baseline = false }
      else { state = try await AccountTransport(account: a).state() }
      message = "Account access removed. Rotate any API key the device already received. Direct pairings are managed separately."
    }
  }
  func forgetLocally() {
    perform { [self] in
      config = Configuration(); try persist(); state = nil; baseline = false
      message = "Account forgotten on this Mac. Remove this device from another trusted device to revoke its access."
    }
  }
  func publish(includeKey: Bool) {
    guard let a = config.account, let settings else { return }
    perform { [self] in
      let key = includeKey ? KeychainHelper.get(KeychainHelper.groqAPIKey) : nil
      if includeKey && (key?.isEmpty ?? true) { throw SyncFailure("Save a Groq API key in Writing settings first.") }
      let value = SharedAISettings(model: settings.cleanupModel(for: .groq), cleanupEnabled: settings.cleanupEnabled, vocabulary: settings.customDictionary, groqKey: key)
      try value.validate()
      // The displayed revision is the edit baseline; concurrent updates must be reviewed before retrying.
      guard let state else { throw SyncFailure("Refresh the account before publishing.") }
      try await AccountTransport(account: a).publish(JSONEncoder().encode(value), kind: "settings", revision: state.settingsRevision)
      self.state = try await AccountTransport(account: a).state()
      message = includeKey ? "Groq key and preferences shared with trusted devices." : "Preferences shared without a key. Existing local keys are preserved."
    }
  }
  func applyNow() {
    perform { [self] in
      guard let a = config.account else { return }
      state = try await AccountTransport(account: a).state()
      guard !paused else { throw SyncFailure("Account sync paused.") }
      guard let e = state?.settings else { throw SyncFailure("No shared Groq settings yet.") }
      try apply(e, account: a)
      message = "Shared Groq settings applied to this Mac."
    }
  }
  private func apply(_ e: AccountEnvelope, account: SyncAccountRecord) throws {
    guard let settings else { throw SyncFailure("Settings are unavailable.") }
    let value = try AccountTransport(account: account).settings(e)
    if config.applyKey, let key = value.groqKey { try KeychainHelper.setChecked(key, for: KeychainHelper.groqAPIKey) }
    settings.cleanupProvider = .groq
    settings.setCleanupModel(value.model, for: .groq)
    settings.cleanupEnabled = value.cleanupEnabled
    settings.customDictionary = value.vocabulary
    config.appliedRevision = e.revision; try persist()
  }
  func sendClipboard() {
    guard let a = config.account else { return }
    perform { [self] in
      let count = clipboard.changeCount
      let payload = try clipboard.read()
      let current = try await AccountTransport(account: a).state()
      try await AccountTransport(account: a).sendClipboard(payload, revision: current.clipboardRevision)
      state = try await AccountTransport(account: a).state()
      fingerprint = payload.fingerprint; clipboardCount = count
      message = "Clipboard shared with trusted devices for 2 minutes."
    }
  }
  func receive(_ e: AccountEnvelope) {
    guard let a = config.account else { return }
    perform { [self] in
      // Recheck authorization before using a locally cached encrypted item.
      _ = try await AccountTransport(account: a).state()
      try await copy(e, account: a)
      message = "Copied to this Mac. Paste into another app."
    }
  }
  private func copy(_ e: AccountEnvelope, account: SyncAccountRecord) async throws {
    let count = clipboard.changeCount
    let payload = try await AccountTransport(account: account).clipboard(e)
    guard !paused, config.account?.id == account.id else { throw SyncFailure("Account sync paused.") }
    try clipboard.write(payload, expectedCount: count)
    lastClipboardID = e.id; fingerprint = payload.fingerprint; clipboardCount = clipboard.changeCount
  }
  private func tick() async {
    guard !paused, !busy, let a = config.account else { baseline = false; return }
    busy = true; defer { busy = false }
    do {
      let current = try await AccountTransport(account: a).state()
      guard !paused else { baseline = false; return }
      state = current; error = nil
      if config.followSettings, let e = current.settings, e.revision > config.appliedRevision { try apply(e, account: a) }
      let latest = current.clipboards.filter { $0.sender != a.device.id }.max { $0.createdAt < $1.createdAt }
      guard baseline else {
        baseline = true; lastClipboardID = latest?.id; clipboardCount = clipboard.changeCount
        localCopyAt = Date(); fingerprint = try? clipboard.read().fingerprint; return
      }
      guard config.automaticClipboard else { return }
      if clipboard.changeCount != clipboardCount {
        clipboardCount = clipboard.changeCount; localCopyAt = Date()
        if !clipboard.isAutomaticExcluded, let payload = try? clipboard.read(), payload.fingerprint != fingerprint {
          try await AccountTransport(account: a).sendClipboard(payload, revision: current.clipboardRevision)
          fingerprint = payload.fingerprint
        }
        lastClipboardID = latest?.id; return
      }
      if let e = latest, e.id != lastClipboardID {
        lastClipboardID = e.id
        if Double(e.createdAt) / 1000 >= localCopyAt.timeIntervalSince1970 { try await copy(e, account: a) }
      }
    } catch {
      baseline = false; state = nil
      self.error = (error as? SyncFailure)?.message ?? "Account offline. Existing keys remain available locally."
    }
  }
}
