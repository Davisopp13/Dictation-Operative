# DO — Voice Workspace (PWA V2)

Private, installable voice capture and writing workspace. This is a separate web
application beside the native macOS project; it reuses the DO brand assets.

## Included

- Tap-to-record notes, replies, and AI prompt ideas. Original transcripts save
  automatically; text can also be written or deliberately pasted.
- Searchable history, pinned internal clipboard, naming, edit, copy, share,
  delete, text export, and lossless JSON backup export/import.
- Mobile layout with a compact workspace menu, four thumb-friendly bottom tabs, per-view search/filter state, compact filter sheets, larger controls, keyboard-friendly text sizes, and safe-area spacing.
- Dedicated Clipboard navigation on desktop and mobile for pinned text and saved images; Library keeps the full thought history.
- Clipboard images: paste screenshots or upload PNG, JPEG, and WebP; private R2 storage with D1 ownership metadata, thumbnails, full-size previews, copy, download, and delete. Images are saved as PNG (8 MiB / 40 MP maximum); text JSON backups exclude image files.
- Add More with immutable original segments, duplicate-safe recording retries,
  restore-original and complete version history.
- Compose ordered clips into a combined draft, email, progress update, or checklist.
- Groq connection management, explicit cloud-processing consent, encrypted
  credentials, authenticated owner-scoped storage, and same-origin mutations.
- Home-screen manifest, app icons, offline capture, update notification, optional
  WebMCP search/open/stage tools, keyboard-accessible dialogs and mobile layout.

## Run locally

Requires Node 22.13+ (tested on 22.22.3).

```sh
npm ci
npm run db:local
# Create .dev.vars (see .env.example): CREDENTIAL_ENCRYPTION_KEY and DEV_USER_EMAIL
npm run dev
```

Generate a **local-only** random credential-encryption key into `.dev.vars`:

```sh
node --input-type=module -e "import {randomBytes} from 'node:crypto'; import {writeFileSync} from 'node:fs'; writeFileSync('.dev.vars', 'CREDENTIAL_ENCRYPTION_KEY='+randomBytes(32).toString('base64')+'\n', {mode:0o600});"
```

Open the printed local URL. `DEV_USER_EMAIL` in `.dev.vars` stands in for a
signed-in user on localhost only; the deployed site signs users in through
Cloudflare Access (below). Do not rotate an existing encryption key without
migrating encrypted credentials; users otherwise need to reconnect their
provider key.

In Settings, connect a Groq API key and enable cloud processing. Nothing sends
recordings or text to Groq before consent. Keys are validated, encrypted on the
server with AES-GCM and account-specific additional authenticated data, and are
never returned by the API. Production secrets are Worker secrets (`wrangler secret`).

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Tests use real D1 SQLite through Miniflare, with synthetic provider responses.
They cover ownership, same-origin requests, optimistic concurrency, idempotent
creation/append/import, version restoration, literal wildcard searches, backups,
credential encryption and revocation, request contracts, and AI rate limits.
WebMCP contract tests use a registry harness; a supported real browser WebMCP
context was unavailable during development. Device recording/installation/share
and real provider quality still need a target-device acceptance pass.

Lint is scoped to authored product code. The bundled shadcn primitives and
scaffold hooks are preserved. Runtime React/RSC, Vinext and Vite were patched
from scaffold pins after audit found advisories. Some development tooling still
has transitive advisories (Miniflare/Drizzle/Cloudflare tooling); these tools are
not part of the deployed Worker application. Do not blindly run audit --force.

## Data model and API

`db/schema.ts` is the migration source; `drizzle/` contains generated migrations.
Do not run schema creation in request handlers. The site build packages migrations
for production. SQL statements use bound parameters and owner predicates.

Each thought contains original segments, an append-only text version list, a
current draft, and a revision. Conditional updates prevent another tab’s changes
from being overwritten. Limits: 20,000 characters per draft, 300 versions,
850 KB per thought, 20 source clips per composition, 5 minutes / 20 MB per
recording, and 10 AI requests per minute per account. Export larger libraries
before hitting per-thought limits. Imports are additive and safe to retry.

