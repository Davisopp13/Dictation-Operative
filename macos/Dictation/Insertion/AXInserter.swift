import ApplicationServices
import Foundation
import os

/// Direct insertion via the Accessibility API: set the focused element's
/// selected text, which replaces the selection or inserts at the caret.
/// Best-effort by design — returns false on ANY doubt so the caller can
/// fall back to pasting.
enum AXInserter {
    static func insert(_ text: String) -> Bool {
        guard AXIsProcessTrusted() else { return false }

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
            return false
        }
        let element = ref as! AXUIElement

        // Never write into password fields via AX. (kAXSecureTextFieldRole
        // is not exported to Swift; the raw role string is stable API.)
        var roleRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef) == .success,
           let role = roleRef as? String,
           role == "AXSecureTextField" {
            Log.insertion.debug("AX: secure field, skipping")
            return false
        }

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
}
