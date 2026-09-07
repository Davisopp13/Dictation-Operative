# Dictation Operative Sync: v2 pairing, v1 transfers

This module boundary is independent of transcription. `protocol.ts` is the portable transfer implementation and `pairing.ts` implements short-code pairing; copy both to the separate Sites repository at `pwa/lib/sync/protocol.ts` when changing it, and verify the files match before publishing. `macos/Dictation/Sync` implements the native client and adapter; the PWA's `lib/sync` implements the portable Web Crypto client and browser adapter. `backend/sync-relay` is the ciphertext-only internet relay. The PWA is a separate Sites source repository, not part of the native release bundle.

## Pairing and keys

The default pairing screen offers one six-character code and a QR code for the same five-minute, single-use session. Codes use `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 characters, 30 bits), ignore spaces/hyphens and accept lowercase. Codes locate public keys; they are never passwords or encryption keys. QR links open `/pair#code=…&key=…` and pin the inviter's public key. The landing page retains this public link in sessionStorage across ChatGPT sign-in, then removes it. Browsers use the phone's normal camera; no in-app camera permission is needed.

Each device generates an ephemeral P-256 ECDH keypair and an independent random 256-bit session authorization token. Raw public keys are 65-byte X9.63 uncompressed points encoded as unpadded base64url. The relay binds exactly one guest key/device/token hash to the code, and neither participant can change keys after claiming. Clients reject changes to pinned device IDs and public keys. To authenticate the exchange, **compare the confirmation fingerprint on both devices before approving on the host**; a device name alone is not proof of identity.

Key derivation: ECDH yields a 32-byte shared secret. HKDF-SHA256 derives 32 bytes per purpose, with UTF-8 salt equal to these values joined by newlines (no trailing newline): `DO-PAIR/2`, normalized code, host public key, guest public key, host device ID, guest device ID. UTF-8 info is `content-secret`, `guest-authorization`, or `verification`. The displayed confirmation is the first 12 uppercase hex characters of SHA256(verification bytes), grouped 4–4–4 (48 bits). Host room authorization is a separate random 256-bit token. The host creates and approves the transfer room only after the user's confirmation. Approval retries reuse the same room and credentials; terminal cancellation/expiry during approval revokes the newly created room. The guest waits for approval, verifies room identities, then saves the resulting pair. Persisted pair formats and transfer encryption remain compatible with v1.

The relay receives public keys, device metadata, authorization hashes, and approval state, **never the ECDH secret or content keys**. Private ECDH keys stay in memory during pairing; approved pair credentials are saved in Keychain or account-scoped browser storage. Refreshing/quitting before saving a pair requires a new code. Server expiry and alarms clear rendezvous metadata after five minutes. Create/claim attempts share a five-per-minute IP budget; authenticated status polling uses the normal request limit. Cloudflare rate limits are enforced at the edge and are not a globally exact distributed counter. Short-code possession alone does not grant clipboard access.

Older `dosync1:` invitations can still be entered under “Pair with an older app version.” In that legacy flow, the inviter generates independent random 256-bit content and authorization values and transfers the content secret and guest authorization privately; host authorization is never shared. Existing paired devices continue to work. Both flows require explicit host approval and independent pairs for each peer.

HKDF-SHA256 input = 32-byte content secret; salt UTF-8 `Dictation Operative Sync v1`; info `room` (32 bytes rendered lowercase hex) or `content-key` (32-byte AES key). Authorization is a 32-byte base64url capability (random host token, separately derived guest token in v2); relay stores only SHA256 of its text representation. Encryption uses AES-256-GCM, random 12-byte nonce per transfer, 16-byte tag appended to ciphertext. Standard Base64 encodes nonce; lowercase SHA256 hex covers ciphertext+tag. No token or plaintext is put in a URL.

AAD is UTF-8 of the following values joined by exactly one newline, with no trailing newline:

```
DO-SYNC/1
room
id
from
to
sequence
createdAt
expiresAt
mime
```

