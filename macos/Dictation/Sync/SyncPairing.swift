import CryptoKit
import Foundation

struct SyncPairingPeer: Codable {
  var device: SyncDevice
  var publicKey: String
}
struct SyncPairingState: Codable {
  var host: SyncPairingPeer
  var guest: SyncPairingPeer?
  var expiresAt: Int64
  var approved: Bool
}
struct SyncPairingError: LocalizedError {
  let message: String
  let status: Int
  var errorDescription: String? { message }
}
private final class PairingRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(_ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

/// The relay sees public keys only. Compare the confirmation on both devices before approval.
@MainActor final class SyncPairing {
  static let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
  static let site = "https://do-voice-workspace.davisopp.chatgpt.site"
  let code: String
  let role: String
  let device: SyncDevice
  let token: String
  let privateKey: P256.KeyAgreement.PrivateKey
  let roomAuth = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0).syncURL64 }
  var state: SyncPairingState!
  var publicKey: String { privateKey.publicKey.x963Representation.syncURL64 }
  var link: String { "\(Self.site)/pair#code=\(code)&key=\(publicKey)" }
  var displayCode: String { String(code.prefix(3)) + " " + String(code.suffix(3)) }
  private static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 30
    config.urlCache = nil
    config.httpShouldSetCookies = false
    return URLSession(configuration: config, delegate: PairingRedirectDelegate(), delegateQueue: nil)
  }()
  init(code: String, role: String, device: SyncDevice,
    privateKey: P256.KeyAgreement.PrivateKey = .init(),
    token: String = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0).syncURL64 }) {
    self.code = code; self.role = role; self.device = device; self.privateKey = privateKey; self.token = token
  }
  static func normalize(_ value: String) -> String {
    value.filter { !$0.isWhitespace && $0 != "-" }.uppercased()
  }
  static func validCode(_ value: String) -> Bool {
    let clean = normalize(value)
    return clean.count == 6 && clean.allSatisfy { alphabet.contains($0) }
  }
  static func create(device: SyncDevice) async throws -> SyncPairing {
    for _ in 0..<3 {
      let bytes = SymmetricKey(size: .bits256).withUnsafeBytes { Array($0.prefix(6)) }
      let code = String(bytes.map { alphabet[Int($0) % 32] })
      let client = SyncPairing(code: code, role: "host", device: device)
      do {
        _ = try await client.request("create", data: ["peer": client.peer])
        return client
      } catch let e as SyncPairingError where e.status == 409 { continue }
    }
    throw SyncFailure("Could not create a code. Try again.")
  }
  static func claim(_ code: String, device: SyncDevice) async throws -> SyncPairing {
    guard validCode(code) else { throw SyncFailure("Enter the six-character code on your other device.") }
    let client = SyncPairing(code: normalize(code), role: "guest", device: device)
    _ = try await client.request("claim", data: ["peer": client.peer])
    return client
  }
  private var peer: [String: Any] {
    ["device": ["id": device.id, "name": device.name], "publicKey": publicKey]
  }
  @discardableResult func request(_ action: String, data: [String: Any] = [:]) async throws -> SyncPairingState {
    var req = URLRequest(url: URL(string: "\(SyncPairRecord.defaultRelay)/v2/pairing/\(action)")!)
    req.httpMethod = "POST"
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    var body = data; body["code"] = code
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (bytes, response) = try await Self.session.data(for: req)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      let problem = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: String]
      throw SyncPairingError(message: problem?["error"] ?? "Could not connect. Try again.", status: (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
    let next = try JSONDecoder().decode(SyncPairingState.self, from: bytes)
    let own = role == "host" ? next.host : next.guest
    guard own?.publicKey == publicKey, own?.device.id == device.id,
      state == nil || (state.host.publicKey == next.host.publicKey && state.host.device.id == next.host.device.id),
      state?.guest == nil || (state.guest?.publicKey == next.guest?.publicKey && state.guest?.device.id == next.guest?.device.id)
    else { throw SyncFailure("The pairing devices changed. Cancel and create a new code.") }
    state = next
    return next
  }
  func derive(_ info: String) throws -> Data {
    guard let state, let guest = state.guest else { throw SyncFailure("Waiting for your other device.") }
    let remote = role == "host" ? guest : state.host
    guard let bytes = Data(syncBase64: remote.publicKey) else { throw SyncFailure("Invalid device key.") }
    let publicKey = try P256.KeyAgreement.PublicKey(x963Representation: bytes)
    let shared = try privateKey.sharedSecretFromKeyAgreement(with: publicKey)
    let transcript = ["DO-PAIR/2", code, state.host.publicKey, guest.publicKey, state.host.device.id, guest.device.id].joined(separator: "\n")
    let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(transcript.utf8),
      sharedInfo: Data(info.utf8), outputByteCount: 32)
    return key.withUnsafeBytes { Data($0) }
  }
  func verification() throws -> String {
    let value = Array(try derive("verification").syncSHA.prefix(12).uppercased())
    return stride(from: 0, to: 12, by: 4).map { String(value[$0..<($0 + 4)]) }.joined(separator: " ")
  }
  func pair() throws -> SyncPairRecord {
    let guestAuth = try derive("guest-authorization").syncURL64
    return SyncPairRecord(relay: SyncPairRecord.defaultRelay, secret: try derive("content-secret").syncURL64,
      auth: role == "host" ? roomAuth : guestAuth, guestAuth: role == "host" ? guestAuth : nil,
      role: role, device: device, peerName: (role == "host" ? state.guest! : state.host).device.name)
  }
  func approve() async throws -> SyncPairRecord {
    guard role == "host", let guest = state.guest else { throw SyncFailure("Approve on your other device.") }
    let record = try pair(), host = SyncTransport(pair: record)
    try await host.create()
    let current = try await host.state()
    if !current.approved {
      var guestRecord = record
      guestRecord.auth = record.guestAuth!; guestRecord.guestAuth = nil
      guestRecord.role = "guest"; guestRecord.device = guest.device
      try await SyncTransport(pair: guestRecord).join()
      try await host.approve(guest.device.id)
    }
    do { try await request("approve", data: ["guestKey": guest.publicKey]) }
    catch let error as SyncPairingError where error.status == 409 || error.status == 410 {
      try await host.revoke()
      throw error
    }
    return record
  }
  func finish() async throws -> SyncPairRecord {
    guard role == "guest", state.approved else { throw SyncFailure("Waiting for approval on your other device.") }
    let record = try pair(), current = try await SyncTransport(pair: record).state()
    guard current.approved, current.host.id == state.host.device.id, current.guest?.id == device.id else {
      throw SyncFailure("Pairing is not ready. Try again.")
    }
    return record
  }
}
