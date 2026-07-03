import SwiftUI

@main
struct DictationApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    private let services = AppServices.shared

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environment(services.controller)
                .environment(services.settings)
                .environment(services.history)
        } label: {
            Image(systemName: services.controller.state.symbolName)
        }

        Settings {
            SettingsView()
                .environment(services.controller)
                .environment(services.settings)
                .environment(services.permissions)
                .environment(services.modelManager)
                .environment(services.history)
        }
    }
}
