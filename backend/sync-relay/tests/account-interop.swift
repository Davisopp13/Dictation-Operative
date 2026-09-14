// Executed by account-interop.test.ts on macOS; only synthetic credentials and a named test pasteboard.
import Foundation
import CryptoKit
@main struct AccountInterop {
  struct Fixture: Codable { let account: SyncAccountRecord; let envelope: AccountEnvelope; let settings: SharedAISettings }
  static func main() throws {
    let fixture = try JSONDecoder().decode(Fixture.self, from: FileHandle.standardInput.readDataToEndOfFile())
    let transport = AccountTransport(account: fixture.account)
    let received = try transport.settings(fixture.envelope)
    guard received.model == fixture.settings.model, received.groqKey == fixture.settings.groqKey,
      received.vocabulary == fixture.settings.vocabulary else { throw SyncFailure("Web Crypto settings mismatch") }
    var tampered = fixture.envelope; tampered.revision += 1
    do { _ = try transport.open(tampered, kind: "settings"); throw SyncFailure("Accepted altered revision") }
    catch is CryptoKitError {} // AES-GCM authentication must fail.
    let native = try transport.seal(JSONEncoder().encode(received), kind: "settings", revision: 2)
    FileHandle.standardOutput.write(try JSONEncoder().encode(native))
  }
}
