import Foundation

/// A post-transcription cleanup pass (filler-word removal, punctuation,
/// custom-dictionary spellings). Implementations must be side-effect free on
/// failure: the caller falls back to the raw transcript on any thrown error.
protocol CleanupProvider: Sendable {
    var id: String { get }
    func cleanup(transcript: String, dictionary: [String]) async throws -> String
}

/// Used when cleanup is disabled — returns the transcript untouched.
struct NoopCleanupProvider: CleanupProvider {
    let id = "noop"

    func cleanup(transcript: String, dictionary: [String]) async throws -> String {
        transcript
    }
}
