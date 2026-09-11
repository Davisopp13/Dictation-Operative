import CryptoKit
import Foundation

struct SyncAccountRecord: Codable {
  var v = 1
  var id: String
  var label: String
  var secret: String
  var token: String
  var device: SyncDevice
  func validate() throws {
    guard v == 1, id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      Data(syncBase64: secret)?.count == 32, Data(syncBase64: token)?.count == 32,
      device.id.range(of: "^[a-zA-Z0-9_-]{8,80}$", options: .regularExpression) != nil,
      !device.name.isEmpty, device.name.count <= 60, label.count <= 300
    else { throw SyncFailure("Invalid account invitation.") }
  }
}
struct AccountEnvelope: Codable, Identifiable {
  var v: Int; var id: String; var account: String; var sender: String; var kind: String
  var revision: Int; var createdAt: Int64; var expiresAt: Int64; var iv: String; var ciphertext: String
  var aad: Data { Data(["DO-ACCOUNT/1", account, id, sender, kind, String(revision), String(createdAt), String(expiresAt)].joined(separator: "\n").utf8) }
}
struct SharedAISettings: Codable {
  var v = 1
  var provider = "groq"
  var model: String
  var cleanupEnabled: Bool
  var vocabulary: [String]
  var groqKey: String?
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(v, forKey: .v); try c.encode(provider, forKey: .provider)
    try c.encode(model, forKey: .model); try c.encode(cleanupEnabled, forKey: .cleanupEnabled)
    try c.encode(vocabulary, forKey: .vocabulary)
    if let groqKey { try c.encode(groqKey, forKey: .groqKey) } else { try c.encodeNil(forKey: .groqKey) }
  }
  func validate() throws {
    guard v == 1, provider == "groq", model.range(of: "^[a-zA-Z0-9/_.-]{1,120}$", options: .regularExpression) != nil,
      vocabulary.count <= 500, vocabulary.allSatisfy({ $0.utf16.count <= 100 }),
      groqKey == nil || groqKey!.range(of: "^gsk_[A-Za-z0-9_-]{15,296}$", options: .regularExpression) != nil
    else { throw SyncFailure("Invalid shared Groq settings.") }
  }
}
struct SyncAccountState: Codable {
  struct Device: Codable, Identifiable { var id: String; var name: String; var seen: Int64 }
  var id: String
  var devices: [Device]
  var settingsRevision: Int
  var settings: AccountEnvelope?
  var clipboardRevision: Int
  var clipboards: [AccountEnvelope]
}
struct AccountTransport {
  let account: SyncAccountRecord
  private static let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = 30; c.timeoutIntervalForResource = 45
    c.httpShouldSetCookies = false; c.urlCache = nil
    return URLSession(configuration: c, delegate: AccountRedirectPolicy(), delegateQueue: nil)
  }()
  static func key(_ secret: String, purpose: String) throws -> SymmetricKey {
    guard let raw = Data(syncBase64: secret), raw.count == 32 else { throw SyncFailure("Invalid account key.") }
    return HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: raw), salt: Data("DO-ACCOUNT/1".utf8), info: Data(purpose.utf8), outputByteCount: 32)
  }
  func request(_ action: String, body: [String: Any]? = nil) async throws -> Data {
    try account.validate()
    let url = URL(string: "\(SyncPairRecord.defaultRelay)/v1/accounts/\(account.id)/\(action)")!
    var req = URLRequest(url: url)
    req.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
    req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    if let body { req.httpMethod = "POST"; req.httpBody = try JSONSerialization.data(withJSONObject: body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    let (data, response) = try await Self.session.data(for: req)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      let problem = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
      throw SyncFailure(problem?["error"] ?? "Account sync could not connect.")
    }
    return data
  }
  func state() async throws -> SyncAccountState { try JSONDecoder().decode(SyncAccountState.self, from: await request("state")) }
  func seal(_ bytes: Data, kind: String, revision: Int) throws -> AccountEnvelope {
    try account.validate()
    let now = Int64(Date().timeIntervalSince1970 * 1000), nonce = AES.GCM.Nonce()
    var e = AccountEnvelope(v: 1, id: UUID().uuidString, account: account.id, sender: account.device.id, kind: kind, revision: revision, createdAt: now, expiresAt: kind == "clipboard" ? now + 120000 : 0, iv: nonce.withUnsafeBytes { Data($0).base64EncodedString() }, ciphertext: "")
    let box = try AES.GCM.seal(bytes, using: Self.key(account.secret, purpose: kind), nonce: nonce, authenticating: e.aad)
    e.ciphertext = (box.ciphertext + box.tag).base64EncodedString()
    guard e.ciphertext.count <= (kind == "settings" ? 65536 : 12 * 1024 * 1024) else { throw SyncFailure("Shared item is too large. Use Send to device for large images.") }
    return e
  }
  func open(_ e: AccountEnvelope, kind: String) throws -> Data {
    try account.validate()
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    guard e.v == 1, e.account == account.id, e.kind == kind, e.revision > 0, e.createdAt <= now + 30000,
      kind == "settings" ? e.expiresAt == 0 : (e.expiresAt > now && e.expiresAt <= e.createdAt + 120000),
      e.ciphertext.count <= (kind == "settings" ? 65536 : 12 * 1024 * 1024),
      let bytes = Data(base64Encoded: e.ciphertext), bytes.count >= 16, let iv = Data(base64Encoded: e.iv)
    else { throw SyncFailure("Invalid or expired account item.") }
    let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: bytes.dropLast(16), tag: bytes.suffix(16))
    return try AES.GCM.open(box, using: Self.key(account.secret, purpose: kind), authenticating: e.aad)
  }
  func publish(_ bytes: Data, kind: String, revision: Int) async throws {
    let envelope = try seal(bytes, kind: kind, revision: revision + 1)
    let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope))
    _ = try await request(kind, body: ["envelope": object])
  }
  func settings(_ e: AccountEnvelope) throws -> SharedAISettings {
    let settings = try JSONDecoder().decode(SharedAISettings.self, from: open(e, kind: "settings"))
    try settings.validate(); return settings
  }
  func clipboard(_ e: AccountEnvelope) async throws -> SyncPayload {
    let current = try JSONDecoder().decode(AccountEnvelope.self, from: await request("clipboard/\(e.sender)"))
    guard current.id == e.id else { throw SyncFailure("This clipboard was replaced. Refresh to see the latest.") }
    return try decodeClipboard(current)
  }
  func decodeClipboard(_ e: AccountEnvelope) throws -> SyncPayload {
    let bytes = try open(e, kind: "clipboard")
    guard let format = bytes.first, format == 0 || format == 1 else { throw SyncFailure("Invalid clipboard item.") }
    let payload = SyncPayload(mime: format == 0 ? "text/plain" : "image/png", bytes: Data(bytes.dropFirst()))
    try payload.validate(); return payload
  }
  func sendClipboard(_ p: SyncPayload, revision: Int) async throws {
    try p.validate()
    try await publish(Data([p.mime == "text/plain" ? 0 : 1]) + p.bytes, kind: "clipboard", revision: revision)
  }
  private struct Invitation: Codable { var iv: String; var ciphertext: String; var expiresAt: Int64 }
  private struct Inbox: Codable { var invitation: Invitation? }
  private static func invitationAAD(_ pair: SyncPairRecord, recipient: String, expires: Int64) throws -> Data {
    Data(["DO-ACCOUNT-INVITE/1", try pair.room, recipient, String(expires)].joined(separator: "\n").utf8)
  }
  static func receiveInvitation(_ pair: SyncPairRecord) async throws -> SyncAccountRecord {
    let inbox = try JSONDecoder().decode(Inbox.self, from: await SyncTransport(pair: pair).request("account-invite"))
    guard let e = inbox.invitation, e.expiresAt > Int64(Date().timeIntervalSince1970 * 1000),
      let iv = Data(base64Encoded: e.iv), let bytes = Data(base64Encoded: e.ciphertext), bytes.count >= 16
    else { throw SyncFailure("No account invitation is waiting. Send one from your trusted device.") }
    let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: bytes.dropLast(16), tag: bytes.suffix(16))
    let raw = try AES.GCM.open(box, using: key(pair.secret, purpose: "invitation"), authenticating: invitationAAD(pair, recipient: pair.role, expires: e.expiresAt))
    let value = try JSONDecoder().decode(SyncAccountRecord.self, from: raw); try value.validate(); return value
  }
  func invite(_ pair: SyncPairRecord) async throws {
    let state = try await SyncTransport(pair: pair).state()
    guard state.approved, let peer = pair.role == "host" ? state.guest : state.host else { throw SyncFailure("Approve this device pairing first.") }
    let token = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0).syncURL64 }
    var next = account; next.token = token; next.device = SyncDevice(id: UUID().uuidString, name: peer.name)
    _ = try await request("register", body: ["id": next.device.id, "name": next.device.name, "tokenHash": Data(token.utf8).syncSHA])
    do {
      let expires = Int64(Date().timeIntervalSince1970 * 1000) + 300000, nonce = AES.GCM.Nonce()
      let box = try AES.GCM.seal(JSONEncoder().encode(next), using: Self.key(pair.secret, purpose: "invitation"), nonce: nonce, authenticating: Self.invitationAAD(pair, recipient: pair.other, expires: expires))
      _ = try await SyncTransport(pair: pair).request("account-invite", method: "POST", json: ["expiresAt": expires, "iv": nonce.withUnsafeBytes { Data($0).base64EncodedString() }, "ciphertext": (box.ciphertext + box.tag).base64EncodedString()])
    } catch { _ = try? await request("revoke", body: ["id": next.device.id]); throw error }
  }
}

private final class AccountRedirectPolicy: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}
