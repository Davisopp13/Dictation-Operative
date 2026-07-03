import SwiftUI

/// First-run setup: welcome → microphone → accessibility → model download → try it.
struct OnboardingView: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(PermissionsManager.self) private var permissions
    @Environment(ModelManager.self) private var modelManager

    @State private var step = 0
    @State private var tryItText = ""

    var onFinished: (() -> Void)?

    init(onFinished: (() -> Void)? = nil) {
        self.onFinished = onFinished
    }

    var body: some View {
        VStack(spacing: 20) {
            content
            Spacer()
            navigation
        }
        .padding(28)
        .frame(width: 520, height: 480)
        .onAppear { permissions.startPolling() }
        .onDisappear { permissions.stopPolling() }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case 0: welcome
        case 1: microphone
        case 2: accessibility
        case 3: model
        default: tryIt
        }
    }

    private var welcome: some View {
        VStack(spacing: 14) {
            Image(systemName: "mic.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            Text("Welcome to Dictation").font(.title.bold())
            Text("Press a hotkey anywhere, speak, and cleaned-up text appears at your cursor. Transcription runs entirely on this Mac.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Text("Setup takes about a minute: microphone, accessibility, and a speech model.")
                .font(.callout)
                .multilineTextAlignment(.center)
        }
    }

    private var microphone: some View {
        StepView(
            symbol: "mic.fill",
            title: "Microphone Access",
            granted: permissions.micGranted,
            explanation: "Needed to hear you. Audio is processed on-device and never uploaded."
        ) {
            Button("Allow Microphone Access") {
                Task { await permissions.requestMicAccess() }
            }
            Button("Open System Settings") {
                permissions.openMicrophoneSettings()
            }
        }
    }

    private var accessibility: some View {
        StepView(
            symbol: "accessibility",
            title: "Accessibility Permission",
            granted: permissions.accessibilityGranted,
            explanation: "Lets Dictation type into other apps. Enable Dictation in System Settings → Privacy & Security → Accessibility; this screen updates automatically."
        ) {
            Button("Request Permission") {
                permissions.promptForAccessibility()
            }
            Button("Open System Settings") {
                permissions.openAccessibilitySettings()
            }
        }
    }

    private var model: some View {
        VStack(spacing: 14) {
            Image(systemName: "waveform")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("Download a Speech Model").font(.title2.bold())
            Text("Base (English) is a good start — fast and accurate for everyday dictation. You can add larger models later in Settings.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            let variant = ModelCatalog.defaultVariant
            if modelManager.isDownloaded(variant) {
                Label("Base (English) downloaded", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            } else if let progress = modelManager.downloadProgress[variant] {
                ProgressView(value: progress) {
                    Text("Downloading… \(Int(progress * 100))%")
                }
                .frame(width: 260)
            } else {
                Button("Download Base (English) — ~80 MB") {
                    Task {
                        await modelManager.download(variant)
                        if modelManager.isDownloaded(variant) {
                            AppServices.shared.activateModel(variant: variant)
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
            }
            if let error = modelManager.lastDownloadError {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
    }

    private var tryIt: some View {
        VStack(spacing: 14) {
            Image(systemName: "sparkles")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("Try It").font(.title2.bold())
            Text("Click into the field below, press ⌘⇧D, speak, and press ⌘⇧D again.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            TextEditor(text: $tryItText)
                .font(.body)
                .frame(height: 110)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
            Text("Tip: add a Groq API key in Settings → Cleanup for AI-polished output.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var navigation: some View {
        HStack {
            if step > 0 {
                Button("Back") { step -= 1 }
            }
            Spacer()
            if step < 4 {
                Button("Continue") { step += 1 }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canContinue)
            } else {
                Button("Done") {
                    settings.onboardingCompleted = true
                    onFinished?()
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    private var canContinue: Bool {
        switch step {
        case 1: return permissions.micGranted
        case 2: return permissions.accessibilityGranted
        case 3: return modelManager.hasAnyModel
        default: return true
        }
    }
}

private struct StepView<Actions: View>: View {
    let symbol: String
    let title: String
    let granted: Bool
    let explanation: String
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text(title).font(.title2.bold())
            Text(explanation)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            if granted {
                Label("Granted", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            } else {
                HStack { actions }
            }
        }
    }
}
