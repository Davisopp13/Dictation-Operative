# ADR-0004: Text insertion — AX primary, clipboard-paste fallback

**Status:** accepted · **Date:** 2026-07-03

## Context

Two viable system-wide insertion mechanisms on macOS:

- **Accessibility API:** set `kAXSelectedTextAttribute` on the focused `AXUIElement` — true cursor insertion, no clipboard side effects. But: secure fields reject it, many Electron/Chromium apps expose elements where the write silently fails or returns `.attributeUnsupported`, and terminals don't support AX text insertion at all.
- **Clipboard + simulated ⌘V (CGEvent):** works essentially everywhere text can be pasted, but clobbers the clipboard and races clipboard managers.

Competitors (e.g. EdgeWhisper) use exactly this pair: AX primary, paste fallback.

## Decision

Try AX first (skip immediately for secure fields, verify the attribute is settable, check every `AXError`). On any failure, paste: snapshot pasteboard items → write → post ⌘V → wait 300 ms → restore only if `changeCount` is unchanged. If Accessibility trust is revoked mid-flight, leave the text on the clipboard and tell the user via the indicator.

## Consequences

- Universal coverage (terminals and Electron via paste) at the cost of a brief clipboard swap on the fallback path.
- The 300 ms restore delay is a tunable constant; too short pastes the *old* clipboard.
- Both paths require Accessibility trust (CGEvent posting from an untrusted process is silently dropped), so permission onboarding is a hard prerequisite for the whole feature.

## Update (first live testing): AX false-success

Some apps — notably terminal/editor-widget Electron apps (Codex, Claude Code) and native terminals — return `.success` from `AXUIElementSetAttributeValue(kAXSelectedTextAttribute)` while the widget silently discards the write. AX "succeeds," so the fallback never runs and no text appears.

Mitigations added:
- An **AX-hostile denylist** (`TextInserter.axHostileNeedles`, substring-matched against bundle id + app name) forces the paste path for these apps.
- A user-facing **insertion-method setting** (`InsertionMode.alwaysPaste`) as a universal override.
- The floating indicator now reports the path used ("via Accessibility" / "via paste" / "clipboard"), making a false-success visible without logs.
- A 40 ms settle delay before the ⌘V keystroke, for widgets that read the clipboard asynchronously.
