import Foundation

/// Cleanup via Groq's OpenAI-compatible chat completions API. Plain URLSession,
/// no SDK. Guardrails: temperature 0, 10 s timeout, response rejected if empty
/// or wildly longer than the input.
struct GroqCleanupService: CleanupProvider {
    let id = "groq"

    let apiKey: String
    let model: String

    private static let endpoint = URL(string: "https://api.groq.com/openai/v1/chat/completions")!

    struct ChatMessage: Codable {
        let role: String
        let content: String
    }

    struct ChatRequest: Encodable {
        let model: String
        let messages: [ChatMessage]
        let temperature: Double
    }

    struct ChatResponse: Decodable {
        struct Choice: Decodable {
            struct Message: Decodable {
                let content: String?
            }
            let message: Message
        }
        let choices: [Choice]
    }

    func cleanup(transcript: String, dictionary: [String]) async throws -> String {
        var request = URLRequest(url: Self.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(ChatRequest(
            model: model,
            messages: [
                ChatMessage(role: "system", content: CleanupPrompt.system(dictionary: dictionary)),
                ChatMessage(role: "user", content: transcript),
            ],
            temperature: 0
        ))

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw DictationError.cleanupBadOutput
        }
        guard (200..<300).contains(http.statusCode) else {
            throw DictationError.cleanupHTTPError(http.statusCode)
        }

        let decoded = try JSONDecoder().decode(ChatResponse.self, from: data)
        guard
            let content = decoded.choices.first?.message.content?
                .trimmingCharacters(in: .whitespacesAndNewlines),
            !content.isEmpty,
            content.count <= transcript.count * 3 + 64
        else {
            throw DictationError.cleanupBadOutput
        }
        return content
    }

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
