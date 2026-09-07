import CryptoKit
import Foundation

/// Protocol-only models and cryptography; no transcription or clipboard dependency.
struct SyncDevice: Codable {
  var id: String
  var name: String
}
struct SyncPairRecord: Codable, Identifiable {
  var relay: String
  var secret: String
  var auth: String
  var guestAuth: String?
  var role: String
  var device: SyncDevice
  var peerName: String
  var id: String { secret }
  static let defaultRelay = "https://dictation-operative-sync.davisopp.workers.dev"
  var other: String { role == "host" ? "guest" : "host" }
  func derive(_ info: String) throws -> Data {
    guard let secretData = Data(syncBase64: secret), secretData.count == 32 else {
      throw SyncFailure("Invalid pairing key.")
    }
    let key = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: SymmetricKey(data: secretData),
      salt: Data("Dictation Operative Sync v1".utf8), info: Data(info.utf8), outputByteCount: 32)
    return key.withUnsafeBytes { Data($0) }
  }
  var room: String { get throws { try derive("room").syncHex } }
  var token: String {
    get throws {
      guard Data(syncBase64: auth)?.count == 32 else {
        throw SyncFailure("Invalid device authorization.")
      }
      return auth
    }
  }
  func invitation() throws -> String {
    let bytes = try JSONEncoder().encode(
      Invite(relay: relay, secret: secret, auth: guestAuth ?? "", name: device.name))
    return "dosync1:" + bytes.syncURL64
  }
  private struct Invite: Codable {
    let relay: String
    let secret: String
    let auth: String
    let name: String
  }
  static func parse(_ code: String, device: SyncDevice) throws -> Self {
    let clean = code.trimmingCharacters(in: .whitespacesAndNewlines)
    guard clean.hasPrefix("dosync1:"), clean.count < 2048,
      let data = Data(syncBase64: String(clean.dropFirst(8)))
    else { throw SyncFailure("Paste a complete Sync invitation.") }
    let invite = try JSONDecoder().decode(Invite.self, from: data)
    guard invite.relay == defaultRelay, Data(syncBase64: invite.secret)?.count == 32,
      Data(syncBase64: invite.auth)?.count == 32, invite.name.count <= 60
    else { throw SyncFailure("Invalid invitation or unsupported relay.") }
    return Self(
      relay: invite.relay, secret: invite.secret, auth: invite.auth, role: "guest", device: device,
      peerName: invite.name)
  }
}
struct SyncEnvelope: Codable {
  var v: Int
  var room: String
  var id: String
  var from: String
  var to: String
  var sequence: Int
  var createdAt: Int64
  var expiresAt: Int64
  var mime: String
  var iv: String
  var size: Int
  var digest: String
  var aad: Data {
    Data(
      [
        "DO-SYNC/1", room, id, from, to, String(sequence), String(createdAt), String(expiresAt),
        mime,
      ].joined(separator: "\n").utf8)
  }
}
struct SyncPairState: Codable {
  var approved: Bool
  var host: SyncDevice
  var guest: SyncDevice?
  var peerOnline: Bool
  var sequence: Int
  var latest: SyncEnvelope?
  var ack: Ack?
  var serverTime: Int64
  struct Ack: Codable {
    var id: String
    var at: Int64
  }
}
struct SyncPayload {
  let mime: String
  let bytes: Data
  static let imageLimit = 8 * 1024 * 1024
  func validate() throws {
    guard mime == "text/plain" || mime == "image/png", !bytes.isEmpty,
      bytes.count <= (mime == "image/png" ? Self.imageLimit : 262144)
    else { throw SyncFailure("Text is limited to 256 KiB; images to 8 MiB.") }
    if mime == "text/plain" {
      guard String(data: bytes, encoding: .utf8) != nil else {
        throw SyncFailure("Invalid UTF-8 text.")
      }
      return
    }
    guard bytes.count >= 33, Array(bytes.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10],
      String(data: bytes[12..<16], encoding: .ascii) == "IHDR"
    else { throw SyncFailure("Invalid PNG image.") }
    let w = bytes[16..<20].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    let h = bytes[20..<24].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    guard w > 0, h > 0, w <= 16384, h <= 16384, w * h <= 40_000_000 else {
      throw SyncFailure("Images are limited to 40 megapixels.")
    }
  }
  var fingerprint: String { (Data((mime + ":").utf8) + bytes).syncSHA }
}
struct SyncFailure: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}
extension Data {
  init?(syncBase64: String) {
    let value = syncBase64.replacingOccurrences(of: "-", with: "+").replacingOccurrences(
      of: "_", with: "/")
    self.init(base64Encoded: value + String(repeating: "=", count: (4 - value.count % 4) % 4))
  }
  var syncHex: String { map { String(format: "%02x", $0) }.joined() }
  var syncSHA: String { Data(SHA256.hash(data: self)).syncHex }
  var syncURL64: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(
      of: "/", with: "_"
    ).replacingOccurrences(of: "=", with: "")
  }
}
