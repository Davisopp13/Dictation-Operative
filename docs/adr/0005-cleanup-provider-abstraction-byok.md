# ADR-0005: Cleanup behind a provider protocol, Groq first, BYO key

**Status:** accepted · **Date:** 2026-07-03

## Context

The AI cleanup pass (filler-word removal, punctuation, custom-dictionary spellings, later command mode) is the product's differentiator, but it must never make dictation *worse*: the pipeline has to survive provider outages, key misconfiguration, and slow networks. Wispr's benchmark is a fine-tuned Llama at < 700 ms p99; the closest off-the-shelf latency is Groq-hosted Llama. The user confirmed Groq as the first provider.

## Decision

- `CleanupProvider` protocol (`cleanup(transcript:dictionary:) async throws -> String`); implementations: `GroqCleanupService` (plain `URLSession` against the OpenAI-compatible endpoint, default model `llama-3.1-8b-instant`, model name user-configurable), `NoopCleanupProvider` when disabled. OpenAI/Anthropic/local llama.cpp slot in later without touching the pipeline.
- **BYO key**, stored in the Keychain only — mirrors Spokenly's winning local-first + BYOK model and avoids reselling API margin.
- Guardrails: temperature 0, 10 s hard timeout, response rejected if empty or > 3× input length; **any** failure inserts the raw transcript.

## Consequences

- Cleanup is strictly additive; offline dictation still works end-to-end.
- No server of ours in the loop for MVP (the Phase 4 backend may proxy for subscribers, but BYOK stays).
- Prompt lives in `CleanupPrompt` as a pure function — unit-testable without network.
