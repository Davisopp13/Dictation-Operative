import AppKit
import XCTest
@testable import Dictation

/// These run inside the real app host, so `sendOpenSettings` exercises the
/// actual responder chain the onboarding window would reach — the part that
/// cannot be checked by reading the code.
@MainActor
final class SettingsRouterTests: XCTestCase {
    func testEveryPaneHasAStableIdentifier() {
        XCTAssertEqual(SettingsPane.sync.rawValue, "sync")
        XCTAssertEqual(SettingsPane.allCases.count, 6)
        XCTAssertEqual(Set(SettingsPane.allCases.map(\.id)).count, 6)
    }

    func testOpeningSyncSelectsTheSyncPane() {
        let router = SettingsRouter.shared
        router.pane = .general
        router.openSettings(pane: .sync)
        // Whether a window actually appears cannot be checked here: an XCTest
        // host never becomes frontmost, and SwiftUI will not present the
        // Settings scene in the background. `DictationUITests` covers that.
        XCTAssertEqual(
            router.pane, .sync,
            "the pane must be selected before the window opens, or Settings comes up on General"
        )
    }

    /// The responder-chain send is only `SettingsRouter`'s fallback: in this
    /// menu-bar-only app it is accepted and then presents nothing, which
    /// `DictationUITests` proved and which is why onboarding registers
    /// SwiftUI's `openSettings` action instead. This still checks that a
    /// responder exists at all, so the fallback stays a fallback rather than
    /// becoming a hard error.
    func testApplicationAcceptsTheOpenSettingsAction() {
        XCTAssertTrue(
            SettingsRouter.sendOpenSettings(),
            "no responder accepted showSettingsWindow: — the Sync shortcut would do nothing"
        )
    }
}
