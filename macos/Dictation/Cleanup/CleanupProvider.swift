import Foundation

/// A post-transcription cleanup pass (filler-word removal, punctuation,
/// custom-dictionary spellings). Implementations must be side-effect free on
/// failure: the caller falls back to the raw transcript on any thrown error.
protocol CleanupProvider: Sendable {
    var id: String { get }
    func cleanup(transcript: String, dictionary: [String]) async throws -> String
}

extension CleanupProvider {
    /// Cheap connectivity/key check for the Settings "Test connection" button.
    func testConnection() async -> Result<Void, Error> {
        do {
            _ = try await cleanup(transcript: "um hello world", dictionary: [])
            return .success(())
        } catch {
            return .failure(error)
        }
    }
}

/// Used when cleanup is disabled — returns the transcript untouched.
struct NoopCleanupProvider: CleanupProvider {
    let id = "noop"

    func cleanup(transcript: String, dictionary: [String]) async throws -> String {
        transcript
    }
}

/// Guardrails shared by every network provider (ADR-0005): a hard timeout,
/// HTTP status check, and rejection of empty or wildly longer output.
enum CleanupGuard {
    static let timeout: TimeInterval = 10

    static func checkHTTP(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw DictationError.cleanupBadOutput
        }
        guard (200..<300).contains(http.statusCode) else {
            throw DictationError.cleanupHTTPError(http.statusCode)
        }
    }

    /// Returns the trimmed output, or throws if it is unusable.
    static func validate(_ output: String?, transcript: String) throws -> String {
        guard
            let content = output?.trimmingCharacters(in: .whitespacesAndNewlines),
            !content.isEmpty,
            content.count <= transcript.count * 3 + 64
        else {
            throw DictationError.cleanupBadOutput
        }
        return content
    }
}
