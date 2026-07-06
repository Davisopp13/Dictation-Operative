import AppKit
import KeyboardShortcuts
import os
import ServiceManagement
import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettingsTab()
                .tabItem { Label("General", systemImage: "gearshape") }
            ModelSettingsTab()
                .tabItem { Label("Model", systemImage: "waveform") }
            CleanupSettingsTab()
                .tabItem { Label("Cleanup", systemImage: "wand.and.stars") }
            HistorySettingsTab()
                .tabItem { Label("History", systemImage: "clock") }
        }
        .frame(width: 520, height: 420)
    }
}

// MARK: - General

private struct GeneralSettingsTab: View {
    @Environment(SettingsStore.self) private var settings
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section("Hotkeys") {
                KeyboardShortcuts.Recorder("Toggle (press to start / stop):", name: .toggleDictation)
                KeyboardShortcuts.Recorder("Hold to talk (release to insert):", name: .pushToTalk)
                Text("Both hotkeys are always active — use whichever you prefer, or clear one. A quick tap of the hold-to-talk key acts as a toggle. Note: bind these to key combinations (holding a single modifier like Fn isn't supported yet).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Transcription") {
                Picker("Language:", selection: $settings.language) {
                    Text("English").tag("en")
                    Text("Auto-detect").tag("auto")
                }
                Text("Auto-detect requires a multilingual model (Large v3 Turbo).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Text insertion") {
                Picker("Method:", selection: $settings.insertionMode) {
                    ForEach(InsertionMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                Text("Terminals and some editor apps (Codex, Claude Code) ignore the Accessibility method — they're always pasted. Choose “Always paste” if text won't insert elsewhere.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                Toggle("Launch at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, enabled in
                        do {
                            if enabled {
                                try SMAppService.mainApp.register()
                            } else {
                                try SMAppService.mainApp.unregister()
                            }
                        } catch {
                            Log.app.error("Launch-at-login change failed: \(error.localizedDescription)")
                            launchAtLogin = SMAppService.mainApp.status == .enabled
                        }
                    }
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Model

private struct ModelSettingsTab: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(ModelManager.self) private var modelManager

    var body: some View {
        Form {
            Section("On-device transcription models") {
                ForEach(ModelCatalog.entries) { entry in
                    ModelRow(entry: entry)
                }
            }
            if let error = modelManager.lastDownloadError {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            Text("Models are stored in ~/Library/Application Support/Dictation/Models.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
    }
}

private struct ModelRow: View {
    let entry: ModelCatalog.Entry
    @Environment(SettingsStore.self) private var settings
    @Environment(ModelManager.self) private var modelManager

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(entry.displayName)
                Text(entry.approxSize).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if let progress = modelManager.downloadProgress[entry.variant] {
                ProgressView(value: progress)
                    .frame(width: 100)
            } else if modelManager.isDownloaded(entry.variant) {
                if settings.selectedModelVariant == entry.variant {
                    Label("Active", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else {
                    Button("Use") {
                        AppServices.shared.activateModel(variant: entry.variant)
                    }
                    Button("Delete", role: .destructive) {
                        modelManager.delete(entry.variant)
                    }
                }
            } else {
                Button("Download") {
                    Task { await modelManager.download(entry.variant) }
                }
            }
        }
    }
}

// MARK: - Cleanup

private struct CleanupSettingsTab: View {
    @Environment(SettingsStore.self) private var settings
    @State private var apiKey: String = KeychainHelper.get(KeychainHelper.groqAPIKey) ?? ""
    @State private var testResult: String?
    @State private var testing = false
    @State private var newWord = ""

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section("AI cleanup (Groq)") {
                Toggle("Clean up transcripts with AI", isOn: $settings.cleanupEnabled)
                TextField("Model:", text: $settings.cleanupModel)
                SecureField("Groq API key:", text: $apiKey)
                    .onChange(of: apiKey) { _, newValue in
                        if newValue.isEmpty {
                            KeychainHelper.delete(KeychainHelper.groqAPIKey)
                        } else {
                            KeychainHelper.set(newValue, for: KeychainHelper.groqAPIKey)
                        }
                    }
                HStack {
                    Button(testing ? "Testing…" : "Test Connection") {
                        testConnection()
                    }
                    .disabled(testing || apiKey.isEmpty)
                    if let testResult {
                        Text(testResult).font(.caption)
                    }
                }
                Text("If cleanup fails or times out, the raw transcript is inserted instead — dictation never blocks on the network.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Custom dictionary") {
                HStack {
                    TextField("Add a word or name (e.g. Hapag-Lloyd)", text: $newWord)
                        .onSubmit(addWord)
                    Button("Add", action: addWord)
                        .disabled(newWord.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                ForEach(settings.customDictionary, id: \.self) { word in
                    HStack {
                        Text(word)
                        Spacer()
                        Button {
                            settings.customDictionary.removeAll { $0 == word }
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private func addWord() {
        let word = newWord.trimmingCharacters(in: .whitespaces)
        guard !word.isEmpty, !settings.customDictionary.contains(word) else { return }
        settings.customDictionary.append(word)
        newWord = ""
    }

    private func testConnection() {
        testing = true
        testResult = nil
        let service = GroqCleanupService(apiKey: apiKey, model: settings.cleanupModel)
        Task {
            let result = await service.testConnection()
            switch result {
            case .success:
                testResult = "✓ Connected"
            case .failure(let error):
                testResult = "✗ \(error.localizedDescription)"
            }
            testing = false
        }
    }
}

// MARK: - History

private struct HistorySettingsTab: View {
    @Environment(HistoryStore.self) private var history

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading) {
            if history.entries.isEmpty {
                ContentUnavailableView(
                    "No dictations yet",
                    systemImage: "clock",
                    description: Text("Your transcripts will appear here.")
                )
            } else {
                List(history.entries) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.displayText)
                            .lineLimit(3)
                        HStack {
                            Text(Self.dateFormatter.string(from: entry.date))
                            if let app = entry.appBundleID {
                                Text("· \(app)")
                            }
                            Spacer()
                            Button("Copy") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(entry.displayText, forType: .string)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
                HStack {
                    Spacer()
                    Button("Clear History", role: .destructive) {
                        history.clear()
                    }
                }
                .padding([.horizontal, .bottom])
            }
        }
    }
}
