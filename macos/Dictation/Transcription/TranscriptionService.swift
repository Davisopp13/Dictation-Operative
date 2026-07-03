import Foundation
import os
import WhisperKit

// WhisperKit isolation file 2 of 2 (the other is ModelManager.swift).
// Assumed API surface, pinned to 0.9.x:
//   WhisperKitConfig(model: String?, ..., modelFolder: String?, ..., verbose: Bool,
//                    ..., prewarm: Bool?, load: Bool?, download: Bool)
//   WhisperKit(_ config: WhisperKitConfig) async throws
//   whisperKit.transcribe(audioArray: [Float], decodeOptions: DecodingOptions?)
//       async throws -> [TranscriptionResult]   // result has `.text`
//   DecodingOptions(task: .transcribe, language: String?, skipSpecialTokens: Bool,
//                   withoutTimestamps: Bool)    // labeled args in declaration order
// If the signature drifted, fixes belong in this file only.

actor TranscriptionService {
    private var whisperKit: WhisperKit?
    private var loadedVariant: String?

    var isLoaded: Bool { whisperKit != nil }

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
    func transcribe(samples: [Float], language: String?) async throws -> String {
        guard let whisperKit else { throw DictationError.modelNotLoaded }
        // Under ~0.3 s of audio is never meaningful speech.
        guard samples.count >= Int(AudioRecorder.targetSampleRate * 0.3) else { return "" }

        let options = DecodingOptions(
            task: .transcribe,
            language: language,
            skipSpecialTokens: true,
            withoutTimestamps: true
        )
        let results = try await whisperKit.transcribe(audioArray: samples, decodeOptions: options)
        return results
            .map { $0.text }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
