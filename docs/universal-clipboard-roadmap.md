# DO Universal Clipboard — implementation roadmap

Prepared September 7, 2026. Status: proposed implementation plan; no new platform support is claimed by this document.

## Product outcome

**Copy text or an image on one device and use it on another, across macOS, Windows, Linux, iOS, and Android, through DO.** Dictation is one source of clipboard content alongside copied text, links, screenshots, and shared images.

Universal Clipboard is a first-class DO capability. A device can participate without a transcription model, microphone permission, AI provider key, or a completed dictation implementation for that platform. Existing DO applications expose it in their settings and primary actions; new platforms can initially ship a small DO companion.

The first complete release supports all five operating systems. Desktop automatic syncing is opt-in on supported environments. Phone sharing uses fast, explicit actions. “Universal” describes device coverage; the interface explains where an operating system requires an action before reading or writing its clipboard.

Primary workflows:

1. Copy on Windows, paste on Mac or supported Linux desktop.
2. Share text or a screenshot from iPhone or Android to a selected computer, then paste there.
3. Copy on a computer, open DO on a phone, receive and copy, then paste into another app.
4. Send completed DO dictation through the same delivery path.
5. Select several trusted destinations and distribute a new copy without switching device selection repeatedly.

## Starting point: retain the working foundation

| Area | Existing implementation | Remaining work |
| --- | --- | --- |
| Trust | Expiring invitation, explicit host approval, independently authorized pairs, names and revocation | Easier pairing, capability negotiation, management across several peers |
| Transport | HTTPS relay using a SQLite-backed Durable Object per pair | Lower delivery latency if measurements justify it; multi-peer operation |
| Encryption | AES-GCM payloads, authenticated envelope fields, separate device authorization | Cross-language fixtures, compatibility rules for new clients |
| Payloads | UTF-8 text up to 256 KiB; PNG up to 8 MiB / 40 MP; chunked upload | Native format conversion and real destination-app coverage on each OS |
| macOS | Explicit send/receive, optional automatic clipboard and completed-dictation delivery | Physical reliability pass, conflict handling audit, polished controls |
| PWA | Foreground explicit text/image send and receive | Phone acceptance, capability messages, continued compatibility |
| Other native platforms | iOS and Windows directories reserved; no Android/Linux adapters | Build the clients below |
| Retention | Latest pending transfer per recipient; two-minute active relay expiry | Consistent expiry and status across every client |

Sources of truth: [protocol](../Shared/Sync/README.md), [validation report](sync-validation.md), [Mac Sync implementation](../macos/Dictation/Sync/SyncService.swift), and [hands-on testing guide](manual-testing-guide.md).

The measured 424–479 ms runs were synthetic protocol-client-to-Mac-pasteboard tests on one Mac/network. They exclude mobile behavior, dictation processing, and normal polling delay. They are a baseline, not a universal latency claim.

## Platform experience and constraints

| Platform | Send | Receive | Automatic behavior targeted for release |
| --- | --- | --- | --- |
| macOS | Copy normally when enabled; menu action; completed dictation | Write local clipboard, then normal paste | While DO is running in an unlocked user session |
| Windows | Clipboard listener; tray action | Write local clipboard, then normal paste | While DO is running in an unlocked user session |
| Linux X11 | Observe CLIPBOARD selection; tray/window action | Own and serve clipboard data | In explicitly tested X11 sessions |
| Linux Wayland | Supported compositor data-control interface; explicit fallback | Supported interface or focused app copy | Only where runtime capability checks and hardware tests pass |
| iOS/iPadOS | Share extension; user-initiated Paste in DO; later Shortcuts | Open DO, receive, then Copy | Foreground delivery status; no promise of continuous background clipboard monitoring |
| Android | Sharesheet target; user-initiated Paste in DO | Open DO, receive, then Copy | Foreground operation; no background-monitoring promise for a normal app |
| Browser/PWA | Explicit paste/share where available | Explicit Receive/Copy | Foreground, subject to browser permission and activation rules |