The `from`/`to` roles are `host` and `guest`; timestamps are integer Unix milliseconds. Envelope fields: `v`=1, `room`, random UUID `id`, roles, monotonically increasing sender `sequence`, `createdAt`, `expiresAt`, `mime`, Base64 `iv`, encrypted `size`, hex `digest`. Authenticated metadata prevents MIME/sequence/destination substitution. TLS authenticates relay metadata; E2E GCM authenticates payload and routing metadata. This is a symmetric shared-secret design, not forward-secret messaging or a hardware-attested device identity system.

## Relay

HTTPS `https://dictation-operative-sync.davisopp.workers.dev/v1/rooms/{room}/{action}` with Bearer device token. SQLite-backed Durable Object per pair. Actions: POST create/join/approve/rename/revoke/start/commit/{id}/ack/{id}; GET state/download/{id}/{chunk}; PUT chunk/{id}/{chunk}. PNG ≤8 MiB, UTF-8 text ≤256 KiB; encrypted chunks ≤262144 bytes. One complete mailbox per recipient plus one pending upload per sender. Commit locks chunks, checks all bytes and digest, then atomically supersedes the previous mailbox. Partial uploads are never visible. A fresh retry can supersede an interrupted upload; chunks also support idempotent resumption with the same envelope. Completed IDs/sequences remain as dedup metadata after acknowledgement.

Active storage expires ≤120 seconds after creation, with alarms and request-time expiry checks. Receipt, replacement, or revocation removes active ciphertext immediately. Cloudflare's infrastructure backup policy is separate and can retain encrypted storage. No request-body or clipboard analytics/logging is enabled. Operational metadata includes room ID, device names/IDs, timestamps, role, MIME, encrypted size, sequence, authorization hashes, pairing state, and acknowledgement IDs. Revoked pair tombstones remain to reject replay. There is no account directory or account recovery. Pairing requires a current code or legacy invitation and host approval.

Both devices need internet access and HTTPS. Same-LAN devices work through the relay; there is no LAN discovery/direct mode. Paused or offline recipients retain only the latest unexpired transfer. No delayed backlog replay. Browser receive is always explicit. Native automatic receive establishes a fresh baseline on startup, resume, selection, and reconnect, leaving already-pending items for explicit Receive latest. Native writes check pasteboard changeCount after download, mark received items, and track fingerprints/IDs. Concurrent local copies take precedence over automatic remote overwrites. Known transient, concealed and auto-generated clipboard entries are excluded from automatic sends.

## Platform boundaries

- macOS 14+: NSPasteboard text, PNG, TIFF-to-lossless-PNG; image dimensions/alpha retained. Native explicit actions, optional automatic clipboard mode, optional completed-dictation send, menu status and progress. Windows/Linux native adapters are not implemented.
- PWA: browser Clipboard API text/PNG with promise-valued ClipboardItem to retain Safari user activation; paste-event fallback for reads. Manual actions only while open. Image URLs stay text; file references are not fetched. Some browsers/permissions may block clipboard operations; the UI reports errors. iOS background monitoring and native share extensions are not implemented.
- JPEG/WebP browser paste images can be converted to PNG without further lossy compression; existing JPEG loss is not reversed. Animated formats are unsupported. 40 MP and 16384-pixel dimension limits apply.
- Pair secrets live in macOS Keychain or account-scoped browser localStorage, accessible to trusted same-origin code. Clearing storage loses browser trust keys. Remove that device on the other peer to revoke it. No Sync clipboard history is kept. Existing dictation history remains a separate product feature.

## Validation

`backend/sync-relay/tests/pairing.test.ts` exercises real local Durable Objects: encrypted round trips, approval gating/retries, competing claims, cancellation, expiry/alarm cleanup, QR pinning, rate limits, and absence of secrets in relay storage. `pairing-fixture.json` contains deliberately fixed **test-only** private keys and Web Crypto expected outputs; native `SyncTests` checks both directions against that fixture. Verify both portable `.ts` files match their PWA copies before publishing.
