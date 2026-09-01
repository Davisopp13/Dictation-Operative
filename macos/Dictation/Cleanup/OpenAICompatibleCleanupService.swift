import Foundation

/// Cleanup via any OpenAI-compatible `/chat/completions` endpoint: Groq,
/// OpenAI, or a local Ollama / llama.cpp server. Plain URLSession, no SDK.
/// Guardrails live in `CleanupGuard`.
struct OpenAICompatibleCleanupService: CleanupProvider {
    let id: String
    /// e.g. `https://api.groq.com/openai/v1`; `/chat/completions` is appended.
    let baseURL: URL
    /// Nil for local servers that don't authenticate.
    let apiKey: String?
    let model: String

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

    /// Appends `/chat/completions`, tolerating a trailing slash on the base.
    static func endpoint(for baseURL: URL) -> URL {
        var base = baseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        return URL(string: base + "/chat/completions") ?? baseURL
    }

    func cleanup(transcript: String, dictionary: [String]) async throws -> String {
        var request = URLRequest(url: Self.endpoint(for: baseURL))
        request.httpMethod = "POST"
        request.timeoutInterval = CleanupGuard.timeout
        if let apiKey, !apiKey.isEmpty {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
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
        try CleanupGuard.checkHTTP(response)

        let decoded = try JSONDecoder().decode(ChatResponse.self, from: data)
        return try CleanupGuard.validate(decoded.choices.first?.message.content, transcript: transcript)
    }
}
