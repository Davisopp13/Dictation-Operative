import Foundation
import os
import WhisperKit

// WhisperKit isolation file 2 of 2 (the other is ModelManager.swift).
// Assumed API surface, pinned to 0.9.x:
//   WhisperKitConfig(model: String?, ..., modelFolder: String?, ..., verbose: Bool,
//                    ..., prewarm: Bool?, load: Bool?, download: Bool)
//   WhisperKit(_ config: WhisperKitConfig) async throws
//   whisperKit.transcribe(audioArray: [Float], decodeOptions: DecodingOptions?,
//                         callback: TranscriptionCallback?)
//       async throws -> [TranscriptionResult]   // result has `.text`
//   TranscriptionCallback = @Sendable (TranscriptionProgress) -> Bool?
//       // return false to stop decoding early
//   DecodingOptions(task: .transcribe, language: String?, skipSpecialTokens: Bool,
//                   withoutTimestamps: Bool)    // labeled args in declaration order
// If the signature drifted, fixes belong in this file only.

actor TranscriptionService {
    private var whisperKit: WhisperKit?
    private var loadedVariant: String?
    /// Actors are reentrant across `await`; this keeps the final transcription
    /// and live previews from running on the same WhisperKit instance at once.
    private var busy = false

    var isLoaded: Bool { whisperKit != nil }

    private func acquire() async {
        while busy {
            try? await Task.sleep(for: .milliseconds(20))
        }
        busy = true
    }

    private func release() {
        busy = false
    }

    private func decodingOptions(language: String?) -> DecodingOptions {
        DecodingOptions(
            task: .transcribe,
            language: language,
            skipSpecialTokens: true,
            withoutTimestamps: true
        )
    }

    private static func joinedText(_ results: [TranscriptionResult]) -> String {
        results
            .map { $0.text }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Loads (and prewarms) the given model; no-op if already loaded.
    func loadModel(variant: String, folder: String) async throws {
        if loadedVariant == variant, whisperKit != nil { return }
        whisperKit = nil
        loadedVariant = nil
        Log.transcription.info("Loading model \(variant, privacy: .public)")
        let config = WhisperKitConfig(
            model: variant,
            modelFolder: folder,
            verbose: false,
            prewarm: true,
            load: true,
            download: false
        )
        whisperKit = try await WhisperKit(config)
        loadedVariant = variant
        Log.transcription.info("Model loaded")
    }

    func unload() {
        whisperKit = nil
        loadedVariant = nil
    }

    /// Transcribes 16 kHz mono Float32 samples. Returns "" for too-short audio.
    /// Waits for any in-flight preview pass to finish first.
    func transcribe(samples: [Float], language: String?) async throws -> String {
        guard let whisperKit else { throw DictationError.modelNotLoaded }
        // Under ~0.3 s of audio is never meaningful speech.
        guard samples.count >= Int(AudioRecorder.targetSampleRate * 0.3) else { return "" }

        await acquire()
        defer { release() }
        let results = try await whisperKit.transcribe(
            audioArray: samples,
            decodeOptions: decodingOptions(language: language)
        )
        return Self.joinedText(results)
    }

    /// Best-effort partial transcript while recording. Returns "" immediately
    /// if another pass is running, and aborts early (via the progress callback)
    /// once the calling task is cancelled, so it never delays the final pass
    /// by more than one decoding step.
    func transcribePreview(samples: [Float], language: String?) async throws -> String {
        guard let whisperKit else { throw DictationError.modelNotLoaded }
        guard samples.count >= Int(AudioRecorder.targetSampleRate * 1.0) else { return "" }
        guard !busy else { return "" }

        busy = true
        defer { release() }
        let results = try await whisperKit.transcribe(
            audioArray: samples,
            decodeOptions: decodingOptions(language: language),
            callback: { _ -> Bool? in
                Task.isCancelled ? false : nil
            }
        )
        guard !Task.isCancelled else { return "" }
        return Self.joinedText(results)
    }
}
