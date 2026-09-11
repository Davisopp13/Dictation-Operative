# Account sync and persistent Groq settings

Implemented and deployed September 10, 2026. The Developer ID-signed Mac build was installed at `/Applications/Dictation.app` and relaunched.

## Using it

1. Sign in to the web workspace, open Sync, and select **Set up account sync** on the first browser. This uses the existing Cloudflare Access identity; it does not introduce another password.
2. Pair another device using the existing six-character code and confirmation comparison.
3. On an account-connected device choose **Add paired device to account**. On the other device choose **Receive account invitation** within five minutes. Browser recipients must be signed into the same account. Native Macs join by possession of the invitation approved through the trusted pairing.
4. On Mac, save your Groq key in Writing settings. In Sync, optionally enable **Include this Mac’s Groq API key when publishing**, then **Publish this Mac’s Groq settings**. Web Sync also has a password field for explicitly publishing a key. The web app's existing server-stored key is never exported automatically.
5. On each receiving Mac, select **Follow shared Groq preferences** and, if wanted, **Also apply the shared Groq API key**. **Apply shared settings now** works without following future updates. Settings include the Groq provider/model, cleanup enabled preference, and dictionary. Other providers and their keys remain local. Publishing is explicit; following published revisions is automatic while the Mac is online and Sync is unpaused.
6. To use the shared key for browser recording and AI, choose **Use shared connection in web app**. This explicitly submits the decrypted key to the web app's existing encrypted server credential store. Cloud-processing consent remains independent. Account transport itself remains end-to-end encrypted.
7. **Share clipboard with account** makes a text or PNG clipboard available in the account's device list. On the web, View previews it and Copy performs the clipboard write. Mac offers explicit receive and optional automatic account clipboard sync. Account and selected-pair automatic modes are mutually exclusive.

A blank key publishes preferences without a shared key. It replaces the previous encrypted shared key but does not erase copies already applied on devices. Local keys are never cleared by receiving a preferences-only update.

## Trust and storage

- Account identity is SHA-256 of a versioned namespace and the verified Access user ID. Only the web Worker's named `AccountAdmin` service binding can bootstrap the first device. The public relay has no bootstrap route. A second sign-in cannot replace an existing encryption root.
- Each device gets a separate random 256-bit bearer credential; the relay stores only its SHA-256 hash. Existing trusted devices can register and revoke devices. Revoked identities cannot be reactivated. New enrollment uses a new identity. The initial implementation limits registrations to 100 per account, including revoked identities.
- An account has a random 256-bit content secret. HKDF-SHA256 derives separate AES-256-GCM keys for `settings`, `clipboard`, and pairing `invitation`; salt is UTF-8 `DO-ACCOUNT/1`. Account content and device tokens are stored in macOS Keychain or account-scoped browser localStorage. Browser storage is accessible to trusted same-origin code; this is not hardware-backed browser storage or protection against an XSS compromise.
- Account invitations are encrypted with a key derived from the existing pair secret, use a separate endpoint/table, and never touch either system clipboard or the clipboard mailbox. Authenticated data binds the room, recipient role, and five-minute expiry. Expiry, acknowledgement and pair revocation purge the encrypted invitation.
- Account content authenticated data is newline-joined `DO-ACCOUNT/1`, account ID, item ID, sender device ID, channel, revision, createdAt and expiresAt. Every publication uses a random 96-bit nonce. Shared settings persist as one latest encrypted record with compare-and-swap revisions. Old revisions cannot overwrite a newer publication.
- Clipboard plaintext is one format byte (`0` text, `1` PNG) followed by payload bytes. Text is limited to 256 KiB, PNG to 8 MiB and 40 megapixels. Encrypted images are stored in bounded SQLite chunks. State responses contain metadata only; individual clipboard ciphertext is downloaded on demand.
- Account clipboard items expire after two minutes or are replaced by the sender's next item. Every trusted device can receive them, so receipt does not delete an account item. Revoking the sender deletes its account clipboard. Alarms and request-time cleanup remove active expired ciphertext. Sequence metadata remains. Infrastructure backups have their own retention.
- Device removal stops future account access. It cannot erase previously received Groq keys or clipboard content and does not revoke independent direct pairings. Rotate an exposed Groq key through Groq and remove direct pairings separately. Forgetting an account locally is not remote revocation.
- There is no account-key recovery or reset flow yet. If all trusted-device secrets are lost, sign-in alone cannot recover this encrypted account. Clipboard and shared settings contain no server-readable content; device names, IDs, activity timestamps, authorization hashes, revisions and ciphertext sizes are operational metadata.

## Rollout and validation

Deploy the relay before the web and Mac clients. The relay adds the `ACCOUNTS` binding, SQLite `SyncAccount` class, `v3` migration, and `AccountAdmin` named entrypoint. The web adds a `SYNC_ACCOUNTS` service binding and a D1 migration for the selected Groq model. Existing pairings and old clients retain their current behavior.

