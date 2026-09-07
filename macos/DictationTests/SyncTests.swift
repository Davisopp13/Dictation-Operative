import AppKit
import CryptoKit
import XCTest

@testable import Dictation

final class SyncTests: XCTestCase {
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
