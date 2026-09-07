import AppKit
import SwiftUI

/// First-run setup: welcome → microphone → accessibility → model download → try it.
struct OnboardingView: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(PermissionsManager.self) private var permissions
    @Environment(ModelManager.self) private var modelManager

    @State private var step = 0
    @State private var tryItText = ""

    var onFinished: (() -> Void)?

    init(initialStep: Int = 0, onFinished: (() -> Void)? = nil) {
        _step = State(initialValue: initialStep)
        self.onFinished = onFinished
    }

    /// The five steps, in order. Also the step indicator's copy.
    static let stepTitles = ["Welcome", "Microphone", "Accessibility", "Speech Model", "Try It"]

    private var clampedStep: Int { min(max(step, 0), Self.stepTitles.count - 1) }

    var body: some View {
        VStack(spacing: Tokens.Space.lg) {
            stepIndicator
            content
            Spacer()
            navigation
        }
        .padding(Tokens.Space.lg + Tokens.Space.xxs)
        .frame(width: Tokens.Size.onboarding.width, height: Tokens.Size.onboarding.height)
        .onAppear { permissions.startPolling() }
        .onDisappear { permissions.stopPolling() }
    }

    private var stepIndicator: some View {
        VStack(spacing: Tokens.Space.xs) {
            HStack(spacing: Tokens.Space.xxs + 2) {
                ForEach(Array(Self.stepTitles.indices), id: \.self) { index in
                    Capsule()
                        .fill(index == clampedStep ? Color.accentColor : Color.secondary.opacity(0.3))
                        .frame(width: index == clampedStep ? 24 : 8, height: 6)
                }
            }
            .animation(.easeOut(duration: 0.2), value: clampedStep)
            Text("Step \(clampedStep + 1) of \(Self.stepTitles.count) · \(Self.stepTitles[clampedStep])")
                .font(.caption)
                .foregroundStyle(Tokens.Chrome.secondaryText)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(clampedStep + 1) of \(Self.stepTitles.count), \(Self.stepTitles[clampedStep])")
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
            Image(nsImage: NSApplication.shared.applicationIconImage)
                .resizable()
                .scaledToFit()
                .frame(width: 72, height: 72)
                .accessibilityHidden(true)
            Text("Welcome to Dictation").font(.title2.bold())
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
        VStack(spacing: 16) {
            StepView(
                symbol: "accessibility",
                title: "Accessibility Permission",
                granted: permissions.accessibilityGranted,
                explanation: "Allow Dictation to type into other apps. Enable this copy in System Settings → Privacy & Security → Accessibility."
            ) {
                Button("Request Permission") { permissions.promptForAccessibility() }
                Button("Open System Settings") { permissions.openAccessibilitySettings() }
            }
            if !permissions.accessibilityGranted {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Already enabled after an update?").font(.headline)
                    Text("Remove the old Dictation entry with the − button, then use + to add the current app shown below. Enable it and approve the macOS authentication prompt. Quit and reopen Dictation if access still isn’t recognized.")
                    Text(Bundle.main.bundleURL.path).textSelection(.enabled)
                        .font(.caption.monospaced())
                    Button("Show This Copy in Finder") { permissions.revealCurrentApp() }
                    Text("Development builds without a signing certificate may need approval after each rebuild. Consistently certificate-signed updates avoid this identity change.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .font(.callout)
                .sectionCard()
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

            let variant = settings.selectedModelVariant
            let entry = ModelCatalog.entry(for: variant)
            if modelManager.isDownloaded(variant) {
                Label("\(entry?.displayName ?? variant) downloaded", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            } else if let progress = modelManager.downloadProgress[variant] {
                ProgressView(value: progress) {
                    Text("Downloading… \(Int(progress * 100))%")
                }
                .frame(width: 260)
            } else {
                Button("Download \(entry?.displayName ?? variant) — \(entry?.approxSize ?? "")") {
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
            Text("Click into the field below, tap ⌃⌥ (Control + Option), speak, and tap ⌃⌥ again. Or hold ⌃⌥ while you speak and release to insert.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            TextEditor(text: $tryItText)
                .font(.body)
                .frame(height: 110)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
            Text("Tip: add a Groq API key in Settings → Writing for AI-polished output.")
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
            if settings.onboardingCompleted && permissions.allGranted && modelManager.isDownloaded(settings.selectedModelVariant) {
                Button("Return to Dictation") { onFinished?() }
                    .buttonStyle(.borderedProminent)
            } else if step < 4 {
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
        case 3: return modelManager.isDownloaded(settings.selectedModelVariant)
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
