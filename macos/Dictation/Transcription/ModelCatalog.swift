import Foundation

/// Static catalog of WhisperKit model variants offered in the UI.
/// Variant strings must match folder names in the argmaxinc/whisperkit-coreml
/// Hugging Face repo. A wrong string only breaks that one catalog entry —
/// verify against `WhisperKit.fetchAvailableModels()` when touching this list.
enum ModelCatalog {
    struct Entry: Identifiable, Equatable {
        let variant: String
        let displayName: String
        let approxSize: String
        var id: String { variant }
    }

    static let defaultVariant = "openai_whisper-base.en"

    static let entries: [Entry] = [
        Entry(variant: "openai_whisper-tiny.en", displayName: "Tiny (English)", approxSize: "~40 MB"),
        Entry(variant: "openai_whisper-base.en", displayName: "Base (English)", approxSize: "~80 MB"),
        Entry(variant: "openai_whisper-small.en", displayName: "Small (English)", approxSize: "~250 MB"),
        Entry(variant: "openai_whisper-large-v3-v20240930_turbo", displayName: "Large v3 Turbo (multilingual)", approxSize: "~1.6 GB"),
    ]

    static func entry(for variant: String) -> Entry? {
        entries.first { $0.variant == variant }
    }
}
