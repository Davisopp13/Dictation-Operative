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
