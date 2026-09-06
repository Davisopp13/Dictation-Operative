import ApplicationServices
import Foundation
import os

/// Direct insertion via the Accessibility API: set the focused element's
/// selected text, which replaces the selection or inserts at the caret.
/// Best-effort by design — returns false on ANY doubt so the caller can
/// fall back to pasting.
enum AXInserter {
    static func insert(_ text: String) -> Bool {
        guard let element = focusedTextElement() else { return false }

        var settable = DarwinBoolean(false)
        let settableErr = AXUIElementIsAttributeSettable(
            element,
            kAXSelectedTextAttribute as CFString,
            &settable
        )
        guard settableErr == .success, settable.boolValue else {
            Log.insertion.debug("AX: selected text not settable (\(settableErr.rawValue))")
            return false
        }

        let setErr = AXUIElementSetAttributeValue(
            element,
            kAXSelectedTextAttribute as CFString,
            text as CFString
        )
        guard setErr == .success else {
            Log.insertion.debug("AX: set failed (\(setErr.rawValue))")
            return false
        }
        return true
    }

    enum ReplaceOutcome {
        case replaced
        /// The element doesn't expose text ranges; a key-based fallback is reasonable.
        case unsupported
        /// The text before the caret is not what we inserted (caret moved, text
        /// edited). The caller must NOT fall back to blind key events.
        case mismatch
    }

    /// Replaces the `old` text that should sit immediately before the caret
    /// with `new`, after verifying via `AXStringForRange` that it is really
    /// there. Used by voice commands ("scratch that").
    static func replaceTrailing(_ old: String, with new: String) -> ReplaceOutcome {
        guard let element = focusedTextElement() else { return .unsupported }

        var rangeRef: CFTypeRef?
        let rangeErr = AXUIElementCopyAttributeValue(
            element,
            kAXSelectedTextRangeAttribute as CFString,
            &rangeRef
        )
        guard rangeErr == .success, let rangeValue = rangeRef,
              CFGetTypeID(rangeValue) == AXValueGetTypeID() else {
            Log.insertion.debug("AX: no selected range (\(rangeErr.rawValue))")
            return .unsupported
        }
        var selection = CFRange()
        guard AXValueGetValue(rangeValue as! AXValue, .cfRange, &selection) else {
            return .unsupported
        }

        // AX ranges are in UTF-16 units, like NSString.
        let length = (old as NSString).length
        guard selection.length == 0, selection.location >= length else {
            Log.insertion.debug("AX: caret not directly after last insertion")
            return .mismatch
        }
        var target = CFRange(location: selection.location - length, length: length)
        guard let targetValue = AXValueCreate(.cfRange, &target) else { return .unsupported }

        var stringRef: CFTypeRef?
        let readErr = AXUIElementCopyParameterizedAttributeValue(
            element,
            kAXStringForRangeParameterizedAttribute as CFString,
            targetValue,
            &stringRef
        )
        guard readErr == .success else {
            Log.insertion.debug("AX: string-for-range unsupported (\(readErr.rawValue))")
            return .unsupported
        }
        guard let current = stringRef as? String, current == old else {
            Log.insertion.debug("AX: text before caret differs from last insertion")
            return .mismatch
        }

        let selectErr = AXUIElementSetAttributeValue(
            element,
            kAXSelectedTextRangeAttribute as CFString,
            targetValue
        )
        guard selectErr == .success else { return .unsupported }
        let setErr = AXUIElementSetAttributeValue(
            element,
            kAXSelectedTextAttribute as CFString,
            new as CFString
        )
        guard setErr == .success else {
            // Selection is now active; a key-based fallback would delete it
            // plus more, so refuse rather than fall through.
            Log.insertion.debug("AX: replace failed after selecting (\(setErr.rawValue))")
            return .mismatch
        }
        return .replaced
    }

    /// The focused UI element, or nil when AX is untrusted, nothing is
    /// focused, or the element is a password field.
    private static func focusedTextElement() -> AXUIElement? {
        guard AXIsProcessTrusted() else { return nil }

        let systemWide = AXUIElementCreateSystemWide()
        var focusedRef: CFTypeRef?
        let focusErr = AXUIElementCopyAttributeValue(
            systemWide,
            kAXFocusedUIElementAttribute as CFString,
            &focusedRef
        )
        guard focusErr == .success, let ref = focusedRef,
              CFGetTypeID(ref) == AXUIElementGetTypeID() else {
            Log.insertion.debug("AX: no focused element (\(focusErr.rawValue))")
            return nil
        }
        let element = ref as! AXUIElement

        // Never write into password fields via AX. (kAXSecureTextFieldRole
        // is not exported to Swift; the raw role string is stable API.)
        var roleRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef) == .success,
           let role = roleRef as? String,
           role == "AXSecureTextField" {
            Log.insertion.debug("AX: secure field, skipping")
            return nil
        }
        return element
    }
}
