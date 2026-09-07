# Sync v1 validation — September 6, 2026

## Implemented and available

- Private PWA updated at https://do-voice-workspace.davisopp.chatgpt.site/ (Sites version 4; source `9d8cfd8a0ca96afdfacf18db46f32897c0741469`). Native app updated locally in `/Applications/Dictation.app`.
- Separate HTTPS relay deployed at https://dictation-operative-sync.davisopp.workers.dev. Internet transport works across networks; no direct LAN transport/discovery.
- Independent pairing authorization with host approval, selected/named peers, bidirectional revocation, pause, explicit text/image send and receive, progress/errors, optional native automatic clipboard and completed-dictation delivery. No transcription-provider setup needed for clipboard Sync.
- Lossless PNG ≤8 MiB / 40 MP; text ≤256 KiB. Native TIFF conversion; browser paste fallback. Transfer storage is active for at most two minutes, cleared on receipt/replacement/revocation. Provider backups have separate retention; see protocol documentation.

## Passed

- 9 relay integration tests against Miniflare and real Durable Object SQLite: text both directions, chunked >1 MB PNG, exact image bytes, acknowledgement, latest-wins replacement, stale sequence rejection, idempotent duplicate commit after receipt, incomplete-upload isolation and replacement retry, authenticated-metadata tamper rejection, simultaneous bidirectional sends, unauthorized/CORS rejection, size/format limits, guest cannot self-approve, and expired pending-upload deletion.
- 21 existing PWA tests; lint, TypeScript check, production build.
- 53 native XCTest tests, including new cross-language key/invitation checks, native PNG pasteboard round-trip, received-marker exclusion, stale-write rejection, TIFF-to-PNG dimensions/transparency, file-reference rejection, and malformed/oversized input validation. Existing dictation tests remain green.
- Live internet relay, real Web Crypto protocol client ↔ compiled Swift/CryptoKit/NSPasteboard adapter in both directions. Text including Unicode; 64×32 PNG with transparent, semitransparent, and opaque bands. PNG digest, dimensions, and alpha preserved. Isolated native pasteboard verifies receive marker and concurrent local-copy protection. Test pairs revoked afterward.
- Real published PWA UI: create invitation, host approval of named companion, receive native text and image, send clipboard text and actual PNG back to the native adapter, transfer progress/success, and remove an already-revoked device.
- Normal Cmd-V into TextEdit from the native **general** clipboard: expected test text appeared, and PNG pasted as an actual attached image. TextEdit requested its normal RTFD conversion for image support. Synthetic document discarded, test trust removed, and original system clipboard restored. Embedded browser automation has its own isolated clipboard, so native paste was validated separately through the native adapter.

## Measured latency

Three synthetic text runs from the protocol client through the deployed internet relay to native pasteboard completion: **479, 438, 424 ms**. These include launching a new native test process. Both clients ran on the same Mac/network; receiver fetched immediately. They do not include automatic polling delay (up to approximately one second normally), sleeping devices, iPhone permission prompts, or mobile network conditions. No universal near-instant claim is made.

## Remaining physical/platform checks

A second physical device was not available to automation. iPhone/iPad Safari and home-screen PWA behavior, cross-network latency, and Windows/Linux browser clipboard permissions remain unverified on hardware. Native Windows/Linux/iOS adapters and an iOS share extension are not implemented. Native automatic reconnect logic is implemented, but a full sleep/wake/offline test of the running app is still required; protocol reconnection/retry, expiry, and native stale-write/loop-marker safeguards were tested separately. Mac menu-only UI automation timed out, so the native settings screen itself was not visually checked.

For final physical validation, pair the Mac and phone, send text both directions, copy a screenshot with transparency where available, receive/paste in Notes or another image-capable app, pause/resume, turn networking off and back on, and confirm pending older items require explicit receive. Test concurrent copies with automatic Mac mode enabled, then remove trust and confirm further requests are rejected. iOS must be open and use explicit buttons; continuous background clipboard monitoring is not supported.

The local Mac build uses the available ad-hoc signing setup. This machine has no valid stable signing identity; macOS may request Accessibility approval again for dictation insertion after replacing the binary. Sync clipboard actions themselves do not require Accessibility.
