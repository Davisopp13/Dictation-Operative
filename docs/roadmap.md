# Roadmap

Sequencing follows the research conclusion: native shells per platform, shared cloud "brain," macOS first.

## Phase 1 — macOS MVP (current)

Native Swift menu-bar app validating the whole loop: hotkey → record → WhisperKit on-device transcription → optional Groq cleanup → system-wide insertion. Custom dictionary, history, onboarding, BYO API key.

**Exit criteria:** end-to-end dictation feels < ~1.5 s for a short sentence; insertion works in the top 5 daily apps (browser, Slack, VS Code, Notes, Mail — via AX or paste fallback).

## Phase 2 — AI enhancement depth (macOS)

- **Streaming partial transcripts** (WhisperKit LocalAgreement confirmed/hypothesis text) for sub-second perceived latency.
- **Command mode:** "delete last sentence", "make that a bullet list" interpreted as edits, not text.
- **Per-app context:** detect the frontmost app and adjust tone/formatting (casual Slack vs formal Mail). Opt-in only — no screenshots.
- **Modifier-only / Fn hotkeys** via a CGEventTap (the KeyboardShortcuts library is Carbon-based and can't do bare-modifier hotkeys — known MVP limitation).
- **History upgrade** to SQLite (GRDB) with search, replacing the JSON store (see ADR note).
- **More cleanup providers** behind `CleanupProvider`: OpenAI, Anthropic, local llama.cpp; provider/model picker UI.
- **Sparkle auto-updates**, notarized DMG pipeline.

## Phase 3 — iOS

Architecture is constrained by hard platform limits — read [ios-keyboard-constraints.md](ios-keyboard-constraints.md) before designing anything.

- **Containing app** does the real work: mic capture, WhisperKit (iPhone 15+) or cloud transcription, cleanup, history sync.
- **Keyboard extension** is a thin client: mic button → deep-link to the app → transcript comes back via App Group + Darwin notification → insert via `UITextDocumentProxy`. The return trip is a **manual swipe-back** on current iOS.
- **First-class alternatives** shipped alongside: App Intents/Shortcuts (Action Button capture), share sheet, long-form dictation in the main app.

## Phase 4 — Windows + shared backend

- **Windows:** native shell (SendInput with `KEYEVENTF_UNICODE`, `RegisterHotKey`); cloud transcription by default (Groq/Deepgram), optional local whisper.cpp.
- **Backend ("shared brain"):** Vercel + Supabase — cleanup prompt service, custom-dictionary and history sync, billing. Every native shell calls it; BYOK remains supported so the app works without an account.

## Non-goals (for now)

- Mac App Store distribution (impossible while non-sandboxed — see permissions doc).
- Real-time streaming insertion (type-as-you-speak) before Phase 2.
- Meeting transcription / file transcription — different product (MacWhisper's lane).
