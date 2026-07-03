import Foundation

enum DictationError: LocalizedError {
    case noAudioInput
    case audioSetupFailed
    case modelNotDownloaded
    case modelNotLoaded
    case cleanupNotConfigured
    case cleanupHTTPError(Int)
    case cleanupBadOutput

    var errorDescription: String? {
        switch self {
        case .noAudioInput:
            return "No audio input device is available."
        case .audioSetupFailed:
            return "Could not set up audio recording."
        case .modelNotDownloaded:
            return "No transcription model is downloaded. Open Settings → Model."
        case .modelNotLoaded:
            return "The transcription model is not loaded yet."
        case .cleanupNotConfigured:
            return "Cleanup is enabled but no API key is set."
        case .cleanupHTTPError(let code):
            return "Cleanup request failed (HTTP \(code))."
        case .cleanupBadOutput:
            return "Cleanup returned an unusable response."
        }
    }
}
