import XCTest
@testable import Dictation
final class SetupProgressTests: XCTestCase {
    func testNewUserGetsWelcome() {
        XCTAssertEqual(SetupProgress.initialStep(completed: false, microphone: true, accessibility: true, model: true), 0)
    }
    func testReturningUserGetsFirstMissingPermission() {
        XCTAssertEqual(SetupProgress.initialStep(completed: true, microphone: false, accessibility: false, model: false), 1)
        XCTAssertEqual(SetupProgress.initialStep(completed: true, microphone: true, accessibility: false, model: true), 2)
        XCTAssertEqual(SetupProgress.initialStep(completed: true, microphone: true, accessibility: true, model: false), 3)
        XCTAssertEqual(SetupProgress.initialStep(completed: true, microphone: true, accessibility: true, model: true), 4)
    }
    func testBlockingStepsOfferSyncEscape() {
        for step in 1...3 {
            XCTAssertTrue(SetupProgress.offersSyncEscape(step: step, canContinue: false))
            XCTAssertFalse(SetupProgress.offersSyncEscape(step: step, canContinue: true))
        }
        XCTAssertFalse(SetupProgress.offersSyncEscape(step: 0, canContinue: false))
        XCTAssertFalse(SetupProgress.offersSyncEscape(step: 4, canContinue: false))
    }
}
