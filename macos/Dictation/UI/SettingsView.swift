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
            DictationSettingsTab()
                .tabItem { Label("Dictation", systemImage: "waveform") }
            WritingSettingsTab()
                .tabItem { Label("Writing", systemImage: "wand.and.stars") }
            CommandsSettingsTab()
                .tabItem { Label("Commands", systemImage: "text.bubble") }
            SyncSettingsView()
                .tabItem { Label("Sync", systemImage: "arrow.triangle.2.circlepath") }
            HistorySettingsTab()
                .tabItem { Label("History", systemImage: "clock") }
        }
        // Resizable, with a floor rather than a hard frame: these panes hold
        // lists that grow (models, dictionary, per-app rules) and shouldn't be
        // trapped inside a small fixed window.
        .frame(
            minWidth: Tokens.Size.settingsMinimum.width,
            idealWidth: Tokens.Size.settings.width,
            minHeight: Tokens.Size.settingsMinimum.height,
            idealHeight: Tokens.Size.settings.height
        )
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
                Picker("Dictation key:", selection: $settings.modifierHotkey) {
                    ForEach(ModifierHotkey.allCases) { hotkey in
                        Text(hotkey.displayName).tag(hotkey)
                    }
                }
                .onChange(of: settings.modifierHotkey) { _, newValue in
                    AppServices.shared.hotkeys?.updateModifierHotkey(newValue)
                }
                Text("Default: ⌃⌥ Control + Option. Tap it to toggle, or hold it to talk (release inserts). Automatically cancelled when the keys are used as part of another shortcut.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
                KeyboardShortcuts.Recorder("Extra toggle shortcut:", name: .toggleDictation)
                KeyboardShortcuts.Recorder("Extra hold-to-talk shortcut:", name: .pushToTalk)
                Text("Optional key combos, unbound by default. All bound hotkeys are active at once. A quick tap of the hold-to-talk combo acts as a toggle.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            }
            Section("Startup") {
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
            Section("Setup") {
                Button("Open Setup & Permissions…") {
                    AppServices.shared.showOnboarding()
                }
                Text("Microphone and accessibility access, and the speech model download.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Dictation (model, language, insertion)

private struct DictationSettingsTab: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(ModelManager.self) private var modelManager

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section("On-device transcription models") {
                ForEach(ModelCatalog.entries) { entry in
                    ModelRow(entry: entry)
                }
                if let error = modelManager.lastDownloadError {
                    Text(error).font(.caption).foregroundStyle(Tokens.Brand.danger)
                }
                Text("Models are stored in ~/Library/Application Support/Dictation/Models.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            }
            Section("Transcription") {
                Picker("Language:", selection: $settings.language) {
                    Text("English").tag("en")
                    Text("Auto-detect").tag("auto")
                }
                Text("Auto-detect requires a multilingual model (Large v3 Turbo).")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
                Toggle("Show live transcript while recording", isOn: $settings.livePreviewEnabled)
                Text("Re-transcribes the last 30 seconds about once a second and shows it in the floating indicator. Text is still inserted only when you stop. Turn off to save battery.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            }
            Section("Text insertion") {
                Picker("Method:", selection: $settings.insertionMode) {
                    ForEach(InsertionMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                Text("Terminals and some editor apps (Codex, Claude Code) ignore the Accessibility method — they're always pasted. Choose “Always paste” if text won't insert elsewhere.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            }
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
                Text(entry.approxSize).font(.caption).foregroundStyle(Tokens.Chrome.secondaryText)
            }
            Spacer()
            if let progress = modelManager.downloadProgress[entry.variant] {
                ProgressView(value: progress)
                    .frame(width: 100)
            } else if modelManager.isDownloaded(entry.variant) {
                if settings.selectedModelVariant == entry.variant {
                    Label("Active", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Tokens.Brand.success)
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

// MARK: - Writing (AI cleanup + dictionary)

/// What the interface knows about the key in the Keychain right now. The key
/// itself is still written on every keystroke, exactly as before — this only
/// says so out loud.
private enum APIKeyStatus: Equatable {
    case absent
    case saved
    case verified
    case failed(String)
}

private struct WritingSettingsTab: View {
    @Environment(SettingsStore.self) private var settings
    @State private var apiKey: String = ""
    @State private var keyStatus: APIKeyStatus = .absent
    @State private var testing = false
    @State private var newWord = ""

    private var kind: CleanupProviderKind { settings.cleanupProvider }

    private var modelBinding: Binding<String> {
        Binding(
            get: { settings.cleanupModel(for: kind) },
            set: { settings.setCleanupModel($0, for: kind) }
        )
    }

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section("AI cleanup") {
                Toggle("Clean up transcripts with AI", isOn: $settings.cleanupEnabled)
                Picker("Provider:", selection: $settings.cleanupProvider) {
                    ForEach(CleanupProviderKind.allCases) { kind in
                        Text(kind.displayName).tag(kind)
                    }
                }
                .onChange(of: settings.cleanupProvider) { _, newKind in
                    apiKey = KeychainHelper.get(newKind.keychainAccount) ?? ""
                    keyStatus = apiKey.isEmpty ? .absent : .saved
                }
                Text(kind.help)
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
                TextField("Model:", text: modelBinding, prompt: Text(kind.defaultModel))
                if kind == .local {
                    TextField("Server URL:", text: $settings.localCleanupBaseURL,
                              prompt: Text(CleanupProviderKind.local.defaultBaseURL ?? ""))
                }
            }

            Section("API key") {
                HStack {
                    SecureField(kind.requiresAPIKey ? "API key:" : "API key (optional):", text: $apiKey)
                        .onChange(of: apiKey) { _, newValue in
                            if newValue.isEmpty {
                                KeychainHelper.delete(kind.keychainAccount)
                                keyStatus = .absent
                            } else {
                                KeychainHelper.set(newValue, for: kind.keychainAccount)
                                // Editing invalidates an earlier verification.
                                keyStatus = .saved
                            }
                        }
                    if let console = kind.consoleURL {
                        Link("Get a key", destination: console)
                            .font(.caption)
                    }
                }
                HStack {
                    keyStatusLabel
                    Spacer()
                    Button(testing ? "Testing…" : "Test Connection") {
                        testConnection()
                    }
                    .disabled(testing || (kind.requiresAPIKey && apiKey.isEmpty))
                }
                Text("Keys are stored in the Keychain. If cleanup fails or times out, the raw transcript is inserted instead — dictation never blocks on the network.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            }

            Section("Custom dictionary") {
                HStack {
                    TextField("Add a word or name (e.g. Hapag-Lloyd)", text: $newWord)
                        .onSubmit(addWord)
                    Button("Add", action: addWord)
                        .disabled(newWord.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if settings.customDictionary.isEmpty {
                    Text("Names and terms added here are passed to the cleanup model so it spells them the way you do.")
                        .font(.caption)
                        .foregroundStyle(Tokens.Chrome.secondaryText)
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
                        .accessibilityLabel("Remove \(word)")
                    }
                }
            }
        }
        .formStyle(.grouped)
        .onAppear {
            apiKey = KeychainHelper.get(kind.keychainAccount) ?? ""
            keyStatus = apiKey.isEmpty ? .absent : .saved
        }
    }

    @ViewBuilder
    private var keyStatusLabel: some View {
        switch keyStatus {
        case .absent:
            if kind.requiresAPIKey {
                Label("No key saved", systemImage: "key")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            } else {
                Text("Optional for this provider.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            }
        case .saved:
            Label("Saved to Keychain", systemImage: "checkmark.circle")
                .font(.caption)
                .foregroundStyle(Tokens.Chrome.secondaryText)
        case .verified:
            Label("Saved and verified", systemImage: "checkmark.seal.fill")
                .font(.caption)
                .foregroundStyle(Tokens.Brand.success)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle")
                .font(.caption)
                .foregroundStyle(Tokens.Brand.danger)
                .lineLimit(2)
        }
    }

    private func addWord() {
        let word = newWord.trimmingCharacters(in: .whitespaces)
        guard !word.isEmpty, !settings.customDictionary.contains(word) else { return }
        settings.customDictionary.append(word)
        newWord = ""
    }

    private func testConnection() {
        testing = true
        let service = CleanupProviderFactory.make(
            kind: kind,
            apiKey: apiKey,
            model: settings.cleanupModel(for: kind),
            baseURL: settings.cleanupBaseURL(for: kind)
        )
        Task {
            let result = await service.testConnection()
            switch result {
            case .success:
                keyStatus = .verified
            case .failure(let error):
                keyStatus = .failed(error.localizedDescription)
            }
            testing = false
        }
    }
}

// MARK: - Commands (voice commands + per-app tone)

private struct CommandsSettingsTab: View {
    @Environment(SettingsStore.self) private var settings
    @State private var newRuleBundleID = ""
    @State private var newRulePresetID = AppStyle.presets.first?.id ?? "casual"
    @State private var runningApps: [RunningApp] = []

    private struct RunningApp: Identifiable {
        let name: String
        let bundleID: String
        var id: String { bundleID }
    }

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section("Voice commands") {
                Toggle("Edit the last dictation with spoken commands", isOn: $settings.voiceCommandsEnabled)
                Text("Say “scratch that”, “delete last sentence”, “delete last word”, “make that uppercase”, or an instruction like “make that a bullet list” / “make that more formal” (those need an AI provider). Works within two minutes of the last dictation, in the same app, while the cursor is still right after it.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            }

            Section("Per-app style") {
                Toggle("Adjust tone by app", isOn: $settings.appContextEnabled)
                Text("Opt-in. Adds a one-line style hint to the cleanup prompt based on which app you're dictating into. Only the app's bundle identifier is used — no window titles or screen content.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Chrome.secondaryText)
            }

            Section("Rules") {
                if settings.appStyles.isEmpty {
                    ContentUnavailableView {
                        Label("No tone rules", systemImage: "text.bubble")
                    } description: {
                        Text("Add a rule below to give one app its own tone, or start from the suggested set.")
                    }
                } else {
                    ForEach(settings.appStyles.keys.sorted(), id: \.self) { bundleID in
                        HStack(alignment: .top) {
                            Text(bundleID)
                                .font(.caption)
                                .frame(width: 170, alignment: .leading)
                                .lineLimit(2)
                            TextField("Style", text: styleBinding(for: bundleID), axis: .vertical)
                                .lineLimit(1...3)
                            Button {
                                settings.appStyles[bundleID] = nil
                            } label: {
                                Image(systemName: "minus.circle")
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Remove rule for \(bundleID)")
                        }
                    }
                }
                HStack {
                    Picker("App:", selection: $newRuleBundleID) {
                        Text("Choose…").tag("")
                        ForEach(runningApps) { app in
                            Text(app.name).tag(app.bundleID)
                        }
                    }
                    Picker("Style:", selection: $newRulePresetID) {
                        ForEach(AppStyle.presets) { preset in
                            Text(preset.name).tag(preset.id)
                        }
                    }
                    Button("Add", action: addRule)
                        .disabled(newRuleBundleID.isEmpty)
                }
                HStack {
                    Button("Add suggested rules") {
                        settings.appStyles.merge(AppStyle.suggestedRules) { current, _ in current }
                    }
                    Text("Slack, Messages, Mail, Outlook, VS Code, Terminal, Notes…")
                        .font(.caption)
                        .foregroundStyle(Tokens.Chrome.secondaryText)
                }
            }
        }
        .formStyle(.grouped)
        .onAppear(perform: refreshRunningApps)
    }

    private func styleBinding(for bundleID: String) -> Binding<String> {
        Binding(
            get: { settings.appStyles[bundleID] ?? "" },
            set: { settings.appStyles[bundleID] = $0 }
        )
    }

    private func addRule() {
        guard !newRuleBundleID.isEmpty, let preset = AppStyle.preset(newRulePresetID) else { return }
        settings.appStyles[newRuleBundleID] = preset.text
        newRuleBundleID = ""
    }

    private func refreshRunningApps() {
        runningApps = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular }
            .compactMap { app -> RunningApp? in
                guard let id = app.bundleIdentifier, let name = app.localizedName else { return nil }
                return RunningApp(name: name, bundleID: id)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
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
        Form {
            if history.entries.isEmpty {
                Section {
                    ContentUnavailableView(
                        "No dictations yet",
                        systemImage: "clock",
                        description: Text("Your transcripts will appear here.")
                    )
                }
            } else {
                Section("Dictations") {
                    ForEach(history.entries) { entry in
                        VStack(alignment: .leading, spacing: Tokens.Space.xxs) {
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
                            .foregroundStyle(Tokens.Chrome.secondaryText)
                        }
                        .padding(.vertical, 2)
                    }
                }
                Section {
                    HStack {
                        Spacer()
                        Button("Clear History", role: .destructive) {
                            history.clear()
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}
