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
- **Optional AI cleanup** via the Groq API (bring your own key): removes filler words, fixes punctuation/capitalization, applies your custom dictionary. If the network is slow or down, the raw transcript is inserted instead — dictation never blocks on the cloud.
- **System-wide insertion**: sets the focused element's selected text via the Accessibility API; falls back to clipboard + simulated ⌘V (with clipboard restore) for apps that don't support AX insertion (terminals, some Electron apps).
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
4. Set your hotkeys in Settings → General (defaults: **⌘⇧D** toggle, **⌥Space** hold-to-talk). Both are always active; rebind or clear either.

### Smoke-test checklist

- [ ] Toggle mode (⌘⇧D): press, speak, press again → text appears at the cursor
- [ ] Hold-to-talk (⌥Space): hold, speak, release (a quick tap acts as a toggle)
- [ ] Insertion matrix: TextEdit and Safari (AX path); VS Code and Terminal (paste fallback); a password field (paste; clipboard restored afterwards)
- [ ] Cleanup: add a Groq key in Settings → Cleanup, dictate “um so like hello world” → “Hello world.”
- [ ] Offline fallback: disable Wi-Fi, dictate → raw transcript appears within ~10 s
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

## Distribution note

The app is deliberately **non-sandboxed** (Accessibility insertion and CGEvent posting require it), so Mac App Store distribution is off the table — same as every app in this category. Ship via notarized Developer ID builds. Details: [docs/permissions-and-distribution.md](docs/permissions-and-distribution.md).
