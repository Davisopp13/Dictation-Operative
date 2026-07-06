import AppKit
import Foundation
import os

enum InsertionResult: Equatable {
    case axInserted
    case pasted
    /// Text was left on the clipboard; the user must paste manually.
    case clipboardOnly

    var indicatorMessage: String {
        switch self {
        case .axInserted: return "Inserted via Accessibility"
        case .pasted: return "Inserted via paste"
        case .clipboardOnly: return "Copied to clipboard — press ⌘V to paste"
        }
    }
}

/// How text is delivered to the frontmost app.
enum InsertionMode: String, CaseIterable, Identifiable {
    /// Try the Accessibility API first, fall back to paste. Default.
    case accessibilityFirst
    /// Always use the clipboard-paste path (works in terminals/Electron widgets
    /// that falsely accept AX writes).
    case alwaysPaste

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .accessibilityFirst: return "Accessibility first (recommended)"
        case .alwaysPaste: return "Always paste"
        }
    }
}

/// Facade over the two insertion strategies. The app never takes focus
/// (accessory app + non-activating panel), so the focused element at insert
/// time is normally still the app the user was dictating into.
@MainActor
struct TextInserter {
    /// Apps whose focused element falsely accepts AX text writes (terminals and
    /// terminal/editor-widget Electron apps). Matched as substrings against both
    /// the bundle identifier and the localized app name, so it catches variants
    /// and apps whose exact bundle IDs we don't know.
    private static let axHostileNeedles = [
        "codex", "claude", "terminal", "iterm", "ghostty",
        "wezterm", "alacritty", "kitty", "warp", "hyper",
    ]

    func insert(_ text: String, into app: NSRunningApplication?, mode: InsertionMode) async -> InsertionResult {
        let forcePaste = mode == .alwaysPaste || Self.isAXHostile(app)

        if !forcePaste, AXInserter.insert(text) {
            Log.insertion.info("Inserted via AX")
            return .axInserted
        }

        switch await PasteInserter.insert(text) {
        case .pasted:
            Log.insertion.info("Inserted via paste")
            return .pasted
        case .clipboardOnly:
            Log.insertion.info("Left on clipboard")
            return .clipboardOnly
        }
    }

    private static func isAXHostile(_ app: NSRunningApplication?) -> Bool {
        guard let app else { return false }
        let haystack = [(app.bundleIdentifier ?? ""), (app.localizedName ?? "")]
            .joined(separator: " ")
            .lowercased()
        return axHostileNeedles.contains { haystack.contains($0) }
    }
}
