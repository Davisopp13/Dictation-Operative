import Foundation

/// Cleanup via the Anthropic Messages API (raw HTTP; there is no official
/// Swift SDK). Request shape per the Claude API reference:
///   POST https://api.anthropic.com/v1/messages
///   headers: x-api-key, anthropic-version: 2023-06-01
///   body: model, max_tokens, system, messages[{role:user, content}],
///         output_config.effort, fallbacks
/// The response's `content` is a list of blocks; we join the `text` ones.
/// Guardrails live in `CleanupGuard`.
struct AnthropicCleanupService: CleanupProvider {
    let id = "anthropic"

    let apiKey: String
    let model: String

    private static let endpoint = URL(string: "https://api.anthropic.com/v1/messages")!
    private static let apiVersion = "2023-06-01"
    /// Beta header for the `fallbacks: "default"` scalar form.
    private static let fallbackBeta = "server-side-fallback-2026-07-01"

    struct Message: Encodable {
        let role: String
        let content: String
    }

    struct OutputConfig: Encodable {
        let effort: String
    }

    /// Encoded with `.convertToSnakeCase`: maxTokens → max_tokens, etc.
    struct Request: Encodable {
        let model: String
        let maxTokens: Int
        let system: String
        let messages: [Message]
        /// Omitted (nil) for models that don't accept `output_config.effort`.
        let outputConfig: OutputConfig?
        /// Server-side refusal fallbacks (Claude 5 family only); omitted otherwise.
        let fallbacks: String?
    }

    struct Response: Decodable {
        struct Block: Decodable {
            let type: String
            let text: String?
        }
        let content: [Block]
        let stopReason: String?
    }

    /// Claude 5 family: thinking is on by default, `effort` and refusal
    /// fallbacks are supported. Older Haiku/4.5 models reject `effort`.
    private var isClaude5Family: Bool {
        model.hasPrefix("claude-opus-5") || model.hasPrefix("claude-fable-5") || model.hasPrefix("claude-sonnet-5")
    }

    private var supportsEffort: Bool {
        !(model.contains("haiku") || model.contains("-4-5"))
    }

    func cleanup(transcript: String, dictionary: [String]) async throws -> String {
        var request = URLRequest(url: Self.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = CleanupGuard.timeout
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue(Self.apiVersion, forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if isClaude5Family {
            request.setValue(Self.fallbackBeta, forHTTPHeaderField: "anthropic-beta")
        }

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        request.httpBody = try encoder.encode(Request(
            model: model,
            maxTokens: 4096,
            system: CleanupPrompt.system(dictionary: dictionary),
            messages: [Message(role: "user", content: transcript)],
            // Cleanup is latency-sensitive and mechanical; low effort keeps
            // adaptive thinking short.
            outputConfig: supportsEffort ? OutputConfig(effort: "low") : nil,
            fallbacks: isClaude5Family ? "default" : nil
        ))

        let (data, response) = try await URLSession.shared.data(for: request)
        try CleanupGuard.checkHTTP(response)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let decoded = try decoder.decode(Response.self, from: data)
        // A safety refusal is HTTP 200 with stop_reason "refusal"; treat it
        // like any other failure so the raw transcript is inserted.
        guard decoded.stopReason != "refusal" else {
            throw DictationError.cleanupBadOutput
        }
        let text = decoded.content
            .filter { $0.type == "text" }
            .compactMap(\.text)
            .joined()
        return try CleanupGuard.validate(text, transcript: transcript)
    }
}
