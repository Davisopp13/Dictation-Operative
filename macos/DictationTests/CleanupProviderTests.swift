import XCTest
@testable import Dictation

final class CleanupProviderTests: XCTestCase {
    // MARK: CleanupProviderKind

    func testEveryKindHasADefaultModel() {
        for kind in CleanupProviderKind.allCases {
            XCTAssertFalse(kind.defaultModel.isEmpty, "\(kind) has no default model")
        }
    }

    func testKeychainAccountsAreUnique() {
        let accounts = CleanupProviderKind.allCases.map(\.keychainAccount)
        XCTAssertEqual(Set(accounts).count, accounts.count)
    }

    func testGroqKeepsLegacyKeychainAccount() {
        XCTAssertEqual(CleanupProviderKind.groq.keychainAccount, KeychainHelper.groqAPIKey)
    }

    func testOnlyLocalIsKeyless() {
        XCTAssertFalse(CleanupProviderKind.local.requiresAPIKey)
        for kind in CleanupProviderKind.allCases where kind != .local {
            XCTAssertTrue(kind.requiresAPIKey)
        }
    }

    func testOpenAICompatibleKindsHaveBaseURLs() {
        for kind in CleanupProviderKind.allCases where kind != .anthropic {
            XCTAssertNotNil(URL(string: kind.defaultBaseURL ?? ""), "\(kind) base URL invalid")
        }
        XCTAssertNil(CleanupProviderKind.anthropic.defaultBaseURL)
    }

    // MARK: Endpoint building

    func testEndpointAppendsChatCompletions() {
        let url = OpenAICompatibleCleanupService.endpoint(for: URL(string: "https://api.groq.com/openai/v1")!)
        XCTAssertEqual(url.absoluteString, "https://api.groq.com/openai/v1/chat/completions")
    }

    func testEndpointToleratesTrailingSlash() {
        let url = OpenAICompatibleCleanupService.endpoint(for: URL(string: "http://localhost:11434/v1/")!)
        XCTAssertEqual(url.absoluteString, "http://localhost:11434/v1/chat/completions")
    }

    // MARK: Factory

    func testFactoryPicksAnthropicService() {
        let provider = CleanupProviderFactory.make(kind: .anthropic, apiKey: "k", model: "m", baseURL: nil)
        XCTAssertTrue(provider is AnthropicCleanupService)
        XCTAssertEqual(provider.id, "anthropic")
    }

    func testFactoryUsesEditedLocalBaseURL() {
        let provider = CleanupProviderFactory.make(
            kind: .local, apiKey: "", model: "m", baseURL: "http://localhost:8080/v1"
        )
        guard let service = provider as? OpenAICompatibleCleanupService else {
            return XCTFail("expected an OpenAI-compatible service")
        }
        XCTAssertEqual(service.baseURL.absoluteString, "http://localhost:8080/v1")
        XCTAssertNil(service.apiKey)
    }

    // MARK: Guardrails

    func testGuardRejectsEmptyOutput() {
        XCTAssertThrowsError(try CleanupGuard.validate("   ", transcript: "hello"))
        XCTAssertThrowsError(try CleanupGuard.validate(nil, transcript: "hello"))
    }

    func testGuardRejectsRunawayOutput() {
        let runaway = String(repeating: "x", count: 5 * 3 + 65)
        XCTAssertThrowsError(try CleanupGuard.validate(runaway, transcript: "hello"))
    }

    func testGuardTrimsAcceptableOutput() throws {
        XCTAssertEqual(try CleanupGuard.validate("  Hello world.\n", transcript: "um hello world"), "Hello world.")
    }

    // MARK: Settings

    func testSettingsFallBackToDefaultModelPerProvider() {
        let defaults = UserDefaults(suiteName: "CleanupProviderTests.\(UUID().uuidString)")!
        let settings = SettingsStore(defaults: defaults)
        XCTAssertEqual(settings.cleanupModel(for: .anthropic), CleanupProviderKind.anthropic.defaultModel)
        settings.setCleanupModel("claude-haiku-4-5", for: .anthropic)
        XCTAssertEqual(settings.cleanupModel(for: .anthropic), "claude-haiku-4-5")
        XCTAssertEqual(settings.cleanupModel(for: .groq), CleanupProviderKind.groq.defaultModel)
    }

    func testSettingsMigrateLegacyGroqModel() {
        let defaults = UserDefaults(suiteName: "CleanupProviderTests.\(UUID().uuidString)")!
        defaults.set("llama-3.3-70b-versatile", forKey: "cleanupModel")
        let settings = SettingsStore(defaults: defaults)
        XCTAssertEqual(settings.cleanupModel(for: .groq), "llama-3.3-70b-versatile")
        XCTAssertEqual(settings.cleanupProvider, .groq)
    }
}
