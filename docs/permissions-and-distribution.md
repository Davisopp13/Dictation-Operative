# Permissions, signing, and distribution

## Why the app is non-sandboxed

Two core features are incompatible with the App Sandbox:

1. **Accessibility text insertion** — writing `kAXSelectedTextAttribute` on other apps' UI elements requires the user to add the app to *System Settings → Privacy & Security → Accessibility*, and sandboxed apps cannot use the AX API on other processes.
2. **CGEvent posting** (the simulated ⌘V paste fallback) — also gated on Accessibility trust.

Every app in this category (Wispr Flow, Spokenly, Superwhisper, VoiceInk) is non-sandboxed and distributed outside the Mac App Store. So are we.

## TCC (permission) behavior

| Permission | API | Notes |
|---|---|---|
| Microphone | `AVCaptureDevice.requestAccess(for: .audio)` | Requires `NSMicrophoneUsageDescription` in Info.plist (generated from `project.yml`); the process is killed if the key is missing. |
| Accessibility | `AXIsProcessTrustedWithOptions` (prompt), `AXIsProcessTrusted` (poll) | There is **no notification** when the user flips the toggle — onboarding polls once per second while visible. Deep link: `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`. |

### Signing identity churn during development

TCC keys grants to the app's **code signing identity + bundle ID**. Consequences:

- **Ad-hoc signed builds get a new identity every rebuild** → macOS silently drops the Accessibility grant and the paste fallback stops working with no error. This looks like a mysterious bug; it isn't.
- Fix: select a real team in Xcode's Signing & Capabilities (a free Apple ID's "Sign to Run Locally" certificate works). `project.yml` sets `CODE_SIGN_STYLE: Automatic`.
- If insertion stops working after a rebuild, remove and re-add the app in the Accessibility list.

## Distribution pipeline (when we ship)

1. Archive with a **Developer ID Application** certificate, hardened runtime enabled (already set in `project.yml`; the mic entitlement `com.apple.security.device.audio-input` is required under hardened runtime).
2. Notarize: `xcrun notarytool submit Dictation.zip --keychain-profile <profile> --wait`, then `xcrun stapler staple Dictation.app`.
3. Ship as a DMG; add Sparkle for updates in Phase 2.

## CI note

CI builds with `CODE_SIGNING_ALLOWED=NO` — it verifies compilation only. Signing, notarization, and TCC behavior can only be exercised on a real Mac.
