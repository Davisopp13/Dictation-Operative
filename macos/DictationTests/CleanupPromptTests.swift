import XCTest
@testable import Dictation

final class CleanupPromptTests: XCTestCase {
    func testBasePromptContainsCoreRules() {
        let prompt = CleanupPrompt.system(dictionary: [])
        XCTAssertTrue(prompt.contains("filler words"))
        XCTAssertTrue(prompt.contains("ONLY the cleaned text"))
        XCTAssertFalse(prompt.contains("Prefer these exact spellings"))
    }

    func testDictionaryWordsAreIncluded() {
        let prompt = CleanupPrompt.system(dictionary: ["Hapag-Lloyd", "WhisperKit"])
        XCTAssertTrue(prompt.contains("Hapag-Lloyd"))
        XCTAssertTrue(prompt.contains("WhisperKit"))
        XCTAssertTrue(prompt.contains("Prefer these exact spellings"))
    }

    func testBlankDictionaryEntriesAreDropped() {
        let prompt = CleanupPrompt.system(dictionary: ["  ", "", "Kubernetes"])
        XCTAssertTrue(prompt.contains("Kubernetes"))
        XCTAssertFalse(prompt.contains(",  ,"))
    }

    func testAllBlankDictionaryBehavesLikeEmpty() {
        let prompt = CleanupPrompt.system(dictionary: ["  ", ""])
        XCTAssertEqual(prompt, CleanupPrompt.system(dictionary: []))
    }
}
