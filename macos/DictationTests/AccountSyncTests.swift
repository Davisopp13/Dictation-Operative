import XCTest
@testable import Dictation

final class AccountSyncTests: XCTestCase {
  private func account() -> SyncAccountRecord {
    SyncAccountRecord(id: String(repeating: "a", count: 64), label: "Test", secret: Data(repeating: 1, count: 32).syncURL64,
      token: Data(repeating: 2, count: 32).syncURL64, device: SyncDevice(id: "test-device", name: "Mac"))
  }
  func testSettingsNeverDecodeAsClipboardAndAuthenticateRevision() throws {
    let transport = AccountTransport(account: account())
    let settings = SharedAISettings(model: "test-model", cleanupEnabled: true, vocabulary: ["Dictation"], groqKey: nil)
    let e = try transport.seal(JSONEncoder().encode(settings), kind: "settings", revision: 1)
    XCTAssertNil(try transport.settings(e).groqKey)
    XCTAssertThrowsError(try transport.decodeClipboard(e))
    var changed = e; changed.revision += 1
    XCTAssertThrowsError(try transport.settings(changed))
    var other = account(); other.id = String(repeating: "b", count: 64)
    XCTAssertThrowsError(try AccountTransport(account: other).settings(e))
  }
  func testClipboardExpiryAndUnsupportedMimeRejected() throws {
    let transport = AccountTransport(account: account())
    let p = Data([0]) + Data("Clipboard".utf8)
    var e = try transport.seal(p, kind: "clipboard", revision: 1)
    XCTAssertEqual(try transport.decodeClipboard(e).bytes, Data("Clipboard".utf8))
    e.expiresAt = 1
    XCTAssertThrowsError(try transport.decodeClipboard(e))
    let bad = Data([2]) + Data("secret".utf8)
    let wrongType = try transport.seal(bad, kind: "clipboard", revision: 2)
    XCTAssertThrowsError(try transport.decodeClipboard(wrongType))
  }
  func testSharedSettingsValidation() throws {
    let good = SharedAISettings(model: "openai/gpt-oss-120b", cleanupEnabled: true, vocabulary: [], groqKey: "gsk_synthetic_test_key_12345")
    XCTAssertNoThrow(try good.validate())
    var bad = good; bad.provider = "local"
    XCTAssertThrowsError(try bad.validate())
    bad = good; bad.model = "https://attacker.invalid/"
    XCTAssertThrowsError(try bad.validate())
    bad = good; bad.groqKey = "not-a-key"
    XCTAssertThrowsError(try bad.validate())
  }
}
