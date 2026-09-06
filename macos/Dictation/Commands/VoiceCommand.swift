import Foundation

/// Spoken edit commands that act on the last inserted dictation instead of
/// being inserted as text. Parsed from the *raw* transcript before cleanup.
/// Pure value type — unit-tested.
enum VoiceCommand: Equatable {
    /// "scratch that" — remove the whole last dictation.
    case deleteLast
    case deleteLastSentence
    case deleteLastWord
    case uppercase
    case lowercase
    /// "make that a bullet list", "make that more formal" — needs an LLM.
    case rewrite(instruction: String)

    // MARK: Parsing

    private static let deletePhrases: Set<String> = [
        "scratch that", "scratch last", "scratch the last one",
        "delete that", "delete last", "delete the last one",
        "undo that", "undo last", "undo the last one",
        "remove that", "remove last", "erase that",
    ]

    /// Commands are short; anything longer is ordinary dictation that happens
    /// to start with a command-like phrase.
    private static let maxWords = 12

    static func parse(_ transcript: String) -> VoiceCommand? {
        let text = normalize(transcript)
        guard !text.isEmpty, text.split(separator: " ").count <= maxWords else { return nil }

        if deletePhrases.contains(text) { return .deleteLast }
        if matches(text, #"^(delete|remove|erase|scratch|undo) (the )?last sentence$"#) {
            return .deleteLastSentence
        }
        if matches(text, #"^(delete|remove|erase|scratch|undo) (the )?last word$"#) {
            return .deleteLastWord
        }
        if let rest = capture(text, #"^(?:make|turn|rewrite|change|put) (?:that|this|it) (.+)$"#) {
            switch rest {
            case "uppercase", "upper case", "all caps", "in all caps", "in caps", "capitals", "all capitals":
                return .uppercase
            case "lowercase", "lower case", "in lowercase", "in lower case":
                return .lowercase
            default:
                return .rewrite(instruction: rest)
            }
        }
        return nil
    }

    /// Lowercase, strip punctuation, collapse whitespace.
    static func normalize(_ transcript: String) -> String {
        let lowered = transcript.lowercased()
        let kept = lowered.unicodeScalars.map { scalar -> Character in
            if CharacterSet.alphanumerics.contains(scalar) { return Character(scalar) }
            return " "
        }
        return String(kept)
            .split(separator: " ", omittingEmptySubsequences: true)
            .joined(separator: " ")
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: .regularExpression) != nil
    }

    private static func capture(_ text: String, _ pattern: String) -> String? {
        guard
            let regex = try? NSRegularExpression(pattern: pattern),
            let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
            match.numberOfRanges > 1,
            let range = Range(match.range(at: 1), in: text)
        else {
            return nil
        }
        return String(text[range])
    }

    // MARK: Applying

    /// Deterministic edits return the new text; `nil` means the LLM must do it.
    func apply(to text: String) -> String? {
        switch self {
        case .deleteLast: return ""
        case .deleteLastSentence: return TextEditing.removingLastSentence(text)
        case .deleteLastWord: return TextEditing.removingLastWord(text)
        case .uppercase: return text.uppercased()
        case .lowercase: return text.lowercased()
        case .rewrite: return nil
        }
    }

    var needsProvider: Bool {
        if case .rewrite = self { return true }
        return false
    }

    /// Indicator message after the edit was applied.
    var confirmationMessage: String {
        switch self {
        case .deleteLast: return "Removed last dictation"
        case .deleteLastSentence: return "Removed last sentence"
        case .deleteLastWord: return "Removed last word"
        case .uppercase: return "Made it uppercase"
        case .lowercase: return "Made it lowercase"
        case .rewrite(let instruction): return "Rewrote: \(instruction)"
        }
    }
}

/// Deterministic text edits used by `VoiceCommand`.
enum TextEditing {
    /// Drops the final sentence (Foundation's sentence tokenizer). A single
    /// sentence becomes "".
    static func removingLastSentence(_ text: String) -> String {
        let ns = text as NSString
        var sentences: [String] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.bySentences]) { substring, _, _, _ in
            if let substring { sentences.append(substring) }
        }
        guard sentences.count > 1 else { return "" }
        sentences.removeLast()
        return sentences.joined().trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Drops the final whitespace-delimited word (with any punctuation stuck
    /// to it). A single word becomes "".
    static func removingLastWord(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let range = trimmed.range(of: #"\s+\S+$"#, options: .regularExpression) else {
            return ""
        }
        return String(trimmed[..<range.lowerBound])
    }
}
