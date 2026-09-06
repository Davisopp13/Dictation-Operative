import XCTest
@testable import Dictation

final class LivePreviewTests: XCTestCase {
    func testFirstHypothesisIsAllPending() {
        var state = LivePreviewState()
        state.update(with: "hello world")
        XCTAssertEqual(state.confirmedText, "")
        XCTAssertEqual(state.pendingText, "hello world")
        XCTAssertEqual(state.displayText, "hello world")
    }

    func testSharedPrefixBecomesConfirmed() {
        var state = LivePreviewState()
        state.update(with: "hello world this is")
        state.update(with: "hello world this is a test")
        XCTAssertEqual(state.confirmedText, "hello world this is")
        XCTAssertEqual(state.pendingText, "a test")
    }

    func testConfirmedDoesNotRegressOnFlickeringTail() {
        var state = LivePreviewState()
        state.update(with: "hello world this")
        state.update(with: "hello world this is")
        XCTAssertEqual(state.confirmedCount, 3)
        // A later pass re-hears the middle; confirmed count is kept.
        state.update(with: "hello world these are")
        XCTAssertEqual(state.confirmedCount, 3)
        XCTAssertEqual(state.displayText, "hello world these are")
    }

    func testConfirmedIsClampedToHypothesisLength() {
        var state = LivePreviewState()
        state.update(with: "one two three four")
        state.update(with: "one two three four")
        XCTAssertEqual(state.confirmedCount, 4)
        state.update(with: "one two")
        XCTAssertEqual(state.confirmedCount, 2)
    }

    func testWhitespaceIsNormalised() {
        var state = LivePreviewState()
        state.update(with: "  hello   world \n")
        XCTAssertEqual(state.displayText, "hello world")
    }

    func testResetClearsEverything() {
        var state = LivePreviewState()
        state.update(with: "hello")
        state.update(with: "hello there")
        state.reset()
        XCTAssertTrue(state.isEmpty)
        XCTAssertEqual(state.confirmedCount, 0)
    }
}
