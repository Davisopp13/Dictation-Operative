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
- Fix: select an actual Apple Development or Developer ID Application certificate in Xcode's Signing & Capabilities and keep that identity consistent. **“Sign to Run Locally” is ad-hoc signing, not a stable certificate.** `project.yml` sets `CODE_SIGN_STYLE: Automatic`.
- If insertion stops working after a rebuild, remove and re-add the app in the Accessibility list.

## Distribution pipeline

`.github/workflows/release.yml` does the whole thing when a `vX.Y.Z` tag is pushed (design: ADR-0006):

1. Build with a **Developer ID Application** certificate, hardened runtime enabled (set in `project.yml`; the mic entitlement `com.apple.security.device.audio-input` is required under hardened runtime).
2. Notarize the app with `notarytool`, staple it.
3. Wrap it in a DMG (with an `/Applications` symlink), sign, notarize, and staple the DMG.
4. Run Sparkle's `generate_appcast` with the private EdDSA key.
5. Publish DMG + `appcast.xml` as a GitHub release. The app's `SUFeedURL` points at `releases/latest/download/appcast.xml`, so this step ships the update.

### One-time setup

You need a paid Apple Developer account.

| Secret / variable | How to get it |
|---|---|
| `MACOS_CERTIFICATE_P12` (secret) | In Xcode → Settings → Accounts → Manage Certificates, create a **Developer ID Application** certificate. In Keychain Access, export it (certificate + private key) as a `.p12` with a password. Then `base64 -i cert.p12 \| pbcopy` and paste. |
| `MACOS_CERTIFICATE_PASSWORD` (secret) | The password you chose for the `.p12`. |
| `APPLE_TEAM_ID` (secret) | 10-character team id from developer.apple.com → Membership. |
| `APPLE_ID` (secret) | The Apple ID of that account. |
| `APPLE_APP_SPECIFIC_PASSWORD` (secret) | appleid.apple.com → Sign-In and Security → App-Specific Passwords. |
| `SPARKLE_PRIVATE_ED_KEY` (secret) | Download `Sparkle-2.9.6.tar.xz` from the Sparkle releases page, run `bin/generate_keys -x sparkle_private.key` to export the private key, and paste the file's contents. Keep the file somewhere safe and off the repo; losing it means existing installs can never update again. |
| `SPARKLE_PUBLIC_ED_KEY` (**variable**, not secret) | Printed by `generate_keys` (also `generate_keys -p`). Baked into Info.plist as `SUPublicEDKey`. |

Set secrets and variables under GitHub → Settings → Secrets and variables → Actions.

### Cutting a release

```sh
git tag v0.2.0
git push origin v0.2.0
```

Watch the **Release** workflow; when it finishes, the release page has `Dictation-0.2.0.dmg` and `appcast.xml`. Installed copies pick it up on their next automatic check (or via *Check for Updates…* in the menu).

Notes:

- Ad-hoc CI builds and Xcode dev builds have no `SUPublicEDKey`, so their updater is disabled and the menu item is hidden. Install the DMG once to get onto the update track.
- Version numbers: `CFBundleShortVersionString` comes from the tag, `CFBundleVersion` from the workflow run number (Sparkle compares that one numerically).

## CI note

The regular `macOS build` workflow builds with `CODE_SIGNING_ALLOWED=NO` and ad-hoc signs the artifact — it verifies compilation only. TCC behavior can only be exercised on a real Mac.

### Safe local installation

Build daily-use updates with `macos/scripts/build-release.sh`, which selects the
installed Developer ID Application certificate and derives its team automatically.
If several certificates are available, pass the intended certificate SHA-1 as its
first argument. This uses the same signing class as distributed releases.
Then use `macos/scripts/install-app.sh /path/to/Dictation.app`.
It refuses ad-hoc candidates, checks the bundle ID and code signature, checks a
certificate-signed installed app's designated requirement against the candidate,
and requires quitting the running app before replacement. The old bundle is retained
in the reported staging directory. A first transition from ad-hoc to certificate
signing can still need one new permission approval. Do not replace `/Applications/Dictation.app`
with development previews via `ditto` or `cp`; run previews from DerivedData.

Returning users now start at their missing prerequisite, with instructions to
remove an obsolete Accessibility entry and select the actual running bundle.
The app does not reset TCC, write permission databases, or bypass macOS approval.

Reference: https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
