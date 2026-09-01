import Foundation
import Observation

@Observable
final class SettingsStore {
    private enum Keys {
        static let selectedModelVariant = "selectedModelVariant"
        static let cleanupEnabled = "cleanupEnabled"
        /// Pre-provider-picker key: a single Groq model name. Migrated into
        /// `cleanupModels["groq"]` on first launch after the upgrade.
        static let legacyCleanupModel = "cleanupModel"
        static let cleanupProvider = "cleanupProvider"
        static let cleanupModels = "cleanupModels"
        static let localCleanupBaseURL = "localCleanupBaseURL"
        static let customDictionary = "customDictionary"
        static let language = "language"
        static let onboardingCompleted = "onboardingCompleted"
        static let insertionMode = "insertionMode"
        static let modifierHotkey = "modifierHotkey"
        static let livePreviewEnabled = "livePreviewEnabled"
    }

    private let defaults: UserDefaults

    var selectedModelVariant: String {
        didSet { defaults.set(selectedModelVariant, forKey: Keys.selectedModelVariant) }
    }

    var cleanupEnabled: Bool {
        didSet { defaults.set(cleanupEnabled, forKey: Keys.cleanupEnabled) }
    }

    var cleanupProvider: CleanupProviderKind {
        didSet { defaults.set(cleanupProvider.rawValue, forKey: Keys.cleanupProvider) }
    }

    /// Provider raw value → model name. Only providers the user has edited
    /// have an entry; `cleanupModel(for:)` falls back to the kind's default.
    private(set) var cleanupModels: [String: String] {
        didSet { defaults.set(cleanupModels, forKey: Keys.cleanupModels) }
    }

    /// Base URL of the local OpenAI-compatible server (Ollama / llama.cpp).
    var localCleanupBaseURL: String {
        didSet { defaults.set(localCleanupBaseURL, forKey: Keys.localCleanupBaseURL) }
    }

    func cleanupModel(for kind: CleanupProviderKind) -> String {
        let stored = cleanupModels[kind.rawValue]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return stored.isEmpty ? kind.defaultModel : stored
    }

    func setCleanupModel(_ model: String, for kind: CleanupProviderKind) {
        cleanupModels[kind.rawValue] = model
    }

    /// Base URL for OpenAI-compatible providers; nil for Anthropic.
    func cleanupBaseURL(for kind: CleanupProviderKind) -> String? {
        switch kind {
        case .local:
            let trimmed = localCleanupBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? kind.defaultBaseURL : trimmed
        default:
            return kind.defaultBaseURL
        }
    }

    var customDictionary: [String] {
        didSet { defaults.set(customDictionary, forKey: Keys.customDictionary) }
    }

    /// ISO 639-1 code passed to the transcriber; "auto" means detect.
    var language: String {
        didSet { defaults.set(language, forKey: Keys.language) }
    }

    var onboardingCompleted: Bool {
        didSet { defaults.set(onboardingCompleted, forKey: Keys.onboardingCompleted) }
    }

    var insertionMode: InsertionMode {
        didSet { defaults.set(insertionMode.rawValue, forKey: Keys.insertionMode) }
    }

    var modifierHotkey: ModifierHotkey {
        didSet { defaults.set(modifierHotkey.rawValue, forKey: Keys.modifierHotkey) }
    }

    /// Show a rolling partial transcript in the indicator while recording.
    var livePreviewEnabled: Bool {
        didSet { defaults.set(livePreviewEnabled, forKey: Keys.livePreviewEnabled) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        selectedModelVariant = defaults.string(forKey: Keys.selectedModelVariant) ?? ModelCatalog.defaultVariant
        cleanupEnabled = defaults.bool(forKey: Keys.cleanupEnabled)
        cleanupProvider = defaults.string(forKey: Keys.cleanupProvider)
            .flatMap(CleanupProviderKind.init(rawValue:)) ?? .groq
        var models = defaults.dictionary(forKey: Keys.cleanupModels) as? [String: String] ?? [:]
        if models[CleanupProviderKind.groq.rawValue] == nil,
           let legacy = defaults.string(forKey: Keys.legacyCleanupModel), !legacy.isEmpty {
            models[CleanupProviderKind.groq.rawValue] = legacy
        }
        cleanupModels = models
        localCleanupBaseURL = defaults.string(forKey: Keys.localCleanupBaseURL)
            ?? CleanupProviderKind.local.defaultBaseURL ?? ""
        customDictionary = defaults.stringArray(forKey: Keys.customDictionary) ?? []
        language = defaults.string(forKey: Keys.language) ?? "en"
        onboardingCompleted = defaults.bool(forKey: Keys.onboardingCompleted)
        insertionMode = defaults.string(forKey: Keys.insertionMode)
            .flatMap(InsertionMode.init(rawValue:)) ?? .accessibilityFirst
        modifierHotkey = defaults.string(forKey: Keys.modifierHotkey)
            .flatMap(ModifierHotkey.init(rawValue:)) ?? .controlOption
        livePreviewEnabled = (defaults.object(forKey: Keys.livePreviewEnabled) as? Bool) ?? true
    }

    var transcriptionLanguage: String? {
        language == "auto" ? nil : language
    }
}
