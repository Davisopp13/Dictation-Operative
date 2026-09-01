import AppKit
import SwiftUI

struct MenuBarView: View {
    @Environment(DictationController.self) private var controller
    @Environment(SettingsStore.self) private var settings
    @Environment(HistoryStore.self) private var history
    @Environment(UpdaterService.self) private var updater
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Text(controller.state.label)

        if controller.state.isRecording {
            Button("Stop & Insert") { controller.stopAndProcess() }
            Button("Cancel Recording") { controller.cancel() }
        } else if controller.state.isProcessing {
            Button("Cancel") { controller.cancel() }
        } else {
            Button("Start Dictation") { controller.toggle() }
        }

        Divider()

        if let last = controller.lastTranscript {
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(last, forType: .string)
            } label: {
                Text("Copy Last: \(String(last.prefix(40)))\(last.count > 40 ? "…" : "")")
            }
        }

        Menu("Recent History") {
            if history.entries.isEmpty {
                Text("No dictations yet")
            }
            ForEach(history.entries.prefix(8)) { entry in
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(entry.displayText, forType: .string)
                } label: {
                    Text("\(String(entry.displayText.prefix(40)))\(entry.displayText.count > 40 ? "…" : "")")
                }
            }
        }

        Divider()

        Button("Settings…") {
            NSApp.activate(ignoringOtherApps: true)
            openSettings()
        }
        .keyboardShortcut(",")

        Button("Setup / Permissions…") {
            AppServices.shared.showOnboarding()
        }

        if updater.isConfigured {
            Button("Check for Updates…") {
                updater.checkForUpdates()
            }
            .disabled(!updater.canCheckForUpdates)
        }

        Divider()

        Button("Quit Dictation") {
            NSApp.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}
