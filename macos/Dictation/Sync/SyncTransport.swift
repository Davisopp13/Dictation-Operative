import CryptoKit
import Foundation

/// HTTPS ciphertext relay. Pair capabilities authenticate each direction independently.
struct SyncTransport {
  let pair: SyncPairRecord
  static let chunkSize = 262144
  private static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 30
    config.urlCache = nil
    config.httpShouldSetCookies = false
    return URLSession(configuration: config)
  }()
  func request(
    _ action: String, method: String = "GET", json: [String: Any]? = nil, raw: Data? = nil
  ) async throws -> Data {
    guard pair.relay == SyncPairRecord.defaultRelay,
      let url = URL(string: "\(pair.relay)/v1/rooms/\(try pair.room)/\(action)")
    else { throw SyncFailure("Invalid relay.") }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("Bearer \(try pair.token)", forHTTPHeaderField: "Authorization")
    req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    if let raw {
      req.httpBody = raw
      req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
    }
    if let json {
      req.httpBody = try JSONSerialization.data(withJSONObject: json)
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let (data, response) = try await Self.session.data(for: req)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      let problem = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
      throw SyncFailure(
        problem?["error"] ?? "Sync connection failed. Check your internet connection.")
    }
    return data
  }
  func state() async throws -> SyncPairState {
    try JSONDecoder().decode(SyncPairState.self, from: await request("state"))
  }
  func create() async throws {
    _ = try await request(
      "create", method: "POST",
      json: [
        "guestHash": Data((pair.guestAuth ?? "").utf8).syncSHA,
        "device": ["id": pair.device.id, "name": pair.device.name],
      ])
  }
  func join() async throws {
    _ = try await request(
      "join", method: "POST", json: ["device": ["id": pair.device.id, "name": pair.device.name]])
  }
  func approve(_ id: String) async throws {
    _ = try await request("approve", method: "POST", json: ["deviceId": id])
  }
  func revoke() async throws {
    do { _ = try await request("revoke", method: "POST", json: [:]) } catch let error as SyncFailure
      where error.message == "Pairing removed or unavailable"
    { return }
  }
  func rename(_ device: SyncDevice) async throws {
    _ = try await request(
      "rename", method: "POST", json: ["device": ["id": device.id, "name": device.name]])
  }
  func send(_ payload: SyncPayload, progress: @Sendable (Double) async -> Void = { _ in })
    async throws -> SyncEnvelope
  {
    try payload.validate()
    let current = try await state()
    guard current.approved else { throw SyncFailure("Approve the paired device first.") }
    let nonce = AES.GCM.Nonce()
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    var e = SyncEnvelope(
      v: 1, room: try pair.room, id: UUID().uuidString, from: pair.role, to: pair.other,
      sequence: current.sequence + 1, createdAt: now, expiresAt: now + 120000, mime: payload.mime,
      iv: nonce.withUnsafeBytes { Data($0).base64EncodedString() }, size: payload.bytes.count + 16,
      digest: "")
    let sealed = try AES.GCM.seal(
      payload.bytes, using: SymmetricKey(data: pair.derive("content-key")), nonce: nonce,
      authenticating: e.aad)
    var encrypted = Data()
    encrypted.append(sealed.ciphertext)
    encrypted.append(sealed.tag)
    e.digest = encrypted.syncSHA
    let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(e)) as! [String: Any]
    _ = try await request("start", method: "POST", json: object)
    for start in stride(from: 0, to: encrypted.count, by: Self.chunkSize) {
      try Task.checkCancellation()
      _ = try await request(
        "chunk/\(e.id)/\(start / Self.chunkSize)", method: "PUT",
        raw: encrypted.subdata(in: start..<min(start + Self.chunkSize, encrypted.count)))
      await progress(
        Double(min(start + Self.chunkSize, encrypted.count)) / Double(encrypted.count) * 0.95)
    }
    _ = try await request("commit/\(e.id)", method: "POST", json: [:])
    await progress(1)
    return e
  }
  func receive(_ e: SyncEnvelope, progress: @Sendable (Double) async -> Void = { _ in })
    async throws -> SyncPayload
  {
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    guard e.v == 1, e.room == (try pair.room), e.to == pair.role, e.from == pair.other,
      e.expiresAt > now, e.createdAt <= now + 30000, e.expiresAt - e.createdAt <= 120000,
      e.size >= 17, e.size <= SyncPayload.imageLimit + 16
    else { throw SyncFailure("Transfer expired or invalid. Send it again.") }
    var encrypted = Data()
    for start in stride(from: 0, to: e.size, by: Self.chunkSize) {
      let part = try await request("download/\(e.id)/\(start / Self.chunkSize)")
      guard part.count == min(Self.chunkSize, e.size - start) else {
        throw SyncFailure("Transfer interrupted. Send it again.")
      }
      encrypted.append(part)
      await progress(Double(encrypted.count) / Double(e.size) * 0.95)
    }
    guard encrypted.syncSHA == e.digest, let nonce = Data(base64Encoded: e.iv) else {
      throw SyncFailure("Transfer integrity check failed.")
    }
    let box = try AES.GCM.SealedBox(
      nonce: AES.GCM.Nonce(data: nonce), ciphertext: encrypted.dropLast(16),
      tag: encrypted.suffix(16))
    let payload = SyncPayload(
      mime: e.mime,
      bytes: try AES.GCM.open(
        box, using: SymmetricKey(data: pair.derive("content-key")), authenticating: e.aad))
    try payload.validate()
    await progress(1)
    return payload
  }
  func ack(_ id: String) async throws {
    _ = try await request("ack/\(id)", method: "POST", json: [:])
  }
}
