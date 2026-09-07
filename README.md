# Dictation-Operative

A cross-platform voice-to-text dictation app — a personal replacement for Wispr Flow and Spokenly. Press a hotkey anywhere, speak, and cleaned-up text is inserted into whatever app you're using.

**Current status: Phase 1 — native macOS menu-bar app.** iOS, Windows, and a shared sync backend come later (see [docs/roadmap.md](docs/roadmap.md)).

## How it works

```
global hotkey ──▶ record mic ──▶ transcribe on-device ──▶ AI cleanup ──▶ insert text
 (toggle/PTT)    (AVAudioEngine)   (WhisperKit / ANE)     (Groq Llama,    (Accessibility API,
                                                           optional)       paste fallback)
```

- **On-device transcription** via [WhisperKit](https://github.com/argmaxinc/WhisperKit) — private, offline-capable, zero marginal cost on Apple Silicon.
- **Optional AI cleanup** (bring your own key): removes filler words, fixes punctuation/capitalization, applies your custom dictionary. Providers: Groq, OpenAI, Anthropic, or a local Ollama / llama.cpp server. If the provider is slow or down, the raw transcript is inserted instead — dictation never blocks on the cloud.
- **System-wide insertion**: sets the focused element's selected text via the Accessibility API; falls back to clipboard + simulated ⌘V (with clipboard restore) for apps that don't support AX insertion (terminals, some Electron apps).
- **Voice commands** edit what you just dictated: “scratch that”, “delete last sentence”, “delete last word”, “make that uppercase”, or “make that a bullet list” / “make that more formal” (AI provider needed). Applies to the last dictation, in the same app, within two minutes.
- **Per-app style** (opt-in): a one-line tone hint per app (casual in Slack, formal in Mail, plain text in terminals) added to the cleanup prompt. Only the bundle id is used.
- **Menu-bar only** (no Dock icon), with a floating recording indicator, transcription history, and per-user custom dictionary.

See [docs/architecture.md](docs/architecture.md) for the full design.

## Requirements

- macOS 14 (Sonoma) or later, Apple Silicon recommended
- Xcode 16+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (current XcodeGen emits an Xcode 16 project format)
- A [Groq API key](https://console.groq.com) (optional — only for AI cleanup)

## Try it without Xcode

Every green CI run attaches a ready-built app: open the latest [macOS build run](https://github.com/Davisopp13/Dictation-Operative/actions/workflows/macos-build.yml), download the `Dictation-app-…` artifact, unzip, then **right-click → Open** (the build is ad-hoc signed, not notarized, so Gatekeeper needs the explicit open). Requires an Apple Silicon Mac. Grant Microphone and Accessibility when prompted and download a model in onboarding. Note: each replaced ad-hoc build re-prompts for Accessibility — for daily use, build from source with your own signing identity instead.

## First build

```sh
brew install xcodegen
cd macos
xcodegen generate
open Dictation.xcodeproj
```

1. In Xcode: target **Dictation** → *Signing & Capabilities* → select your team (a stable signing identity keeps the Accessibility grant across rebuilds; ad-hoc signing re-prompts every build).
2. Build & run. The app appears **only in the menu bar** (mic icon) — no Dock icon.
3. Follow onboarding: grant **Microphone**, grant **Accessibility** (System Settings → Privacy & Security → Accessibility), download a model (`base.en` is a good start, ~80 MB).
4. Dictate with **⌃⌥ (Control + Option)**: tap it to toggle recording, or hold it to talk and release to insert. Settings → General lets you pick a different modifier key (right ⌘/⌥ or Fn) and optionally record extra key-combo shortcuts for toggle and hold-to-talk (unbound by default).

For daily-use updates, run `macos/scripts/build-release.sh` to build with a valid
Developer ID Application certificate. Then quit the installed app and run
`macos/scripts/install-app.sh /path/to/Dictation.app` from the repository root.
The installer requires certificate signing and refuses identity-changing replacements.
Keep ad-hoc previews in DerivedData instead of overwriting `/Applications/Dictation.app`.

### Smoke-test checklist

- [ ] Toggle mode (tap ⌃⌥): tap, speak, tap again → text appears at the cursor
- [ ] Hold-to-talk (hold ⌃⌥): hold, speak, release (a quick tap acts as a toggle)
- [ ] Shortcut safety: ⌃⌥← or another ⌃⌥ combo does not start a recording
- [ ] Insertion matrix: TextEdit and Safari (AX path); VS Code and Terminal (paste fallback); a password field (paste; clipboard restored afterwards)
- [ ] Cleanup: pick a provider and add a key in Settings → Cleanup, dictate “um so like hello world” → “Hello world.”
- [ ] Offline fallback: disable Wi-Fi, dictate → raw transcript appears within ~10 s
- [ ] Voice command: dictate a sentence into TextEdit, then dictate “scratch that” → it disappears; in Terminal → backspaced away
- [ ] Quit and relaunch → history, hotkeys, and model selection persist

## Repository layout

```
macos/      Phase 1 — native Swift/SwiftUI menu-bar app (this is the active code)
docs/       Architecture, roadmap, ADRs, platform-constraint notes
ios/        Phase 3 — reserved
windows/    Phase 4 — reserved
backend/    Phase 4 — reserved (shared cleanup/sync "brain", Vercel + Supabase)
```

## CI

`.github/workflows/macos-build.yml` regenerates the Xcode project and compiles it on a macOS runner for every push — the project is developed partly from non-Mac environments, so CI is the compile check.

## Releases and updates

Push a `vX.Y.Z` tag and `.github/workflows/release.yml` builds a Developer ID-signed, notarized DMG, generates a Sparkle appcast, and publishes both as a GitHub release. Installed copies update themselves via Sparkle (*Check for Updates…* in the menu). One-time setup of the signing and Sparkle secrets is described in [docs/permissions-and-distribution.md](docs/permissions-and-distribution.md).

## Distribution note

The app is deliberately **non-sandboxed** (Accessibility insertion and CGEvent posting require it), so Mac App Store distribution is off the table — same as every app in this category. Ship via notarized Developer ID builds. Details: [docs/permissions-and-distribution.md](docs/permissions-and-distribution.md).


## Dictation Operative Sync

The Mac app and [private PWA](https://do-voice-workspace.davisopp.chatgpt.site/) can now pair for end-to-end encrypted text and image clipboard transfers. Open **Settings → Sync** on the Mac or **Sync** in the PWA. Create an invitation on one device, enter it on the other, and approve the requesting device. Select a destination, then **Send clipboard** / **Receive latest**. The Mac menu also offers **Send last dictation**; the PWA thought editor offers **Send to device**.

Automatic clipboard sync and automatic completed-dictation delivery are optional Mac settings, off by default. Both devices need internet access. Browser/iOS actions are user initiated while open. Transfers expire in two minutes. See the [protocol and platform limits](Shared/Sync/README.md) and [validation report](docs/sync-validation.md). Native Windows, Linux, and iOS apps/share extensions remain future work.
