# Sync relay

Deploy: `npm ci && npx wrangler types && npm run check && npm test && npm run deploy`.
Wrangler needs access to the configured Cloudflare account. Durable Objects migrations create the SQLite pairing storage. `ALLOWED_ORIGINS` lists allowed web clients; native requests have no browser Origin. CORS is not authentication: independent 256-bit device tokens authenticate every request. No transcription keys are used.

Tests use local Miniflare with actual Durable Object SQLite and the portable protocol implementation in Shared/Sync (also shipped by the PWA). Run from this directory. For the opt-in live native integration test, build the Swift harness from the repository root:

```
swiftc -parse-as-library macos/Dictation/Sync/SyncProtocol.swift macos/Dictation/Sync/SyncTransport.swift macos/Dictation/Sync/MacClipboardAdapter.swift macos/SyncValidation/main.swift -o /tmp/do-sync-native-validation
node --import ./backend/sync-relay/node_modules/tsx/dist/loader.mjs backend/sync-relay/tests/live-native.ts
```

The live test creates an ephemeral synthetic pair and revokes it in a finally block. It uses a named native test pasteboard, not personal clipboard content. Requires macOS and internet access; it is not a two-physical-device test. See `Shared/Sync/README.md` for protocol/security/retention details and `docs/sync-validation.md` for measured validation and remaining gaps.