The service worker caches static icons and an offline recording shell, never
private API responses or authenticated pages. Unfinished audio is saved in
IndexedDB and deleted after successful library saving. See [V2 release notes](docs/v2.md)
for recovery guarantees, device limits, and validation.

### PWA installation

Sign in to the HTTPS Cloudflare site, then use **Install DO** in the workspace
or the browser's install menu. On iPhone/iPad, open the site in Safari and use
**Share → Add to Home Screen**. The installed app opens in its own standalone
window. Visit online once before relying on offline recording; transcription,
library saving, and AI require a connection.

The manifest link includes `crossorigin="use-credentials"` for Cloudflare Access.
Static asset headers revalidate the manifest, service worker, and offline shell;
service worker updates bypass the HTTP cache. API downloads and Access routes
are excluded from offline fallback. PWA tests verify icon dimensions, offline
assets, fallback behavior, and private-request exclusions. After deployment,
check installation and offline relaunch on each target device.

## Publishing

### Windows setup downloads

`/windows` contains the Win + Alt compatibility setup and is linked from the
sidebar, mobile menu, Settings, and installation help. The two downloads stream
through authenticated `/api/windows-downloads/x64` and `/api/windows-downloads/arm64`
routes. They are native prototype ZIPs, not automatically installed by the PWA.

Reviewed package sizes and SHA-256 hashes live in `lib/windows-release.ts`. The
ZIPs stay out of the web asset bundle and are stored under hash-qualified
`releases/windows/` keys in the existing private R2 bucket. No clipboard-image
records or database migrations are involved.

After building a new Windows release, update that manifest and verify/upload the
packages before deploying the site:

```sh
npm run publish:windows-downloads -- --check
npm run publish:windows-downloads
```

The upload script checks both local ZIPs before writing anything. Missing or
size-mismatched remote packages return an error rather than an invalid download.

### Workspace deployment

The site is a Cloudflare Worker (`wrangler.jsonc`): `do-voice-workspace` on the
account's `workers.dev` subdomain, with D1 `do-voice-workspace` and R2
`do-voice-images`. Deploy validated source with:

```sh
npm run db:migrate   # apply new Drizzle migrations to the remote D1
npm run deploy       # vinext build, then wrangler deploy
```

The one production secret is `CREDENTIAL_ENCRYPTION_KEY`, set with
`wrangler secret put CREDENTIAL_ENCRYPTION_KEY`. Never add secrets or a provider
key to `wrangler.jsonc`, Git config, source, or frontend environment.

### Sign-in and beta access

Cloudflare Access protects the Worker's hostname; its policy is the beta
allowlist. In the dashboard: Workers & Pages → do-voice-workspace → Access →
*Protect this Worker behind Access*. Then in Zero Trust → Access controls →
Applications, edit that application's policy to allow the testers' email
addresses, and copy two public values into `wrangler.jsonc` `vars`:

- `ACCESS_TEAM_DOMAIN` — the team domain, `https://<team>.cloudflareaccess.com`.
- `ACCESS_AUD` — the application's Audience (AUD) tag.

`app/auth.ts` verifies the `Cf-Access-Jwt-Assertion` JWT on every request
against those values and uses the token's `sub` as the account id. With either
value empty nobody can sign in, and the app never trusts a bare header.

V2 includes project collections/tags, personal vocabulary, reusable templates,
persistent recording recovery and offline capture. Native Mac clipboard handoff
is available through the separately implemented Dictation Operative Sync.

## Account sync

Sync now includes an optional account device directory, encrypted shared Groq settings, and latest per-device clipboards. The first browser bootstraps from the verified Access identity; further devices join through approved pairings. Browser account requests use the `SYNC_ACCOUNTS` named service binding. Deploy the relay with `AccountAdmin` and its `v3` migration first, then apply the new D1 model migration before deploying this web build. No provider key is automatically exported from the existing server credential store.

For local multi-worker development, set `DO_SYNC_RELAY_CONFIG` to the sync relay’s `wrangler.jsonc` path before `npm run dev`. This enables the local auxiliary Worker.
