import Foundation
import Observation

@Observable
final class SettingsStore {
    private enum Keys {
        static let selectedModelVariant = "selectedModelVariant"
        static let cleanupEnabled = "cleanupEnabled"
        static let cleanupModel = "cleanupModel"
        static let customDictionary = "customDictionary"
        static let language = "language"
        static let onboardingCompleted = "onboardingCompleted"
        static let insertionMode = "insertionMode"
        static let modifierHotkey = "modifierHotkey"
    }

    private let defaults: UserDefaults

    var selectedModelVariant: String {
        didSet { defaults.set(selectedModelVariant, forKey: Keys.selectedModelVariant) }
    }

    var cleanupEnabled: Bool {
        didSet { defaults.set(cleanupEnabled, forKey: Keys.cleanupEnabled) }
    }

    var cleanupModel: String {
        didSet { defaults.set(cleanupModel, forKey: Keys.cleanupModel) }
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

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        selectedModelVariant = defaults.string(forKey: Keys.selectedModelVariant) ?? ModelCatalog.defaultVariant
        cleanupEnabled = defaults.bool(forKey: Keys.cleanupEnabled)
        cleanupModel = defaults.string(forKey: Keys.cleanupModel) ?? "llama-3.1-8b-instant"
        customDictionary = defaults.stringArray(forKey: Keys.customDictionary) ?? []
        language = defaults.string(forKey: Keys.language) ?? "en"
        onboardingCompleted = defaults.bool(forKey: Keys.onboardingCompleted)
        insertionMode = defaults.string(forKey: Keys.insertionMode)
            .flatMap(InsertionMode.init(rawValue:)) ?? .accessibilityFirst
        modifierHotkey = defaults.string(forKey: Keys.modifierHotkey)
            .flatMap(ModifierHotkey.init(rawValue:)) ?? .controlOption
    }

    var transcriptionLanguage: String? {
        language == "auto" ? nil : language
    }
}