Windows exposes clipboard-change notifications through `AddClipboardFormatListener`. Linux Wayland provides an optional privileged data-control protocol, so support must be established per compositor rather than inferred from the word “Linux.” [Microsoft API](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-addclipboardformatlistener), [Wayland protocol](https://github.com/wayland-mirror/wayland-protocols/blob/main/staging/ext-data-control/ext-data-control-v1.xml).

Android restricts clipboard reads to the focused app or default input method on Android 10 and later. A foreground service is not equivalent to having app focus. The initial client uses ordinary sharing and foreground UI. [Android clipboard restrictions](https://developer.android.com/about/versions/10/privacy/changes#clipboard-data).

iOS uses a deliberate Paste control and Share extension. Treat suspended-app execution as opportunistic, never the basis for a guaranteed clipboard service. [Apple Paste control](https://developer.apple.com/documentation/uikit/uipastecontrol), [Apple background behavior](https://support.apple.com/en-ie/118408).

## Architecture decisions

### Shared protocol, native clipboard adapters

Retain the relay and current Swift/TypeScript implementations. Publish a language-neutral specification, binary fixtures, and conformance tests under `Shared/Sync/`. Share behavior and test vectors first; do not make all existing clients migrate to a new runtime before another OS can ship.

Each client separates four responsibilities: platform clipboard/share access, delivery/conflict policy, encryption/protocol, and transport. The adapter reports supported content types, available automatic operations, foreground requirements, and current permissions. The UI offers actions based on these capabilities.

Recommended starting stacks are Swift/SwiftUI for iOS with reusable Swift Sync code, C#/.NET with Win32 clipboard integration for Windows, Kotlin/Compose for Android, and a small Rust-based Linux service/UI with platform adapters. Validate packaging and clipboard access in short spikes before finalizing new desktop frameworks. The web client retains Web Crypto. Framework choice does not change the wire protocol.

### Selected peers first, then fan-out

Keep independent pairwise trust for the first universal release. A sender encrypts separately for every explicitly selected recipient. A received item is never automatically forwarded. Pairing Mac with phone and Mac with Windows does not authorize phone-to-Windows access.

Start with a supported set of up to five devices. Full connectivity across five devices requires ten approved pair relationships; make this setup cost visible. “Send to selected devices” means only directly paired destinations. A later account-backed device directory may simplify discovery, but cannot silently confer decryption rights.

Retain selected-device behavior for existing v1 clients. Introduce capabilities and a versioned successor protocol before adding authenticated origin IDs or changing payload structure. Do not silently change v1 AAD, key derivation, or envelope semantics. New-to-old transfers use v1-compatible behavior or show an explicit upgrade requirement.

### Freshness and conflicts before speed

Transport arrival order is not proof of user intent. Preserve per-sender sequence ordering, local clipboard revision checks, and a new baseline after reconnect. Audit the existing comparison between sender wall-clock time and receiver local-copy time; clock skew must not decide which clipboard wins.

Specify and test a deterministic receiver state machine before multi-peer automatic receive ships. A local copy during an in-flight receive wins. Simultaneous remote candidates from different devices remain available for explicit selection when ordering is ambiguous; there is no global clipboard consensus in release one. Applying a remote item must suppress echo, including native format conversions and interactions with other clipboard-sync tools.

Resume, unlock, or reconnect does not silently apply an already-pending item. Show it for explicit receipt until it expires. Old items are not replayed later from an offline queue.

### Delivery status has a precise meaning

Use separate states for uploading, available on relay, received by DO, copied to destination clipboard, expired, superseded, and failed. A mobile recipient opening a notification or downloading bytes is not yet a successful clipboard copy. A recipient unable to confirm the final state must be shown as unconfirmed.

Keep the two-minute active relay lifetime initially. Explain the timer and provide Resend while the sender still has the content. Temporary mobile image files have a separately documented, bounded cleanup policy that allows ordinary pasting; relay expiry does not remotely clear a clipboard or erase a recipient's copy. Retrying or acknowledging a transfer must never cause duplicate clipboard writes.

## Delivery sequence

Milestones describe engineering order, not calendar commitments. Hardware availability, signing, and the Linux compatibility spike determine dates. Every phase ends with a usable increment. M0 is the immediate next work; M1 precedes new client implementations. M2–M5 can change order after the spikes, but all are required for five-platform coverage.

| Milestone | Deliverable | Dependencies | Relative effort |
| --- | --- | --- | --- |
| M0 | Verified Mac ↔ physical phone baseline and platform spikes | Existing Sync | Small–medium |
| M1 | Stable client contract and reliable desktop delivery | M0 | Medium |
| M2 | Windows companion | M1 | Medium |
| M3 | Native iOS companion and sharing | M1; Apple device/signing access | Medium–large |
| M4 | Native Android companion and sharing | M1; Android device access | Medium |
| M5 | Linux adapter with published session support | M1; successful compositor spike | Large / highest uncertainty |
| M6 | Multi-device selection and automatic fan-out | M1 and at least three working clients | Medium–large |
| M7 | Five-platform release qualification and packaging | M2–M6 | Medium–large |

### M0 — verify the baseline and probe platform access

- Run existing Sync test cases on a physical Mac and iPhone/PWA, same Wi-Fi and separate networks. Record exact device, OS, app build, and result.
- Exercise bidirectional text and transparent PNG, pause/resume, sleep/wake, clipboard changes during download, expiry, and revocation.
- Measure copy/send action to destination clipboard availability; report dictation processing separately.
- Create minimal Windows, Android, iOS, and Linux clipboard/share spikes. Probe GNOME Wayland, KDE Wayland, a wlroots-based session, and X11 independently; record versions and available interfaces. A missing automatic interface yields an explicit-mode result and a separately scoped integration investigation.
- Inventory build/signing tools and actual test hardware. Emulators and protocol harnesses do not close physical acceptance gates.

**Exit:** baseline results recorded; failures have reproduction steps; each future OS has a feasible explicit send/receive path; automatic-mode support is documented as confirmed, failed, or unverified. Fix baseline data-loss, wrong-destination, or stale-overwrite failures before M1.

### M1 — stabilize shared behavior and desktop reliability

- Define adapter capabilities, state transitions, errors, ordering, acknowledgement, cancellation, expiry, and migration behavior in the shared specification.
- Add cross-language fixtures for pairing, key derivation, Unicode, image bytes, malformed envelopes, tampering, limits, and retries.
- Implement the conflict policy, local-change protection, echo suppression, and lock/unlock baseline behavior consistently in Mac and PWA.
- Make Sync usable independently of microphone/Accessibility setup and AI onboarding. Separate permission prompts for dictation insertion from clipboard operations.
- Improve Mac controls: named destination, independent automatic send/receive toggles, text/image preferences, pause, and intelligible last-transfer status.
- Measure polling under a one-peer and five-device test. Retain it if it meets the target. If it does not, implement authenticated change notifications/long polling or WebSockets with reconnect and polling fallback; notifications trigger normal authenticated fetch/decrypt and contain no plaintext. Do not assume native sockets keep phone apps alive.
- Keep protocol-copy parity checks between shared TypeScript and the separate PWA repository.

**Exit:** existing clients remain compatible; conformance tests pass; ordinary text on awake, connected desktop clients targets p95 ≤2 seconds from copy to remote clipboard in a documented test environment. This is an engineering target, not an internet-wide guarantee. Zero unexpected overwrites or duplicate writes in the acceptance scenarios.

### M2 — Windows clipboard companion

- Build a tray application with pairing, named peers, explicit send/receive, opt-in automatic modes, pause, and optional start at login.
- Use clipboard-change notifications, a dedicated clipboard execution context, bounded retries when another process owns the clipboard, and sequence/revision checks around reads and writes.
- Support Unicode text and image conversion to/from canonical PNG, including common Windows bitmap representations and alpha. Preserve text meaning and line breaks; define OS newline conversion in the adapter contract.
- Protect pairing material using the OS credential/encryption facilities. Avoid requiring administrator rights for normal clipboard operation.
- Test interaction with Windows clipboard history/cloud sync; incoming DO content must not bounce indefinitely between sync products.
- Produce an installable build with uninstall/update handling. Select supported Windows versions from the tested release matrix.

**Exit:** Windows ↔ Mac and Windows ↔ PWA pass text/image, restart, offline, expiry, conflict, and revocation scenarios in normal user sessions. A real second desktop proves the first automatic cross-platform workflow.

### M3 — native iOS/iPadOS sharing companion

- Reuse/extract Swift protocol and transport code without importing macOS pasteboard APIs. Add a small SwiftUI device list, invitation entry/QR flow, send screen, and receive/copy screen.
- Add a Share extension for text, URLs as text, and supported images. Select a trusted destination and complete the transfer within extension lifecycle limits; show failure/retry honestly if interrupted.
- Share required configuration through an App Group and secrets through correctly scoped Keychain access. The extension must not depend on a private mechanism to launch the containing app. [Apple extension sharing](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html).
- Use `UIPasteControl` for clipboard input and explicit Copy for received content. Support the normal share sheet as an alternate output when an app does not accept an image paste.
- Add App Intents/Shortcuts only after the main path passes. Prototype their exact foreground/unlock behavior before promising one-tap clipboard actions.
- Add an invitation QR scanner with camera access requested at scan time, plus manual invitation entry. Never send secret-bearing invitation text to analytics, third-party QR services, or navigation URLs.
- Package a signed device build/TestFlight candidate. Keep the PWA available as the interim browser client.

**Exit:** on real iPhone hardware, share text/image to Mac and Windows, receive/copy in reverse, paste into a notes app and another representative app, cancel permission prompts, background/terminate mid-transfer, and retry without duplicate delivery. Include iPad separately before advertising iPad coverage.

### M4 — Android sharing companion

- Implement Kotlin protocol/crypto using M1 fixtures and store keys with platform-backed protection.
- Register narrowly scoped Sharesheet input for text and supported images, display destination/content, and send after user action. [Android share input](https://developer.android.com/develop/ui/compose/sharing/receive).
- Provide foreground Paste/Send and Receive/Copy. For images, use a temporary content provider URI with narrowly scoped read grants and predictable cleanup so destination apps can actually paste the image.
- Handle denied/revoked URI access, app recreation, interrupted uploads, system clipboard clearing, and temporary file expiry.
- Consider an app shortcut or tile that opens the relevant screen after the core flow works. A custom keyboard, accessibility service, root, or debugging permission is not a prerequisite for this release.
- Produce a signed internal-test build. Verify at least a Pixel-class device and a Samsung device or explicitly narrow the supported device claim until both pass.

**Exit:** Android ↔ Mac/Windows/iPhone passes text and image workflows, battery saver/background interruption, screen lock, permissions, expiry, and retry on physical devices. No UI implies that DO can continuously read other apps' clipboard in the background.

### M5 — Linux support with an explicit compatibility matrix

- Implement X11 CLIPBOARD ownership/selection transfer, MIME negotiation, and asynchronous reads. Keep PRIMARY selection separate and disabled for sync by default.
- Implement Wayland support using interfaces actually exposed by the compositor, preferring the standardized data-control interface when available. Test older supported interfaces separately; never infer capability from distribution name.
- For environments lacking automatic access, ship a focused DO window for explicit Paste/Send and Receive/Copy and document the extra action. Investigate desktop-specific integration separately; do not make broad privileges a silent installation step.
- Test text/image pasting in native Wayland applications and XWayland applications, source-app exit, clipboard-owner exit, session logout, and clipboard managers running alongside DO.
- Provide a user-session process, optional login startup, OS secret-store integration where available, and a visible locked/unavailable state if secure key storage cannot be opened.
- Choose initial packaging after verifying sandbox clipboard access. Publish tested distribution, desktop/compositor version, display protocol, package type, and automatic/explicit support. Flatpak permissions require their own test pass. [Flatpak permissions](https://docs.flatpak.org/en/latest/sandbox-permissions.html).

**Exit:** a documented X11 target and at least one Wayland target pass bidirectional text/images with Mac and Windows. GNOME/KDE/wlroots environments each have recorded results; any explicit-only or unsupported environment is plainly named. “Linux support” is not used to imply automatic support on every desktop.

### M6 — make several devices feel like one clipboard

- Replace the single destination control with a saved selection of directly trusted peers. Show per-device automatic-send and receive settings and online/last-seen status without claiming a sleeping mobile app is ready to copy.
- Implement separate per-peer uploads and acknowledgements. One offline, revoked, or incompatible recipient does not block other destinations.
- Add authenticated origin/item identifiers in the negotiated successor protocol, deduplicate per logical item, and suppress re-broadcast of received content. Content hashes alone must not permanently suppress a later intentional copy of identical text.
- Distinguish app-internal dictation paste/restore operations from a user's copy. Completed dictation sent explicitly and observed on the clipboard must not create two transfers or broadcast a restored clipboard accidentally.
- Provide a device-trust view that shows which direct links exist and which still need approval. Remove/revoke each link explicitly; local removal must not falsely claim global revocation of every other pair.
- Test with competing sync mechanisms enabled, including Apple's clipboard handoff where available, and document configuration if independent tools defeat origin markers.

**Exit:** five devices participate without requiring a Mac to remain online as a hub; three-way bursts and simultaneous copies produce the specified outcome; per-recipient state is accurate; no forwarding loops, unapproved delivery, or stale replay occurs.

### M7 — qualify and release all five platforms

- Run the full pair matrix: 10 platform pairs, both directions (20 directed paths), with plain text and PNG. Repeat Linux paths for each advertised session type. Run a five-device session for fan-out and independent failures.
- Test normal text, emoji, combining characters, right-to-left text, multiple paragraphs, URLs, large text, PNG transparency, screenshot conversions, limit boundaries, corrupt input, partial uploads, and multiple MIME representations. Image losslessness is measured after canonical PNG conversion; decoding a JPEG does not restore its lost detail.
- Exercise conflicting copies, deliberately skewed clocks, restart, sleep/wake, screen lock, network handover, two-minute expiry, cancellation, revocation, and mixed client versions.
- Measure p50/p95 latency and failures using synthetic content and bounded local diagnostics. Include source observation and receiver scheduling, not only relay time. Report mobile user-action time and image size separately. Measure desktop idle CPU/network usage and mobile energy impact before setting operating budgets.
- Run a seven-day daily-use pilot. Resolve incorrect clipboard content, missing success acknowledgements, crashes, pairing loss, and repeated setup failures before release.
- Verify signed packages, updates, uninstall, key removal, and browser compatibility. Before store submission, re-check current App Store/Google Play requirements, privacy declarations, reviewer pairing instructions, minimum OS/target SDKs, and distribution credentials. Do not call builds submission-ready based on this roadmap.

**Exit:** every advertised path has reproducible passing evidence; installation/update recovery works; known limitations are visible in onboarding and release notes. A blocked physical test remains blocked, not passed by an emulator result.

## Release defaults and scope

| Decision | First-release behavior |
| --- | --- |
| Content | Plain text and images normalized to PNG; URLs stay text |
| Automatic mode | Opt-in per device/peer; separately configurable send and receive |
| Phone behavior | Explicit share/paste/send and receive/copy |
| Delivery | Directly approved peers, internet relay, no required same-LAN connection |
| Offline | Latest unexpired pending item; explicit receipt after reconnect; no backlog replay |
| History | No cloud clipboard archive; bounded transient state only |
| Secrets/content | End-to-end encrypted transport; no clipboard contents or keys in logs |
| Sensitive items | Respect available platform sensitivity/exclusion markers; do not claim every secret can be detected |
| Lock state | Pause automatic local clipboard reads/writes while locked; establish fresh baseline on unlock |
| Images/files | Share actual supported image bytes; do not upload arbitrary files just because a file path was copied |
| Accounts | Existing invitation trust; no billing or AI key dependency |

Later extensions, prioritized from observed use: local-network transport with authenticated discovery and relay fallback; easier account-backed device enrollment; deliberately retained encrypted clipboard history; rich text/HTML; file transfer; optional arrival notifications; and additional OS integrations. Local-network mode must retain the same authorization and encryption model. Push notifications are arrival hints, not proof of clipboard access, and must work sensibly with short transfer expiry.

## Initial implementation backlog

| ID | Concrete next task | Completion evidence |
| --- | --- | --- |
| UC-01 | Execute physical Mac ↔ iPhone/PWA Sync acceptance | Dated results in the existing validation report |
| UC-02 | Run Linux compositor and mobile lifecycle spikes | Versioned capability matrix and tiny reproducible prototypes |
| UC-03 | Write receiver state machine and audit wall-clock conflict comparisons | Decision table plus concurrency/skew scenarios |
| UC-04 | Publish shared conformance fixtures and version negotiation design | Swift and TypeScript pass identical fixtures; v1 compatibility described |
| UC-05 | Separate Sync onboarding and permissions from dictation | Clipboard transfer works with no model, microphone, or AI key setup |
| UC-06 | Build Windows text transfer, then PNG transfer | Physical Windows ↔ Mac pass in both directions |
| UC-07 | Build native iOS share/send and receive/copy | Physical iPhone ↔ desktop pass |
| UC-08 | Build Android sharing and receive/copy | Physical Android ↔ desktop/phone pass |
| UC-09 | Implement Linux adapters from UC-02 findings | Advertised session types pass clipboard tests |
| UC-10 | Add saved recipients and pairwise fan-out | Five-device acceptance with one peer offline/revoked |
| UC-11 | Package and run full release qualification | M7 evidence and published support matrix |

The first user-visible milestone is reliable Mac ↔ Windows automatic clipboard sharing with the existing phone/PWA path. The full roadmap deliberately continues through native iOS, Android, Linux, and multi-device operation; a two-platform demo does not complete universal clipboard support.
