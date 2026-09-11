# Hotkey probe validation — September 10, 2026

Prototype version: 0.2.0. Default shortcut: Win + Alt. Build host: macOS ARM64. SDK: .NET 10.0.401.

## Passed locally

- 48 executable checks: modifier-only press/release order and left/right variants,
  extra-key cancellation (including Win + Alt + R and AltGr with Ctrl), repeats,
  fresh-chord recovery, reset/initial-held behavior, raw-input layout/normalization, held-modifier deferral, same-target release, changed/missing
  foreground cancellation, two-second expiry including late release, Windows INPUT
  struct size/alignment, UTF-16 ordering and surrogate pairs, key-up flags, and empty input.
- Release compilation and self-contained publication for `win-x64` and `win-arm64`,
  with no compiler warnings or errors in the successful builds.
- Both ZIPs passed full CRC verification and contain the executable, app assembly,
  native .NET runtime, Windows Forms assembly, and user instructions.
- Executable PE machine fields match x64 and ARM64 respectively. Both packages
  contain version 0.2.0 and the Win + Alt selection in the compiled app.
- Both executable manifests embed a `requestedExecutionLevel` element with
  `level="asInvoker"` and `uiAccess="false"`.
- Runtime configuration contains bundled `includedFrameworks`, rather than requiring
  a separately installed .NET runtime.
- `git diff --check` passed. A Windows CI workflow was added but has not been run remotely.

The initial SDK setup and package restore exceeded available disk space. Successful
builds used a temporary SDK with unused components omitted, pre-fetched runtime
packs, disabled transitive framework downloads, and hard links for publish files.
These were build-host accommodations; product source and runtime contents were not trimmed.

## Packages

Local output: `windows/dist/` (ignored by Git).

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| DO-HotkeyProbe-win-x64.zip | 49,860,578 | 73b8814378250efed01a99855f0d6cf390c9c1ef0c9be2d8ca2d8b2df7f7a5b3 |
| DO-HotkeyProbe-win-arm64.zip | 47,793,142 | a7a8c23c4ae8dae643cfc4e27a04483fa4f01a28dd14bf09770d0ddac6f434bd |

## Pending on Windows

User-reported Hapag laptop result, September 10: the downloaded executable was
blocked at launch by Microsoft Defender SmartScreen, showing “Unknown publisher”
and “Don't run.” The supplied photo confirms that the launch test did not reach
the app. Hotkey detection, microphone access, and insertion on that laptop remain
untested; this is not evidence that Windows hotkeys themselves are prohibited.

The required Windows outcome remains the Mac-style workflow: Win + Alt from the
working application, tap-to-toggle and hold-to-talk, transcription and cleanup,
then insertion at the intended cursor. Browser copy/paste and Windows voice typing
are fallback options, not acceptance of this requirement. The user has identified
Lance's working dictation app (possibly Python) as a candidate reference; its source,
launch method, and confirmed Hapag-device results are still needed before choosing
that implementation path.

No Windows machine or Hapag-managed device was available for this run. GUI layout,
normal-user launch, modifier-only/raw-input delivery, Start/menu interaction,
AltGr/keyboard-layout behavior, visible insertion, target-app compatibility,
shortcut conflicts, actual cancellation behavior, and organizational controls remain
unverified on Windows. Follow [README.md](README.md) and save the local report.

These unsigned prototypes are not production Windows support, nor proof of IT approval.
