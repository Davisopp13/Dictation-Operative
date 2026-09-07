# DO PWA — V1 scope

Status: approved full V1, implemented in `pwa/` on September 6, 2026.
The native macOS product remains separate and unchanged by this build.

## Product

Speak once, keep the useful words, and turn them into something ready to use.
Capture is the primary surface. Library holds history and the pinned internal
clipboard. Compose builds new drafts from existing thoughts.

## V1

1. Tap to start/stop foreground recording, cloud transcription, automatic save,
   editable text capture, explicit clipboard paste, copy/share, and text export.
2. Durable private history with search, naming, pins, deletion, and full-library
   JSON export/import. Imports preserve originals, versions, and pins without
   overwriting existing thoughts.
3. Add More records another segment into the same thought, preserving original
   segments separately. A draft can be rebuilt without a selected segment.
4. Compose selects 2–20 clips, orders them, and joins their wording or generates
   an email, progress update, or checklist. Source clips remain in the library.
5. Reply accepts an incoming message and spoken/typed reply points, preserving
   both before drafting a response. Copy/share remains an explicit action.
6. AI Prompt organizes rough requests into Goal, Context, Constraints, and
   Output, marking unspecified information instead of inventing requirements.
7. Original, Cleaned, Rewritten and manual versions remain recoverable. Undo
   unsaved edits, restore a saved version, or restore all original segments.

## V2 — deliberately deferred

- Project collections and tags.
- Personal vocabulary and preferred spellings.
- Reusable/custom voice templates.
- Phone-to-native-Mac handoff/synchronization.
- Persistent recording recovery across app restarts and advanced offline audio.
- Native iOS keyboard, broad integrations, automatic sending, subscriptions,
  and meeting bots remain outside the first PWA release.

## Implementation choices

The PWA uses a private Sites deployment, authenticated server endpoints, and a
D1 database scoped to the signed-in user. The server stores the authoritative
library; browser local storage is not used as its database. Groq provides
transcription and writing, enabled by the user connecting their API key in
Settings and allowing cloud processing. Keys are encrypted with AES-GCM and
bound to the account identity. Secrets are never returned to the client.

Recording is foreground-only, stops at five minutes or on page visibility loss,
and can be interrupted by device/browser restrictions. Failed audio can be
retried or downloaded while the page remains open; it is not persisted across
reloads. Audio is not retained in the server library. The home-screen PWA caches
icons and an offline notice. Library access, saving, transcription, and AI need
a network connection in V1. V1 does not insert text into other apps or share
history with the native Mac app.

## Validation boundary

Automated tests cover real D1 SQLite persistence, account isolation, origin
checks, revisions, retry deduplication, imports, encrypted credentials, rate
limits, and provider request contracts. Provider responses are stubbed in tests.
Actual speech quality, iPhone microphone permissions, installation, and native
share behavior require testing on the target device with a connected key.
