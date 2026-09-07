import AppKit
import SwiftUI

struct MenuBarView: View {
    @Environment(SyncService.self) private var sync
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
        } else if controller.state.needsSetup {
            // Setup is offered, never forced open over what you were typing.
            Button("Open Setup…") { controller.openSetup() }
            Button("Try Again") { controller.toggle() }
        } else {
            Button("Start Dictation") { controller.toggle() }
        }

        Divider()

        if let last = controller.lastTranscript {
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(last, forType: .string)
            } label: {
                Text("Copy Last: \(last.menuTruncated)")
            }
        }

        Menu("Sync") {
            Text(sync.status)
            if let error = sync.error { Text(error) }
            Button("Send clipboard", action: sync.sendClipboard).disabled(!sync.available)
            Button("Receive latest", action: sync.receiveLatest).disabled(!sync.available)
            if let last = controller.lastTranscript {
                Button("Send last dictation") { sync.sendText(last) }.disabled(!sync.available)
            }
            Button(sync.config.paused ? "Resume Sync" : "Pause Sync") { sync.config.paused.toggle(); sync.persist(reset: true) }.disabled(sync.busy)
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
                    Text(entry.displayText.menuTruncated)
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

        Button("About Dictation") {
            NSApp.activate(ignoringOtherApps: true)
            NSApp.orderFrontStandardAboutPanel(nil)
        }

        Button("Quit Dictation") {
            NSApp.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}

private extension String {
    /// Menu items stay on one line: 40 characters, then an ellipsis.
    var menuTruncated: String {
        count > 40 ? String(prefix(40)) + "…" : self
    }
}
