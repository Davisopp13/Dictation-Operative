import AppKit
import Observation
import SwiftUI

/// The Settings tabs, in the order `SettingsView` shows them.
enum SettingsPane: String, CaseIterable, Identifiable {
    case general
    case dictation
    case writing
    case commands
    case sync
    case history

    var id: String { rawValue }
}

/// Which pane Settings is showing. Held outside `SettingsView` so the rest of
/// the app can open Settings on a particular pane — onboarding's "Set up Sync
/// instead" needs to reach Sync without finishing dictation setup.
@MainActor
@Observable
final class SettingsRouter {
    static let shared = SettingsRouter()

    var pane: SettingsPane = .general

    private init() {}

    /// Selects `pane`, then opens the Settings scene with SwiftUI's own
    /// `openSettings` action. The selection is set first so the window comes up
    /// already on that pane.
    ///
    /// Callers pass the action from their environment. That is not a nicety:
    /// onboarding lives in a plain AppKit window outside the `Settings` scene,
    /// and the obvious AppKit route — sending `showSettingsWindow:` through the
    /// responder chain — is *accepted* by a responder in this menu-bar-only app
    /// (`sendAction` returns true) and then presents nothing at all.
    /// `DictationUITests` caught exactly that. Onboarding is still a SwiftUI
    /// view, so it has `@Environment(\.openSettings)`, and that does present.
    ///
    /// The presentation is deferred by one turn of the run loop on purpose. An
    /// accessory app activates asynchronously, and SwiftUI will not present the
    /// Settings scene while the app is still in the background.
    func openSettings(pane: SettingsPane, using open: OpenSettingsAction) {
        self.pane = pane
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async {
            open()
        }
    }

    /// Fallback for callers with no SwiftUI environment to draw on. Selects the
    /// pane and asks the responder chain, which is unreliable here — see
    /// `sendOpenSettings`. Prefer `openSettings(pane:using:)`.
    func openSettings(pane: SettingsPane) {
        self.pane = pane
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async {
            if !Self.sendOpenSettings() {
                Log.app.error(
                    "No responder accepted the open-Settings action for the \(pane.rawValue, privacy: .public) pane."
                )
            }
        }
    }

    /// Sends the Settings-opening action to the responder chain. Returns
    /// whether anything accepted it.
    ///
    /// A `true` result means a responder took the action, **not** that a window
    /// appeared. In this accessory app the two come apart: the action is
    /// accepted and nothing is presented, which is why the primary route takes
    /// an `OpenSettingsAction` instead.
    ///
    /// The selector was renamed in macOS 13; the deployment target is 14, but
    /// both are attempted so a future rename is a logged failure rather than a
    /// silent no-op.
    @discardableResult
    static func sendOpenSettings() -> Bool {
        for name in ["showSettingsWindow:", "showPreferencesWindow:"] {
            if NSApp.sendAction(Selector((name)), to: nil, from: nil) {
                return true
            }
        }
        return false
    }
}
