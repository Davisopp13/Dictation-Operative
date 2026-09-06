import XCTest
@testable import Dictation

final class VoiceCommandTests: XCTestCase {
    // MARK: Parsing

    func testDeletePhrases() {
        XCTAssertEqual(VoiceCommand.parse("Scratch that."), .deleteLast)
        XCTAssertEqual(VoiceCommand.parse("undo that"), .deleteLast)
        XCTAssertEqual(VoiceCommand.parse("Delete the last one!"), .deleteLast)
    }

    func testDeleteLastSentenceAndWord() {
        XCTAssertEqual(VoiceCommand.parse("delete last sentence"), .deleteLastSentence)
        XCTAssertEqual(VoiceCommand.parse("Remove the last sentence."), .deleteLastSentence)
        XCTAssertEqual(VoiceCommand.parse("scratch the last word"), .deleteLastWord)
    }

    func testCaseCommands() {
        XCTAssertEqual(VoiceCommand.parse("make that uppercase"), .uppercase)
        XCTAssertEqual(VoiceCommand.parse("Make that all caps"), .uppercase)
        XCTAssertEqual(VoiceCommand.parse("make it lowercase"), .lowercase)
    }

    func testRewriteCapturesInstruction() {
        XCTAssertEqual(
            VoiceCommand.parse("Make that a bullet list."),
            .rewrite(instruction: "a bullet list")
        )
        XCTAssertEqual(
            VoiceCommand.parse("turn this more formal"),
            .rewrite(instruction: "more formal")
        )
    }

    func testOrdinaryDictationIsNotACommand() {
        XCTAssertNil(VoiceCommand.parse("Hello world, this is a test."))
        XCTAssertNil(VoiceCommand.parse("I need to delete that file before the meeting tomorrow"))
        XCTAssertNil(VoiceCommand.parse(""))
    }

    func testLongCommandLikeSentencesAreIgnored() {
        let long = "make that a bullet list and then send it to everyone on the team before the end of the day please"
        XCTAssertNil(VoiceCommand.parse(long))
    }

    func testNormalizeStripsPunctuationAndCase() {
        XCTAssertEqual(VoiceCommand.normalize("  Scratch, THAT!  "), "scratch that")
    }

    // MARK: Applying

    func testDeterministicEdits() {
        XCTAssertEqual(VoiceCommand.deleteLast.apply(to: "Hello world."), "")
        XCTAssertEqual(VoiceCommand.uppercase.apply(to: "Hello"), "HELLO")
        XCTAssertEqual(VoiceCommand.lowercase.apply(to: "Hello"), "hello")
        XCTAssertNil(VoiceCommand.rewrite(instruction: "shorter").apply(to: "Hello"))
        XCTAssertTrue(VoiceCommand.rewrite(instruction: "x").needsProvider)
        XCTAssertFalse(VoiceCommand.deleteLast.needsProvider)
    }

    func testRemovingLastSentence() {
        XCTAssertEqual(
            TextEditing.removingLastSentence("First one. Second one! Third one?"),
            "First one. Second one!"
        )
        XCTAssertEqual(TextEditing.removingLastSentence("Only one sentence."), "")
    }

    func testRemovingLastWord() {
        XCTAssertEqual(TextEditing.removingLastWord("hello big world."), "hello big")
        XCTAssertEqual(TextEditing.removingLastWord("hello world  "), "hello")
        XCTAssertEqual(TextEditing.removingLastWord("hello"), "")
    }
}
