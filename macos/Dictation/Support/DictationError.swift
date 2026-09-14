import Foundation

enum DictationError: LocalizedError {
    case noAudioInput
    case audioSetupFailed
    case modelNotDownloaded
    case modelNotLoaded
    case cleanupNotConfigured
    case cleanupHTTPError(Int)
    case cleanupBadOutput

    /// Written for a person, short enough for the menu bar status line and the
    /// Stage. This is the only error text the interface ever shows.
    var message: String {
        switch self {
        case .noAudioInput:
            return "No audio input device is available."
        case .audioSetupFailed:
            return "Could not set up audio recording."
        case .modelNotDownloaded:
            return "No transcription model is downloaded. Open Settings → Dictation."
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

    var errorDescription: String? { message }

    /// Underlying framework errors (WhisperKit, CoreAudio, URLSession) carry
    /// text that is meaningless to the person dictating, so it never reaches
    /// the interface — it is logged instead. See `DictationController.fail`.
    static let genericMessage = "Dictation hit a problem. Try again."

    static func displayMessage(for error: Error) -> String {
        (error as? DictationError)?.message ?? genericMessage
    }
}
