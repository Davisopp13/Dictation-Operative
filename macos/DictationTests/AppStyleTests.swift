import XCTest
@testable import Dictation

final class AppStyleTests: XCTestCase {
    func testExactMatchWins() {
        let rules = ["com.apple.mail": "formal", "apple": "casual"]
        XCTAssertEqual(AppStyle.style(for: "com.apple.mail", rules: rules), "formal")
    }

    func testSubstringMatchIsCaseInsensitiveAndPrefersLongerKey() {
        let rules = ["slack": "casual", "tinyspeck.slackmacgap": "very casual"]
        XCTAssertEqual(AppStyle.style(for: "com.tinyspeck.SlackMacGap", rules: rules), "very casual")
    }

    func testNoMatchAndEmptyStyleReturnNil() {
        XCTAssertNil(AppStyle.style(for: "com.example.app", rules: ["slack": "casual"]))
        XCTAssertNil(AppStyle.style(for: "com.example.app", rules: ["com.example.app": "   "]))
        XCTAssertNil(AppStyle.style(for: nil, rules: ["com.example.app": "x"]))
    }

    func testSuggestedRulesUseKnownPresets() {
        for (_, text) in AppStyle.suggestedRules {
            XCTAssertFalse(text.isEmpty)
            XCTAssertTrue(AppStyle.presets.contains { $0.text == text })
        }
    }

    func testPromptIncludesStyleOnlyWhenPresent() {
        XCTAssertFalse(CleanupPrompt.system(dictionary: []).contains("Style for the app"))
        XCTAssertFalse(CleanupPrompt.system(dictionary: [], appStyle: "  ").contains("Style for the app"))
        let prompt = CleanupPrompt.system(dictionary: [], appStyle: "Formal email.")
        XCTAssertTrue(prompt.contains("Style for the app this text is going into: Formal email."))
    }

    func testRewritePromptEmbedsInstruction() {
        let prompt = CleanupPrompt.rewrite(instruction: " a bullet list ")
        XCTAssertTrue(prompt.contains("instruction: a bullet list."))
        XCTAssertTrue(prompt.contains("ONLY the edited text"))
    }
}
