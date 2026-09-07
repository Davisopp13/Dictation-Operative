# Dictation Operative Sync v1 protocol

This module boundary is independent of transcription. `protocol.ts` is the portable TypeScript implementation; copy it to the separate Sites repository at `pwa/lib/sync/protocol.ts` when changing it, and verify the files match before publishing. `macos/Dictation/Sync` implements the native client and adapter; the PWA's `lib/sync` implements the portable Web Crypto client and browser adapter. `backend/sync-relay` is the ciphertext-only internet relay. The PWA is a separate Sites source repository, not part of the native release bundle.

## Pairing and keys

The inviter generates independent random 256-bit values for content secret, host authorization, and guest authorization. The invitation contains **only** the content secret, guest authorization, relay origin, and inviter name. Host authorization is never shared. Invitations expire after five minutes. A guest claims an invitation; the host must explicitly approve its device ID before any transfer. The guest cannot self-approve. Each pair is independent; a device can pair with multiple peers and selects one destination.

HKDF-SHA256 input = 32-byte content secret; salt UTF-8 `Dictation Operative Sync v1`; info `room` (32 bytes rendered lowercase hex) or `content-key` (32-byte AES key). Authorization is an independent random 32-byte base64url token; relay stores only SHA256 of its text representation. Encryption uses AES-256-GCM, random 12-byte nonce per transfer, 16-byte tag appended to ciphertext. Standard Base64 encodes nonce; lowercase SHA256 hex covers ciphertext+tag. No token or plaintext is put in a URL.

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

Active storage expires ≤120 seconds after creation, with alarms and request-time expiry checks. Receipt, replacement, or revocation removes active ciphertext immediately. Cloudflare's infrastructure backup policy is separate and can retain encrypted storage. No request-body or clipboard analytics/logging is enabled. Operational metadata includes room ID, device names/IDs, timestamps, role, MIME, encrypted size, sequence, authorization hashes, pairing state, and acknowledgement IDs. Revoked pair tombstones remain to reject replay. This first version has no account directory or account recovery; a private invitation is the authority to request pairing.

Both devices need internet access and HTTPS. Same-LAN devices work through the relay; there is no LAN discovery/direct mode. Paused or offline recipients retain only the latest unexpired transfer. No delayed backlog replay. Browser receive is always explicit. Native automatic receive establishes a fresh baseline on startup, resume, selection, and reconnect, leaving already-pending items for explicit Receive latest. Native writes check pasteboard changeCount after download, mark received items, and track fingerprints/IDs. Concurrent local copies take precedence over automatic remote overwrites. Known transient, concealed and auto-generated clipboard entries are excluded from automatic sends.

## Platform boundaries

- macOS 14+: NSPasteboard text, PNG, TIFF-to-lossless-PNG; image dimensions/alpha retained. Native explicit actions, optional automatic clipboard mode, optional completed-dictation send, menu status and progress. Windows/Linux native adapters are not implemented.
- PWA: browser Clipboard API text/PNG with promise-valued ClipboardItem to retain Safari user activation; paste-event fallback for reads. Manual actions only while open. Image URLs stay text; file references are not fetched. Some browsers/permissions may block clipboard operations; the UI reports errors. iOS background monitoring and native share extensions are not implemented.
- JPEG/WebP browser paste images can be converted to PNG without further lossy compression; existing JPEG loss is not reversed. Animated formats are unsupported. 40 MP and 16384-pixel dimension limits apply.
- Pair secrets live in macOS Keychain or account-scoped browser localStorage, accessible to trusted same-origin code. Clearing storage loses browser trust keys. Remove that device on the other peer to revoke it. No Sync clipboard history is kept. Existing dictation history remains a separate product feature.
