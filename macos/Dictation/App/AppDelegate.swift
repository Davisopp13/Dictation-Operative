import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Unit-test hosts must not register hotkeys, prompt for permissions,
        // open onboarding, or start background services alongside the installed app.
        guard ProcessInfo.processInfo.environment["DICTATION_TEST_HOST"] != "1" else { return }
        AppServices.shared.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}
