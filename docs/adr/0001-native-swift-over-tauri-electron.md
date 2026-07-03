# ADR-0001: Native Swift for the macOS app (not Electron/Tauri)

**Status:** accepted · **Date:** 2026-07-03

## Context

A dictation app is defined by three OS-level capabilities: global hotkey capture, background microphone access, and inserting text into *any other app*. Cross-platform frameworks abstract exactly these worst. Electron/Tauri can technically do it (tauri-plugin-global-shortcut, the `enigo` crate → CGEvent), and MumbleFlow proves a Tauri build is possible — but:

- Wispr Flow's Electron Windows app is the source of its best-known complaints (~800 MB RAM, slow startup).
- On macOS you end up writing native Accessibility code and shipping non-sandboxed regardless of framework — the framework saves nothing where it matters.
- WhisperKit's Apple Neural Engine acceleration is Swift/CoreML-only; it's the single biggest latency/cost win available on the platform.

## Decision

Native Swift + SwiftUI for the macOS app. Per-platform native shells later (Swift on iOS, Win32/C# or Tauri on Windows); the shared logic lives in a cloud backend, not a UI framework.

## Consequences

- No code sharing between desktop platforms; acceptable because the OS-integration layer dominates the codebase at this stage.
- Tauri remains an option for Windows+Linux specifically (Phase 4), keeping the Mac app native.
