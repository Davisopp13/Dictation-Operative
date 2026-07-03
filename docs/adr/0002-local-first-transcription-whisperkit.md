# ADR-0002: Local-first transcription via WhisperKit

**Status:** accepted · **Date:** 2026-07-03

## Context

Options: on-device (WhisperKit, whisper.cpp, Parakeet) vs cloud (Groq, Deepgram, ElevenLabs, OpenAI). Argmax's benchmark (arXiv:2507.10860) has WhisperKit large-v3-turbo at 0.46 s latency / 2.2% WER on-device — matching or beating the cloud APIs — with zero marginal cost, full privacy, and offline operation. Cloud WER on clean English has plateaued (top providers cluster at 2–5%); the differentiators are latency, cost, and privacy, all of which favor local on Apple Silicon.

## Decision

WhisperKit (SPM, pinned `0.9.x`) is the only transcription path in the macOS MVP. Model downloads managed in-app; `base.en` is the onboarding default, `large-v3-turbo` offered for accuracy.

Cloud STT arrives later where local is impossible or weak: the iOS keyboard round-trip, Windows without an ANE, low-end hardware — as a BYOK option (Groq for cost, Deepgram/ElevenLabs for streaming).

## Consequences

- No transcription cost, no audio leaves the machine, works offline (cleanup degrades gracefully offline too).
- Model download UX (80 MB–1.6 GB) is ours to own.
- WhisperKit API drift risk is contained by confining its symbols to `TranscriptionService.swift` + `ModelManager.swift`.
