import SwiftUI

@main
struct DictationApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    private let services = AppServices.shared

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environment(services.sync)
                .environment(services.controller)
                .environment(services.settings)
                .environment(services.history)
                .environment(services.updater)
        } label: {
            // Ready is a plain template symbol, quiet like every other menu bar
            // extra. Listening, working and needs-setup carry a semantic tint so
            // the state is readable at a glance. See `Tokens.menuBarImage`.
            if let image = Tokens.menuBarImage(for: services.controller.state) {
                Image(nsImage: image)
                    .renderingMode(image.isTemplate ? .template : .original)
                    .accessibilityLabel(services.controller.state.label)
            } else {
                Image(systemName: services.controller.state.symbolName)
            }
        }

        Settings {
            SettingsView()
                .environment(services.sync)
                .environment(services.controller)
                .environment(services.settings)
                .environment(services.permissions)
                .environment(services.modelManager)
                .environment(services.history)
        }
    }
}
