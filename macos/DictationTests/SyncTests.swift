import AppKit
import CryptoKit
import XCTest

@testable import Dictation

final class SyncTests: XCTestCase {
  @MainActor func testShortCodePairingMatchesWebCryptoFixture() throws {
    let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Shared/Sync/pairing-fixture.json")
    struct Fixture: Decodable {
      let code: String; let hostPrivateKey: String; let guestPrivateKey: String
      let state: SyncPairingState; let secret: String; let guestAuth: String; let verification: String
    }
    let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureURL))
    for role in ["host", "guest"] {
      let raw = role == "host" ? fixture.hostPrivateKey : fixture.guestPrivateKey
      let device = role == "host" ? fixture.state.host.device : fixture.state.guest!.device
      let client = SyncPairing(code: fixture.code, role: role, device: device,
        privateKey: try P256.KeyAgreement.PrivateKey(rawRepresentation: XCTUnwrap(Data(syncBase64: raw))))
      client.state = fixture.state
      XCTAssertEqual(try client.derive("content-secret").syncURL64, fixture.secret)
      XCTAssertEqual(try client.derive("guest-authorization").syncURL64, fixture.guestAuth)
      XCTAssertEqual(try client.verification(), fixture.verification)
      XCTAssertEqual(try client.pair().secret, fixture.secret)
      if role == "guest" { XCTAssertNil(try client.pair().guestAuth) }
      XCTAssertTrue(client.link.contains("/pair#code=ABC234&key="))
      XCTAssertFalse(client.link.contains(client.token))
    }
    XCTAssertTrue(SyncPairing.validCode("abc 234"))
    XCTAssertEqual(SyncPairing.normalize("abc-234"), "ABC234")
    XCTAssertFalse(SyncPairing.validCode("OI01ab"))
  }
  func testHKDFInteroperabilityAndInvitationDoesNotExposeHostAuthorization() throws {
    let secret = Data(repeating: 0, count: 32).syncURL64
    let host = SyncPairRecord(
      relay: SyncPairRecord.defaultRelay, secret: secret,
      auth: Data(repeating: 1, count: 32).syncURL64,
      guestAuth: Data(repeating: 2, count: 32).syncURL64, role: "host",
      device: SyncDevice(id: "host-test", name: "Host"), peerName: "Guest")
    XCTAssertEqual(
      try host.room, "e7e0f450d94180b789d6d471b4053606a1b7d3b79a1ec2da5bd23e4a376e3d52")
    let guest = try SyncPairRecord.parse(
      host.invitation(), device: SyncDevice(id: "guest-test", name: "Guest"))
    XCTAssertEqual(guest.auth, host.guestAuth)
    XCTAssertNotEqual(guest.auth, host.auth)
    XCTAssertNil(guest.guestAuth)
    XCTAssertEqual(try guest.derive("content-key"), try host.derive("content-key"))
  }
  @MainActor func testNativeImageClipboardPreservesBytesAndRejectsConcurrentOverwrite() throws {
    let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().appendingPathComponent("SyncValidation/transparency.png")
    let bytes = try Data(contentsOf: fixture)
    let clipboard = MacClipboardAdapter(
      board: NSPasteboard(name: .init("SyncTests-" + UUID().uuidString)))
    defer { clipboard.board.clearContents() }
    let payload = SyncPayload(mime: "image/png", bytes: bytes)
    try clipboard.write(payload, expectedCount: clipboard.changeCount)
    XCTAssertEqual(try clipboard.read().bytes, bytes)
    XCTAssertTrue(clipboard.isAutomaticExcluded)
    let count = clipboard.changeCount
    clipboard.board.clearContents()
    clipboard.board.setString("Newer local copy", forType: .string)
    XCTAssertThrowsError(try clipboard.write(payload, expectedCount: count))
    XCTAssertEqual(clipboard.board.string(forType: .string), "Newer local copy")
  }
  @MainActor func testTIFFConversionPreservesDimensionsAndTransparency() throws {
    let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().appendingPathComponent("SyncValidation/transparency.png")
    let bitmap = try XCTUnwrap(NSBitmapImageRep(data: Data(contentsOf: fixture)))
    let tiff = try XCTUnwrap(bitmap.representation(using: .tiff, properties: [:]))
    let clipboard = MacClipboardAdapter(
      board: NSPasteboard(name: .init("SyncTIFF-" + UUID().uuidString)))
    defer { clipboard.board.clearContents() }
    clipboard.board.setData(tiff, forType: .tiff)
    let received = try clipboard.read()
    XCTAssertEqual(received.mime, "image/png")
    let decoded = try XCTUnwrap(NSBitmapImageRep(data: received.bytes))
    XCTAssertEqual(decoded.pixelsWide, 64)
    XCTAssertEqual(decoded.pixelsHigh, 32)
    XCTAssertEqual(try XCTUnwrap(decoded.colorAt(x: 0, y: 0)).alphaComponent, 0, accuracy: 0.01)
    XCTAssertEqual(try XCTUnwrap(decoded.colorAt(x: 20, y: 0)).alphaComponent, 0.5, accuracy: 0.01)
    XCTAssertEqual(try XCTUnwrap(decoded.colorAt(x: 40, y: 0)).alphaComponent, 1, accuracy: 0.01)
    clipboard.board.setString("file:///tmp/example.png", forType: .fileURL)
    XCTAssertThrowsError(
      try clipboard.read(), "A file reference must not send a thumbnail as image content")
  }
  func testSizeAndMalformedImageRejected() {
    XCTAssertThrowsError(
      try SyncPayload(mime: "text/plain", bytes: Data(repeating: 65, count: 262145)).validate())
    XCTAssertThrowsError(
      try SyncPayload(mime: "image/png", bytes: Data("https://example.test/image.png".utf8))
        .validate())
  }
}
