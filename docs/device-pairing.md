# QR and six-character device pairing

## User flow

1. Open Sync on either device and choose **Pair a device**.
2. Scan the QR code with the phone’s camera, or open Sync on the second device and enter the six-character code. Codes accept lowercase, spaces, and hyphens; ambiguous O/0 and I/1 are excluded.
3. Compare the 12-character confirmation fingerprint shown on both devices. On the device that created the code, choose **They match — pair devices**.
4. Both devices save the pairing and connect. Clipboard transfer controls continue to work as before.

Codes expire after five minutes. A claimed code cannot be used by a different device. Cancel or let the code expire to start again. Close/reload before completion loses the temporary exchange keys and requires a new code. Previously paired devices are preserved, and legacy invitations can still be entered under **Pair with an older app version**.

QR links open the private web workspace’s `/pair` page. Users may need to sign in with the account that has access to this website. The phone’s native camera opens the browser; the app does not request camera permission.

## Implementation and validation

- Portable Web Crypto pairing: `Shared/Sync/pairing.ts`, copied exactly to the separate PWA repository.
- Native pairing: `macos/Dictation/Sync/SyncPairing.swift`, with Keychain persistence after approval.
- Relay: additive `PairingSession` Durable Object and `v2` migration; existing transfer endpoints and pairs are retained.
- Private ECDH keys and encryption keys never reach the relay. See `Shared/Sync/README.md` for the wire format, authentication model, and retention details.
- Passed: 17 Miniflare relay tests, 26 web tests, five native Sync tests, web lint/typecheck/production build, relay typecheck, and signed native Release build verification.
- The native tests match both host and guest key derivation to the fixed Web Crypto fixture.
- Generated web and native QR images were decoded with Apple Vision to the exact expected pairing URL. This is an image-level scan check, not a physical two-device camera test.

## Prepared release

- Saved private Sites version: 8.
- PWA commit: `f3f454c56ebe01fe06b74031930b46d823ce2bb2`.
- Signed Mac app: `DerivedData/Build/Products/Release/Dictation.app`.
- Published private Sites version 8 on September 7, 2026; existing owner-only access retained.
- Relay deployed with version `0cdd24da-1230-466f-ad4e-2c4c845da896` and the additive v2 migration.
- Signed Mac update installed in `/Applications/Dictation.app` and restarted. Prior app retained at `/Applications/.dictation-install.lFLczJ/Previous-Dictation.app`.
- A live synthetic Swift-to-Web Crypto pairing passed: matching confirmation, explicit host approval, and an encrypted native-to-web text transfer. The synthetic pair was revoked afterward; no personal clipboard was read or changed.

Rollout order: deploy the relay (including the additive Durable Object migration), deploy saved private Sites version 8, then quit and install the signed Mac app with `macos/scripts/install-app.sh`. The installer verifies the signing identity and preserves the previous application bundle for recovery. Do not use the unsigned Debug build as a daily-use replacement.

## Browser fetch correction

Private Sites version 9 corrects the browser-only “Failed to execute fetch on Window: Illegal invocation” error in code creation and entry. Default network calls now invoke `globalThis.fetch` through a wrapper instead of retaining the native function as a class method. The new regression test reproduces the browser receiver requirement and failed on the previous implementation. All 27 web tests, lint, type checking, and the production build pass. PWA commit: `f298c39affef1bb97f2f7d70a9d38a226905014d`. Refresh an already-open browser tab after deployment to load the correction.
