# iOS keyboard constraints — read before designing Phase 3

This document captures hard platform limits verified in the Phase 0 research (Apple docs, Apple Developer Forums, and how every shipping competitor works). None of these can be engineered around.

## The three hard limits

1. **Keyboard extensions have no microphone access.** Apple's App Extension Programming Guide is explicit: custom keyboards "have no access to the device microphone, so dictation input is not possible." The runtime confirms it — recording from an extension fails with a missing-entitlement error (Forums #742601). "Full Access" (`RequestsOpenAccess`) grants **network + App Group container only**, not the mic.
2. **Memory cap ~48 MB working set** (developer-observed, not officially documented; treat as a planning estimate). Even Whisper *tiny* doesn't fit. On-device transcription inside the keyboard is impossible.
3. **No reliable programmatic return to the host app.** As of iOS 26.4 Apple killed the private host-bundle-ID paths keyboards used (`_hostBundleID` returns null; Forums #826851, KeyboardKit feedback FB22247647). Wispr Flow's own docs now tell users to *manually swipe back*.

## The only shipping pattern (Wispr Flow, Spokenly, SpeakUp, Diction)

```
keyboard (mic button)
   │ extensionContext.open(deep link)         ← public API only; the responder-chain
   ▼                                            openURL hack is explicitly disallowed by Apple DTS
containing app: record (AVAudioEngine) → transcribe → cleanup
   │ write transcript to App Group container
   │ post Darwin notification
   ▼
user swipes back manually (iOS 26.4+)
   ▼
keyboard reads App Group → inserts via UITextDocumentProxy
```

Implementation notes:

- App Group + `UserDefaults(suiteName:)` + `CFNotificationCenterGetDarwinNotifyCenter` for signaling.
- One deep-link scheme **per build configuration** (debug/release) to avoid cross-app confusion.
- The pattern passes App Review — all the apps above are live — but the *mechanism* matters: use `extensionContext.open` / SwiftUI's `openURL`, Full Access, App Groups.

## What iOS 26 changes (and doesn't)

- **SpeechAnalyzer / SpeechTranscriber** (iOS 26): fast on-device transcription with no 1-minute session cap — great for the **containing app** (MacStories measured it 55% faster than Whisper Large V3 Turbo on a 34-minute file). It does **nothing** for the keyboard's mic/memory limits, and it lacks the custom-vocabulary support the older `SFSpeechRecognizer` had.
- Local Whisper-class models in the containing app realistically need **iPhone 15 or newer**; older devices should use cloud (Groq/Deepgram).

## Product consequences

- The keyboard is a **convenience**, not the flagship path. Ship App Intents/Shortcuts (Action Button!), the share sheet, and main-app long-form dictation as first-class capture paths.
- Set user expectations honestly around the round-trip ("swipe back" screen, like Wispr Flow).
- Re-check the auto-return situation before building: if Apple ships a public API (track FB22247647), the UX improves materially.
