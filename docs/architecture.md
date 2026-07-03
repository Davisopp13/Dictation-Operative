# Architecture — macOS app (Phase 1)

## Overview

A native Swift/SwiftUI menu-bar app. One process, no daemons. The core loop:

```
┌──────────┐   keyDown/keyUp   ┌────────────────────┐
│ Hotkey   │ ────────────────▶ │ DictationController │  ← @MainActor state machine
│ Manager  │                   └─────────┬──────────┘
└──────────┘                             │ owns / orchestrates
        ┌────────────────┬───────────────┼────────────────┬─────────────────┐
        ▼                ▼               ▼                ▼                 ▼
 ┌────────────┐  ┌───────────────┐ ┌────────────┐ ┌──────────────┐ ┌─────────────┐
 │ Audio      │  │ Transcription │ │ Cleanup    │ │ TextInserter │ │ HistoryStore│
 │ Recorder   │  │ Service       │ │ Provider   │ │ (AX → paste) │ │ (JSON)      │
 │ (AVAudio-  │  │ (actor,      │ │ (Groq /    │ └──────────────┘ └─────────────┘
 │  Engine)   │  │  WhisperKit)  │ │  Noop)     │
 └────────────┘  └───────────────┘ └────────────┘
```

Supporting components: `PermissionsManager` (mic + Accessibility), `ModelManager` (WhisperKit model catalog/downloads), `SettingsStore` (UserDefaults), `KeychainHelper` (API key), `RecordingIndicatorPanel` (floating non-activating NSPanel), onboarding window.

Everything is wired in `AppServices` (a `@MainActor` singleton composition root) so the SwiftUI `App`, the `NSApplicationDelegate`, and the hotkey callbacks all see the same object graph.

## State machine

`DictationController.state`:

| State | Entered by | Exits to |
|---|---|---|
| `idle` | launch; completion of any pipeline; error auto-clear | `recording` |
| `recording(start:)` | hotkey down / toggle | `transcribing` (stop), `idle` (cancel) |
| `transcribing` | stop; frontmost app captured **at this moment** | `cleaning` or `inserting`; `idle` if transcript empty |
| `cleaning` | cleanup enabled + API key present | `inserting` (cleanup failure falls through with raw text) |
| `inserting` | always | `idle` |
| `error(message)` | any thrown error | `idle` (auto-clears after 4 s) |

Rules:

- The frontmost application is captured when recording **stops**, before any UI churn, and threaded through to history. Insertion targets whatever element has focus at insert time (the app never steals focus, so this is normally the same app).
- The processing pipeline is a single `Task`; cancel checks run between phases.
- **Degradation ladder:** cleanup failure/timeout → insert raw transcript; AX insertion failure → paste fallback; CGEvent untrusted → leave text on clipboard + indicator message. Every result is appended to history regardless of insertion outcome.

## Audio path

- New `AVAudioEngine` per recording session (clean teardown handles input-device switches, e.g. AirPods).
- Tap installed at the **hardware format** (`inputNode.outputFormat(forBus: 0)`) — mandatory; a mismatched tap format crashes at runtime.
- Per-buffer conversion through a persistent `AVAudioConverter` to 16 kHz mono Float32 (WhisperKit's input format), accumulated in memory.
- RMS level per buffer drives the indicator meter. Hard cap of 5 minutes per dictation bounds memory (~19 MB of samples).
- A cheap energy gate skips transcription entirely for silent recordings (Whisper hallucinates on silence).

## Transcription

- `TranscriptionService` is an `actor` owning the `WhisperKit` instance; models load with `prewarm: true` so the first dictation isn't slow, and reload on model change.
- `ModelManager` owns the catalog (tiny.en → large-v3-turbo), downloads via `WhisperKit.download` into `~/Library/Application Support/Dictation/Models`, and persists a variant → folder map so we never guess WhisperKit's directory layout.
- All WhisperKit symbols are confined to these two files, so an API drift in the dependency is a two-file fix.

## Cleanup

- `CleanupProvider` protocol; `GroqCleanupService` is the first implementation (plain `URLSession` against the OpenAI-compatible endpoint, no SDK). `NoopCleanupProvider` when disabled.
- Prompt built by `CleanupPrompt` (pure function, unit-tested): remove filler words, fix punctuation/capitalization, preserve meaning, prefer custom-dictionary spellings, output only the cleaned text.
- Guardrails: `temperature 0`, 10 s timeout, response discarded if empty or > 3× input length. Any failure returns the raw transcript.

## Insertion

1. **AX path:** system-wide `AXUIElement` → focused element → skip if secure text field → check `kAXSelectedTextAttribute` is settable → set it (replaces selection / inserts at caret).
2. **Paste path:** snapshot pasteboard items → write text → post ⌘V via `CGEvent` → wait 300 ms → restore snapshot only if `changeCount` is still ours (clipboard managers race us).
3. **Clipboard-only:** if Accessibility trust was revoked mid-flight, the text stays on the clipboard and the indicator says so.

## Threading model

- UI, controller, stores: `@MainActor`.
- Audio buffers: `AudioRecorder`'s private serial queue; level callbacks hop to main.
- WhisperKit: inside the `TranscriptionService` actor.
- Network cleanup: `URLSession` async, awaited from the pipeline task.

## Persistence

| Data | Where |
|---|---|
| Settings (model, hotkey mode, cleanup toggle, dictionary, language) | `UserDefaults` |
| Groq API key | Keychain (`com.davisopp.dictation`) |
| History (raw + cleaned text, app, duration; capped at 500) | JSON file in Application Support (atomic writes) |
| Models | `~/Library/Application Support/Dictation/Models` |

## Project generation

The Xcode project is generated from `macos/project.yml` by XcodeGen and gitignored (see ADR-0003). Dependencies (WhisperKit, KeyboardShortcuts) are SPM packages declared there.
