import XCTest
@testable import Dictation

final class DictationStateTests: XCTestCase {
    func testRecordingPredicates() {
        XCTAssertTrue(DictationState.recording(start: Date()).isRecording)
        XCTAssertFalse(DictationState.idle.isRecording)
        XCTAssertFalse(DictationState.transcribing.isRecording)
    }

    func testProcessingPredicates() {
        XCTAssertTrue(DictationState.transcribing.isProcessing)
        XCTAssertTrue(DictationState.cleaning.isProcessing)
        XCTAssertTrue(DictationState.inserting.isProcessing)
        XCTAssertFalse(DictationState.idle.isProcessing)
        XCTAssertFalse(DictationState.recording(start: Date()).isProcessing)
        XCTAssertFalse(DictationState.error("boom").isProcessing)
    }

    func testEverySymbolNameIsNonEmpty() {
        let states: [DictationState] = [
            .idle, .recording(start: Date()), .transcribing, .cleaning, .inserting, .error("x"),
        ]
        for state in states {
            XCTAssertFalse(state.symbolName.isEmpty)
            XCTAssertFalse(state.label.isEmpty)
        }
    }

    func testErrorLabelCarriesMessage() {
        XCTAssertEqual(DictationState.error("No mic").label, "No mic")
    }
}
