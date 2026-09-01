import Foundation

/// The cleanup backends offered in Settings. Three of them speak the
/// OpenAI-compatible chat-completions dialect and differ only by base URL;
/// Anthropic has its own Messages API.
enum CleanupProviderKind: String, CaseIterable, Identifiable {
    case groq
    case openai
    case anthropic
    /// Any OpenAI-compatible server on this machine (Ollama, llama.cpp
    /// `llama-server`, LM Studio). No key needed; base URL is editable.
    case local

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .groq: return "Groq"
        case .openai: return "OpenAI"
        case .anthropic: return "Anthropic"
        case .local: return "Local (Ollama / llama.cpp)"
        }
    }

    var defaultModel: String {
        switch self {
        case .groq: return "llama-3.1-8b-instant"
        case .openai: return "gpt-4o-mini"
        case .anthropic: return "claude-opus-5"
        case .local: return "llama3.1"
        }
    }

    /// Base URL of the OpenAI-compatible API (`/chat/completions` is appended).
    /// Nil for Anthropic, which has a fixed endpoint.
    var defaultBaseURL: String? {
        switch self {
        case .groq: return "https://api.groq.com/openai/v1"
        case .openai: return "https://api.openai.com/v1"
        case .anthropic: return nil
        case .local: return "http://localhost:11434/v1"
        }
    }

    /// Only the local server may run without a key.
    var requiresAPIKey: Bool { self != .local }

    /// Keychain account name for this provider's API key. Groq keeps the
    /// account name it had before providers were pluggable.
    var keychainAccount: String {
        switch self {
        case .groq: return KeychainHelper.groqAPIKey
        case .openai: return "openaiAPIKey"
        case .anthropic: return "anthropicAPIKey"
        case .local: return "localCleanupAPIKey"
        }
    }

    var consoleURL: URL? {
        switch self {
        case .groq: return URL(string: "https://console.groq.com/keys")
        case .openai: return URL(string: "https://platform.openai.com/api-keys")
        case .anthropic: return URL(string: "https://console.anthropic.com/settings/keys")
        case .local: return nil
        }
    }

    var help: String {
        switch self {
        case .groq:
            return "Fastest hosted option. Llama 3.1 8B on Groq typically returns in well under a second."
        case .openai:
            return "Uses the Chat Completions API. Any chat model name works."
        case .anthropic:
            return "Uses the Messages API with low effort for speed. Any Claude model name works."
        case .local:
            return "Point this at an OpenAI-compatible server on this Mac (Ollama default shown; llama.cpp's llama-server uses http://localhost:8080/v1). Nothing leaves the machine; the API key is optional."
        }
    }
}

/// Builds the configured provider from settings + Keychain.
enum CleanupProviderFactory {
    /// Nil when the provider needs a key and none is stored — the caller
    /// then inserts the raw transcript, same as when cleanup is off.
    @MainActor
    static func make(settings: SettingsStore) -> CleanupProvider? {
        let kind = settings.cleanupProvider
        let apiKey = KeychainHelper.get(kind.keychainAccount) ?? ""
        if kind.requiresAPIKey, apiKey.isEmpty { return nil }
        return make(
            kind: kind,
            apiKey: apiKey,
            model: settings.cleanupModel(for: kind),
            baseURL: settings.cleanupBaseURL(for: kind)
        )
    }

    static func make(kind: CleanupProviderKind, apiKey: String, model: String, baseURL: String?) -> CleanupProvider {
        switch kind {
        case .anthropic:
            return AnthropicCleanupService(apiKey: apiKey, model: model)
        case .groq, .openai, .local:
            let urlString = baseURL ?? kind.defaultBaseURL ?? ""
            let url = URL(string: urlString) ?? URL(string: kind.defaultBaseURL!)!
            return OpenAICompatibleCleanupService(
                id: kind.rawValue,
                baseURL: url,
                apiKey: apiKey.isEmpty ? nil : apiKey,
                model: model
            )
        }
    }
}
