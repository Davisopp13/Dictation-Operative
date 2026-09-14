import AppKit
import SwiftUI

/// Hosts the onboarding flow in a plain AppKit window — reliable to open from
/// an accessory (menu-bar-only) app at launch, unlike SwiftUI Window scenes.
@MainActor
final class OnboardingWindowController: NSWindowController {
    convenience init(services: AppServices) {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Tokens.Size.onboarding),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Dictation Setup"
        window.isReleasedWhenClosed = false
        window.center()
        self.init(window: window)

        let root = OnboardingView(initialStep: SetupProgress.initialStep(
            completed: services.settings.onboardingCompleted,
            microphone: services.permissions.micGranted,
            accessibility: services.permissions.accessibilityGranted,
            model: services.modelManager.isDownloaded(services.settings.selectedModelVariant)
        ), onFinished: { [weak window] in
            window?.close()
        })
        .environment(services.settings)
        .environment(services.permissions)
        .environment(services.modelManager)
        window.contentViewController = NSHostingController(rootView: root)
    }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}
