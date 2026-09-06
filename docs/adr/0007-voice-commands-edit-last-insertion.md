# ADR-0007: Voice commands edit the last insertion, verified through AX ranges

**Status:** accepted · **Date:** 2026-09-01

## Context

Phase 2 asked for a "command mode": "delete last sentence" or "make that a bullet list" should be interpreted as edits, not typed out. The app never owns the text field — it only ever inserted text into someone else's app — so the question is what a command may safely touch, and how.

## Decision

- **Scope: the last insertion only.** `DictationController` remembers the text, target bundle id, and time of the most recent successful insertion. A command applies only if it is spoken within 2 minutes, into the same app. Anything else answers "Nothing recent to edit here". No attempt to read or edit arbitrary document text.
- **Recognition is deterministic, from the raw transcript, before cleanup.** `VoiceCommand.parse` normalises (lowercase, punctuation stripped) and matches a short list of phrases and anchored patterns, capped at 12 words so ordinary sentences that merely start with "delete that…" are not commands. No LLM in the recognition path — a false positive here destroys the user's text.
- **Edits are deterministic where possible** (`scratch that`, last sentence, last word, upper/lowercase). Only open-ended instructions ("make that a bullet list", "more formal") go through `CleanupProvider.rewrite`, using the same provider and guardrails as cleanup. Without a configured provider they fail with a message, never with a guess.
- **Replacement is verified before it happens.** Primary path (`AXInserter.replaceTrailing`): read the caret position via `AXSelectedTextRange`, read the text immediately before it via `AXStringForRange`, and proceed only if it equals what we inserted; then select that range and set `AXSelectedText`. A mismatch (caret moved, text edited) aborts with "Couldn't find the last dictation to edit" and explicitly does **not** fall back to key events.
- **Key-based fallback only where AX can't work at all**: for AX-hostile apps (terminals, Codex, Claude Code) and elements that don't expose text ranges, `PasteInserter.replaceTrailing` posts one backspace per grapheme of the old text and then pastes the replacement. This is blind by nature; the time/app window is the only guard, so it is deliberately limited to the apps where it is the only option.
- `CleanupProvider` was reduced to a single `complete(system:user:)` requirement with `cleanup` and `rewrite` as protocol extensions, so every provider gets both for free.

## Consequences

- Commands feel native in AX-friendly apps (TextEdit, Safari, Notes, Mail) and degrade to "best effort" in terminals.
- The verification step means a command can fail loudly but should never delete the wrong text through the AX path.
- Chained commands work ("scratch that" after "make that uppercase") because a successful edit becomes the new last insertion.
- A spoken phrase that *is* the intended text ("delete that", said literally) is swallowed as a command; the toggle in Settings → Cleanup turns commands off.
