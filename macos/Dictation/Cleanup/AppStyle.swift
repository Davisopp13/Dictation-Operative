import Foundation

/// Opt-in per-app tone hints for the cleanup prompt. A rule maps a bundle
/// identifier (exact, or a substring such as "slack") to a one-line style
/// instruction. Only the frontmost app's bundle id is consulted — no window
/// titles, no screen content.
enum AppStyle {
    struct Preset: Identifiable, Equatable {
        let id: String
        let name: String
        let text: String
    }

    static let presets: [Preset] = [
        Preset(
            id: "casual",
            name: "Casual chat",
            text: "Casual chat message: relaxed tone, contractions are fine, no sign-off, lowercase first letter is acceptable if the speaker sounds casual."
        ),
        Preset(
            id: "formal",
            name: "Formal email",
            text: "Formal email: complete sentences, proper capitalization, polite and professional tone, no slang."
        ),
        Preset(
            id: "code",
            name: "Code / terminal",
            text: "Plain text for a code editor or terminal: keep technical terms, identifiers, and commands exactly as spoken, use straight quotes and ASCII punctuation only, no smart quotes or trailing period on a single command."
        ),
        Preset(
            id: "notes",
            name: "Notes",
            text: "Personal notes: concise, fragments are fine, keep the speaker's shorthand."
        ),
    ]

    static func preset(_ id: String) -> Preset? {
        presets.first { $0.id == id }
    }

    /// Starter rules for common apps, offered as a one-click add in Settings.
    static let suggestedRules: [String: String] = [
        "com.tinyspeck.slackmacgap": presetText("casual"),
        "com.apple.MobileSMS": presetText("casual"),
        "com.hnc.Discord": presetText("casual"),
        "com.apple.mail": presetText("formal"),
        "com.microsoft.Outlook": presetText("formal"),
        "com.microsoft.VSCode": presetText("code"),
        "com.apple.Terminal": presetText("code"),
        "com.googlecode.iterm2": presetText("code"),
        "com.apple.Notes": presetText("notes"),
    ]

    private static func presetText(_ id: String) -> String {
        preset(id)?.text ?? ""
    }

    /// Exact bundle-id match first, then the longest substring match, so a
    /// specific rule beats a broad one. Empty styles count as no rule.
    static func style(for bundleID: String?, rules: [String: String]) -> String? {
        guard let bundleID, !bundleID.isEmpty else { return nil }
        if let exact = nonEmpty(rules[bundleID]) { return exact }
        let lower = bundleID.lowercased()
        let candidates = rules.keys
            .filter { !$0.isEmpty && lower.contains($0.lowercased()) }
            .sorted { $0.count > $1.count }
        for key in candidates {
            if let style = nonEmpty(rules[key]) { return style }
        }
        return nil
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}
