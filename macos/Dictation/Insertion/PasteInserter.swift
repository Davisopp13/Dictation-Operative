import AppKit
import ApplicationServices
import Foundation

/// Fallback insertion: put the text on the pasteboard, synthesize ⌘V, then
/// restore the previous pasteboard contents. Works in apps the AX path can't
/// reach (terminals, many Electron apps, secure fields).
enum PasteInserter {
    /// Delay between posting ⌘V and restoring the clipboard. Too short and the
    /// target app pastes the restored (old) contents instead of our text.
    static let restoreDelay: Duration = .milliseconds(300)

    private static let kVK_ANSI_V: CGKeyCode = 9

    enum Outcome {
        case pasted
        /// CGEvent posting unavailable (Accessibility trust revoked); the text
        /// was left on the clipboard for a manual paste.
        case clipboardOnly
    }

    @MainActor
    static func insert(_ text: String) async -> Outcome {
        let pasteboard = NSPasteboard.general

        // Snapshot current contents so we can restore them afterwards.
        let savedItems: [NSPasteboardItem] = (pasteboard.pasteboardItems ?? []).map { item in
            let copy = NSPasteboardItem()
            for type in item.types {
                if let data = item.data(forType: type) {
                    copy.setData(data, forType: type)
                }
            }
            return copy
        }

        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        let ourChangeCount = pasteboard.changeCount

        guard AXIsProcessTrusted(), postCommandV() else {
            // Leave our text on the clipboard so the user can paste manually.
            return .clipboardOnly
        }

        try? await Task.sleep(for: restoreDelay)

        // Restore only if nothing else (e.g. a clipboard manager) wrote since.
        if pasteboard.changeCount == ourChangeCount {
            pasteboard.clearContents()
            if !savedItems.isEmpty {
                pasteboard.writeObjects(savedItems)
            }
        }
        return .pasted
    }

    private static func postCommandV() -> Bool {
        let source = CGEventSource(stateID: .combinedSessionState)
        guard
            let keyDown = CGEvent(keyboardEventSource: source, virtualKey: kVK_ANSI_V, keyDown: true),
            let keyUp = CGEvent(keyboardEventSource: source, virtualKey: kVK_ANSI_V, keyDown: false)
        else {
            return false
        }
        keyDown.flags = .maskCommand
        keyUp.flags = .maskCommand
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
        return true
    }
}
