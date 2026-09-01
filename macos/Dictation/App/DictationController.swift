import AppKit
import Foundation
import Observation
import os

/// The orchestrator: owns the pipeline state machine and drives
/// record → transcribe → clean → insert → history.
@MainActor
@Observable
final class DictationController {
    private(set) var state: DictationState = .idle
    private(set) var lastTranscript: String?
    /// Latest mic RMS level (0...~1) while recording; drives the indicator meter.
    private(set) var audioLevel: Float = 0
    /// Short-lived message shown in the floating indicator (e.g. "Copied to clipboard").
    private(set) var transientMessage: String?
    /// Rolling partial transcript while recording (see `LivePreviewState`).
    private(set) var livePreview = LivePreviewState()

    private let settings: SettingsStore
    private let permissions: PermissionsManager
    private let modelManager: ModelManager
    private let transcription: TranscriptionService
    private let history: HistoryStore
    private let recorder = AudioRecorder()
    private let inserter = TextInserter()
    private let indicator = RecordingIndicatorPanel()

    /// Called when dictation is attempted before permissions/model are ready.
    var onSetupNeeded: (@MainActor () -> Void)?

    private var processingTask: Task<Void, Never>?
    private var previewTask: Task<Void, Never>?
    private var errorClearTask: Task<Void, Never>?
    private var messageClearTask: Task<Void, Never>?

    /// Live preview cadence and window. Whisper's native window is 30 s;
    /// re-transcribing only that tail keeps each pass ~1 s on Apple Silicon.
    private static let previewInterval: Duration = .milliseconds(1200)
    private static let previewWindowSamples = Int(AudioRecorder.targetSampleRate) * 30
    /// Don't re-run a pass until at least this much new audio arrived.
    private static let previewMinNewSamples = Int(AudioRecorder.targetSampleRate)

    /// Recordings whose peak RMS never exceeds this are treated as silence
    /// (Whisper hallucinates text on silent audio).
    private static let silenceRMSThreshold: Float = 0.003
    private var peakLevel: Float = 0

    init(
        settings: SettingsStore,
        permissions: PermissionsManager,
        modelManager: ModelManager,
        transcription: TranscriptionService,
        history: HistoryStore
    ) {
        self.settings = settings
        self.permissions = permissions
        self.modelManager = modelManager
        self.transcription = transcription
        self.history = history

        recorder.onLevel = { [weak self] level in
            Task { @MainActor in
                guard let self else { return }
                self.audioLevel = level
                self.peakLevel = max(self.peakLevel, level)
            }
        }
        recorder.onMaxDuration = { [weak self] in
            Task { @MainActor in
                self?.stopAndProcess()
            }
        }
    }

    // MARK: - Entry points

    func toggle() {
        switch state {
        case .idle, .error:
            startRecording()
        case .recording:
            stopAndProcess()
        case .transcribing, .cleaning, .inserting:
            break
        }
    }

    func startRecording() {
        switch state {
        case .idle, .error: break
        case .recording, .transcribing, .cleaning, .inserting: return
        }
        permissions.refresh()
        guard permissions.allGranted, modelManager.isDownloaded(settings.selectedModelVariant) else {
            onSetupNeeded?()
            return
        }
        do {
            peakLevel = 0
            audioLevel = 0
            try recorder.start()
            errorClearTask?.cancel()
            state = .recording(start: Date())
            indicator.show(controller: self)
            startLivePreview()
        } catch {
            fail(error)
        }
    }

    func stopAndProcess() {
        guard case .recording(let start) = state else { return }
        stopLivePreview()
        // Capture the target app NOW, before any UI churn.
        let targetApp = NSWorkspace.shared.frontmostApplication
        let samples = recorder.stop()
        let duration = Date().timeIntervalSince(start)
        state = .transcribing

        processingTask = Task { [weak self] in
            await self?.process(samples: samples, duration: duration, targetApp: targetApp)
        }
    }

