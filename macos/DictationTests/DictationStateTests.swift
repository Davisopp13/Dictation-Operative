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
            .idle, .recording(start: Date()), .transcribing, .cleaning, .inserting,
            .needsSetup("Setup"), .error("x"),
        ]
        for state in states {
            XCTAssertFalse(state.symbolName.isEmpty)
            XCTAssertFalse(state.label.isEmpty)
        }
    }

    func testErrorLabelCarriesMessage() {
        XCTAssertEqual(DictationState.error("No mic").label, "No mic")
    }

    func testNeedsSetupIsItsOwnStateAndNotAnError() {
        let state = DictationState.needsSetup("Needs the microphone")
        XCTAssertTrue(state.needsSetup)
        XCTAssertFalse(state.isError)
        XCTAssertFalse(state.isProcessing)
        XCTAssertEqual(state.label, "Needs the microphone")
    }

    func testIndeterminateStates() {
        XCTAssertTrue(DictationState.transcribing.isIndeterminate)
        XCTAssertTrue(DictationState.cleaning.isIndeterminate)
        XCTAssertFalse(DictationState.inserting.isIndeterminate)
        XCTAssertFalse(DictationState.idle.isIndeterminate)
    }

    func testUnknownErrorsAreNotShownRaw() {
        struct Underlying: Error { }
        XCTAssertEqual(DictationError.displayMessage(for: Underlying()), DictationError.genericMessage)
        XCTAssertEqual(
            DictationError.displayMessage(for: DictationError.noAudioInput),
            DictationError.noAudioInput.message
        )
    }
}
