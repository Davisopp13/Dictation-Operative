import XCTest

/// Onboarding's "Set up Sync instead" escape hatch, proved against a really
/// launched app.
///
/// A unit test cannot cover this. An XCTest host never becomes frontmost, and
/// SwiftUI refuses to present the `Settings` scene while the app is in the
/// background — so the only way to know the button actually lands on the Sync
/// pane is to launch the app and click it.
final class SyncShortcutUITests: XCTestCase {

    /// Onboarding is shown by `AppServices.start()` when setup is incomplete.
    /// The NSUserDefaults *argument domain* overrides the persistent domain for
    /// this launch only and is never written to disk, so the machine's real
    /// settings — and its granted Microphone/Accessibility permissions — are
    /// left exactly as they were.
    ///
    /// - `-onboardingCompleted NO` — `SettingsStore` reads this with
    ///   `bool(forKey:)`, so "NO" makes `onboardingCompleted` false and
    ///   `AppServices.start()` opens the setup window at launch.
    /// - `-selectedModelVariant no-such-model` — `ModelManager.isDownloaded`
    ///   never matches it, so the Speech Model step can never be continued past
    ///   and `SetupProgress.offersSyncEscape` is true there.
    private static let launchArguments = [
        "-onboardingCompleted", "NO",
        "-selectedModelVariant", "no-such-model",
    ]

    private let onboardingWindowTitle = "Dictation Setup"

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testSyncEscapeFromOnboardingOpensSettingsOnSyncPane() {
        let app = XCUIApplication()
        app.launchArguments = Self.launchArguments
        // The scheme sets DICTATION_TEST_HOST=1 so the *unit* test host does not
        // start global services. A UI test needs the opposite: a fully started
        // app that opens onboarding.
        app.launchEnvironment["DICTATION_TEST_HOST"] = "0"
        app.launch()

        // 1. Onboarding window. A menu-bar-only app has no main window, so ask
        //    for it by title.
        let onboarding = app.windows[onboardingWindowTitle]
        XCTAssertTrue(
            onboarding.waitForExistence(timeout: 60),
            """
            FAILED AT STEP 1 (onboarding window): no window titled \
            "\(onboardingWindowTitle)" appeared within 60s. AppServices.start() \
            did not show onboarding — check that the launch arguments \
            \(Self.launchArguments) still match SettingsStore's keys.
            Windows seen: \(Self.windowTitles(of: app))
            """
        )

        // 2. Advance to a step that offers the escape hatch. Which step that is
        //    depends on what this machine has granted — `offersSyncEscape` fires
        //    on the first step whose requirement is unmet — so walk forward
        //    while Continue is enabled rather than assuming step 3.
        let escape = onboarding.buttons["onboarding.syncEscape"]
        let continueButton = onboarding.buttons["onboarding.continue"]

        for _ in 0..<5 {
            if escape.exists { break }
            guard continueButton.exists, continueButton.isEnabled else { break }
            continueButton.click()
        }

        XCTAssertTrue(
            escape.waitForExistence(timeout: 10),
            """
            FAILED AT STEP 2 (reaching the button): "Set up Sync instead" never \
            appeared while walking the wizard. Either the launch arguments no \
            longer leave a requirement unmet, or \
            SetupProgress.offersSyncEscape() changed.
            Onboarding window:
            \(onboarding.debugDescription)
            """
        )

        // 3. Click it.
        escape.click()

        // 4. A Settings window must appear, and the user must be able to see it.
        //    Both halves have failed here before: the responder-chain route was
        //    accepted and presented nothing, and once it did present, SwiftUI's
        //    `.fullScreenNone` collection behavior put the window on a Space the
        //    user was not looking at. XCUI only reports windows on the active
        //    Space, so this query covers both.
        guard let settings = waitForSettingsWindow(in: app, timeout: 30) else {
            XCTFail(
                """
                FAILED AT STEP 4 (Settings window): clicking "Set up Sync \
                instead" did not put a Settings window in front within 30s. \
                Either nothing presented the Settings scene, or it presented \
                onto another Space.
                Windows seen: \(Self.windowTitles(of: app))
                """
            )
            return
        }

        // 5. The point of the test: the *Sync* pane, not merely a window.
        //
        //    macOS does not expose AXSelected on the toolbar items SwiftUI
        //    builds from `.tabItem`, so "which tab is selected" has to be read
        //    off the two things the selection does drive: the Settings window is
        //    titled after the selected pane, and only the selected pane's
        //    content is in the accessibility tree. Both are checked, plus the
        //    absence of the pane Settings would have shown if the router had not
        //    set `pane` first (General).
        XCTAssertTrue(
            settings.toolbars.buttons["Sync"].exists,
            """
            FAILED AT STEP 5a (no Sync tab): the Settings window \
            "\(settings.title)" has no Sync tab at all, so SettingsView's tabs \
            have changed.
            Settings window:
            \(settings.debugDescription)
            """
        )

        XCTAssertEqual(
            settings.title, "Sync",
            """
            FAILED AT STEP 5b (wrong pane): Settings opened, but macOS titles \
            the window after the selected tab and this one says \
            "\(settings.title)". SettingsRouter set `pane` before presenting, \
            yet the TabView selection did not follow.
            Settings window:
            \(settings.debugDescription)
            """
        )

        for label in ["Trusted devices", "Pair another device"] {
            XCTAssertTrue(
                settings.staticTexts[label].waitForExistence(timeout: 5),
                """
                FAILED AT STEP 5c (Sync pane not shown): the Settings window is \
                titled Sync but "\(label)" — a section only SyncSettingsView \
                draws — is not on screen.
                Settings window:
                \(settings.debugDescription)
                """
            )
        }

        XCTAssertFalse(
            settings.buttons["Open Setup & Permissions…"].exists,
            """
            FAILED AT STEP 5d (General pane shown): the General pane's "Open \
            Setup & Permissions…" button is present, so Settings came up on \
            General rather than Sync.
            Settings window:
            \(settings.debugDescription)
            """
        )
    }

    // MARK: - Helpers

    /// The Settings window: the app's window that is not onboarding. Its title
    /// tracks the selected pane, so it cannot be looked up by name.
    private func waitForSettingsWindow(in app: XCUIApplication, timeout: TimeInterval) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for index in 0..<app.windows.count {
                let window = app.windows.element(boundBy: index)
                guard window.exists else { continue }
                let title = window.title
                if title != onboardingWindowTitle, !title.isEmpty {
                    return window
                }
            }
            _ = app.windows.firstMatch.waitForExistence(timeout: 0.5)
        } while Date() < deadline
        return nil
    }

    private static func windowTitles(of app: XCUIApplication) -> [String] {
        (0..<app.windows.count).map { app.windows.element(boundBy: $0).title }
    }
}