    func cancel() {
        stopLivePreview()
        recorder.cancel()
        processingTask?.cancel()
        processingTask = nil
        state = .idle
        indicator.hide()
    }

    // MARK: - Live preview

    /// Periodically transcribes the tail of the recording so the indicator can
    /// show words as they are spoken. Never inserts anything; the final pass
    /// at stop is still the source of truth.
    private func startLivePreview() {
        previewTask?.cancel()
        livePreview.reset()
        guard settings.livePreviewEnabled else { return }

        previewTask = Task { [weak self] in
            var lastCount = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.previewInterval)
                guard !Task.isCancelled, let self, self.state.isRecording else { return }

                let samples = self.recorder.snapshot()
                guard samples.count - lastCount >= Self.previewMinNewSamples else { continue }
                lastCount = samples.count
                let window = Array(samples.suffix(Self.previewWindowSamples))

                let text = try? await self.transcription.transcribePreview(
                    samples: window,
                    language: self.settings.transcriptionLanguage
                )
                guard !Task.isCancelled, self.state.isRecording,
                      let text, !text.isEmpty else { continue }
                self.livePreview.update(with: text)
            }
        }
    }

    private func stopLivePreview() {
        previewTask?.cancel()
        previewTask = nil
    }

    // MARK: - Pipeline

    private func process(samples: [Float], duration: TimeInterval, targetApp: NSRunningApplication?) async {
        defer {
            processingTask = nil
            indicator.updateVisibility(for: self)
        }
        do {
            // Energy gate: don't transcribe silence.
            guard peakLevel >= Self.silenceRMSThreshold else {
                state = .idle
                indicator.hide()
                return
            }

            let raw = try await transcription.transcribe(
                samples: samples,
                language: settings.transcriptionLanguage
            )
            guard !Task.isCancelled else { return }
            guard !raw.isEmpty else {
                state = .idle
                indicator.hide()
                return
            }

            var cleaned: String?
            if settings.cleanupEnabled, let provider = makeCleanupProvider() {
                state = .cleaning
                if let result = try? await provider.cleanup(
                    transcript: raw,
                    dictionary: settings.customDictionary
                ), !result.isEmpty {
                    cleaned = result
                } else {
                    Log.cleanup.info("Cleanup unavailable; inserting raw transcript")
                }
            }
            guard !Task.isCancelled else { return }

            let finalText = cleaned ?? raw
            state = .inserting
            let result = await inserter.insert(
                finalText,
                into: targetApp,
                mode: settings.insertionMode
            )

            history.add(HistoryEntry(
                id: UUID(),
                date: Date(),
                rawText: raw,
                cleanedText: cleaned,
                appBundleID: targetApp?.bundleIdentifier,
                durationSec: duration
            ))
            lastTranscript = finalText

            state = .idle
            // Briefly report which path was used — this is also the diagnostic
            // for "text didn't appear" (e.g. "via Accessibility" but nothing
            // inserted ⇒ the app falsely accepted the AX write).
            showTransientMessage(result.indicatorMessage)
        } catch {
            fail(error)
        }
    }

    private func makeCleanupProvider() -> CleanupProvider? {
        CleanupProviderFactory.make(settings: settings)
    }

    // MARK: - Errors & transient messages

    private func fail(_ error: Error) {
        Log.app.error("Pipeline failed: \(error.localizedDescription)")
        state = .error(error.localizedDescription)
        indicator.updateVisibility(for: self)
        errorClearTask?.cancel()
        errorClearTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled, let self else { return }
            if case .error = self.state {
                self.state = .idle
                self.indicator.hide()
            }
        }
    }

    private func showTransientMessage(_ message: String) {
        transientMessage = message
        indicator.updateVisibility(for: self)
        messageClearTask?.cancel()
        messageClearTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled, let self else { return }
            self.transientMessage = nil
            self.indicator.updateVisibility(for: self)
        }
    }
}