From `backend/sync-relay`, run `npm run check` and `npm test`, then `npm run deploy` for an authorized release. From `pwa`, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:migrate`, and `npm run deploy` for an authorized release. Build/install the native app using the existing signed-release workflow; do not overwrite the installed app with an unsigned test build.

For local account web development, run the PWA with `DO_SYNC_RELAY_CONFIG=../backend/sync-relay/wrangler.jsonc npm run dev`. This runs the relay as an auxiliary Worker so its named service binding works locally. Local Access configuration must use empty `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` and a synthetic `DEV_USER_EMAIL`. Use local D1 migrations. Do not replace a live developer's `.dev.vars` for testing.

Automated checks cover unauthorized access, account isolation, bootstrap protection, account invitation exchange, independent clipboard and credential channels, persistent settings, conflict rejection, revocation, expiry, 8 MiB chunk storage and metadata-only listings. The macOS-only relay interop test compiles a Swift harness and checks Web Crypto → CryptoKit → Web Crypto using synthetic Groq keys. Native tests cover authenticated metadata, MIME boundaries, expiry and settings validation. These do not substitute for a physical two-computer acceptance test or a production Groq call.

Validation completed locally: 25 relay/protocol tests, 54 web tests, and 8 selected native sync tests passed. Relay type checks, web lint/type checks, the web production build, and the native test build passed. An isolated local browser preview successfully bootstrapped a synthetic account, published encrypted preferences, and restored the shared model after a reload. No production Groq key was used.

## Deployment record — September 10, 2026

- Relay: `90aed35e-4bce-4895-aeb1-0bfcfce0f9b4`, deployed at https://dictation-operative-sync.davisopp.workers.dev.
- Web: `45ad76ae-06c3-432d-8fbc-ecd29a9a97d3`, deployed at https://do-voice-workspace.davisopp.workers.dev, with the `SYNC_ACCOUNTS` service binding.
- Remote D1 migration `0003_spicy_sister_grimm.sql` applied successfully.
- Installed Mac signing identity matches the previous installation: Developer ID Application, team `NB75Z9MVN9`. Strict signature verification passed. Installed executable SHA-256 matches the signed build: `facd79ebc5ba98e0a6df2201d1d08d33ca40b3173ed02cd455efe2279e668b2d`.
- Previous Mac build retained at `/Applications/.dictation-install.INuM4B/Previous-Dictation.app`.
- Live smoke checks: relay account endpoint rejects unauthenticated requests with 401; web and private account API remain behind Cloudflare Access (302 sign-in redirect). Installed app was confirmed running from `/Applications/Dictation.app`.
- This was a direct signed installation on this Mac, not a published Sparkle/GitHub release or installation on other computers. Account enrollment and Groq sharing remain user opt-in.

## Saved Clipboard tab across Windows and Mac

The web/installed PWA Clipboard tab is the same persistent account library on both operating systems. Pinned text and saved images are stored under the verified sign-in identity; sign in with the same account on each computer. No device pairing or Groq key is required for this saved library.

Visible lists refresh about every five seconds and when the window regains focus or connectivity. Refresh includes additions, edits, unpins, and deletions, retains the loaded page depth, and pauses during local edits/actions. Hidden windows catch up when reopened. Transient network failures retain the last loaded list and retry. Saved items remain until deleted; the two-minute expiry above applies only to the separate encrypted device-to-device transfer feature. The saved library uses the existing authenticated server storage, not the account transfer encryption protocol.

Validation: 56 web tests pass, including account isolation for saved items and refresh pagination/deletion coverage. Windows native prototype does not implement the saved Clipboard tab; use the DO web app or installed PWA on Windows and Mac.

## Canonical saved Clipboard deployment correction — September 10, 2026

The user's active saved Clipboard is **https://do-voice-workspace.davisopp.chatgpt.site**, Sites project `appgprj_6a9e18701ee881918f130e70a3dec31b`. Its source is maintained in `sites-pwa/` (separate Git repository). Deploy it through Sites, preserving its ChatGPT authentication, D1 and R2 bindings. The `pwa/` checkout currently targets the separate Cloudflare Access `workers.dev` deployment, with a different database and owner identity. Deploying that Worker DOES NOT update the Sites URL or sync the two databases.

Sites version 16 adds direct text entry in Clipboard and foreground refresh of saved text/images. Account email appears above the Clipboard form. Save creates a pinned item atomically and reuses its identifier on retry. Validation: 49 tests pass on the Sites source, including direct saved Clipboard creation, retry, same-account reads, other-account isolation, deletion, and refresh pagination. This supersedes earlier statements implying the workers.dev deployment updated the user's open Sites app.

## Current deployment target — user confirmed September 10, 2026

The user has now explicitly selected the **Cloudflare deployment** as their deployment target. Use `pwa/` and `https://do-voice-workspace.davisopp.workers.dev` for subsequent app changes and deployment. The direct Clipboard text form, automatic list refresh, atomic pinned creation, and signed-in email display have been ported from Sites while preserving Cloudflare Access authentication and account device-sync bindings. Sites and Cloudflare remain separate data stores; this code deployment does not migrate saved items or credentials between them.

## Sync controls on both deployments — September 10, 2026

Added Sync now and a combined last-successful-sync status for text and images to both `pwa/` (Cloudflare) and `sites-pwa/` (Sites), as requested. The five-second foreground polling and focus/online refresh remain active. Manual and automatic refresh share the same in-flight request guard; navigation and local editing/saving abort the request. Failed reads preserve existing items and surface a retry message. A combined success timestamp is shown only after both lists have completed a successful refresh.

Validation: Cloudflare source 58 tests; Sites source 50 tests; both typechecks, lint, and builds passed. Cloudflare deployed version `b0f7c243-e27c-461f-b9fb-59af7c73bf4c`. Sites version 17 uses source `86ed755d378d24f5b3ea12b37d04953fc3de3ab8`. Data remains separate between origins; all participating computers must use the same origin/account.
