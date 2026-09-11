# DO — Voice Workspace (PWA V2)

Private, installable voice capture and writing workspace. This is a separate web
application beside the native macOS project; it reuses the DO brand assets.

Public signup and included AI are being rolled out. See [distribution setup](../docs/web-distribution.md)
for username/password signup, Google OAuth, existing-account migration and server-side shared Groq access.

## Included

- **Help · Quick start** in the desktop sidebar and mobile workspace menu opens
  the branded Capture → Refine → Use guide without leaving the current draft.
  `/help` is the standalone, shareable guide, with a PNG infographic download.
  Both app themes are supported. Guide copy lives in `lib/quick-start.ts`; run
  `node --import tsx scripts/generate-quick-start.ts` after copy changes to update
  the SVG. Set `DO_SHARP_PACKAGE` to an installed Sharp package directory in that
  command to regenerate the PNG as well. Both exports live in `public/docs/`.
- Tap-to-record notes, replies, and AI prompt ideas. Original transcripts save
  automatically; text can also be written or deliberately pasted.
- Searchable history, pinned internal clipboard, naming, edit, copy, share,
  delete, text export, and lossless JSON backup export/import.
- Mobile layout with a compact workspace menu, three thumb-friendly bottom tabs, per-view search/filter state, compact filter sheets, larger controls, keyboard-friendly text sizes, and safe-area spacing.
- Settings → Start page chooses Capture (default), Clipboard, or Compose for a fresh visit. Refreshing restores the current workspace tab independently of that choice. The start page is saved per account in this browser; the current tab is remembered separately in each browser tab. This restores navigation, not unsaved drafts or filters. Reopening an app window that is still running keeps its current view.
- One Clipboard destination on desktop and mobile: All combines saved text and images by most recent activity, Pinned keeps reusable text handy, and Images shows saved pictures. Text keeps its originals, versions, tags, collections, and Compose selection. Unpinning keeps the item in All; deletion removes it. Collection/tag filters apply to text only.
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

### Mac installation downloads

`/mac` guides users through downloading the native app, moving it to Applications,
granting Microphone and Accessibility permissions, downloading a speech model,
and pairing clipboard Sync. The main entry is Settings → Desktop apps, with
contextual links in Sync pairing help and PWA installation help. Settings remains
available when the PWA is already installed; setup links are absent from the
sidebar and mobile workspace menu.
The browser downloads the installer; macOS installation and permissions remain
user actions.

The authenticated `/api/mac-downloads/arm64` endpoint streams the signed,
notarized 0.2.0 beta 1 DMG for Apple Silicon and macOS 14+. This beta supports
paired Sync but predates account membership/shared Groq settings. Updates are
manual; users with a newer installed build should keep it.

`lib/mac-release.ts` pins the verified filename, size, SHA-256, and immutable R2
key. Publish the matching DMG before deploying the PWA:

```sh
npm run publish:mac-download -- /path/to/Dictation-0.2.0-beta.1-arm64.dmg --check
npm run publish:mac-download -- /path/to/Dictation-0.2.0-beta.1-arm64.dmg
```

The publisher rejects mismatched bytes before any upload. The installer uses the
existing private R2 bucket under `releases/macos/`, outside the static web asset
bundle. Missing or size-mismatched packages return 503; unauthenticated requests
cannot read the bucket. Downloads bypass the service worker's offline shell.
For a new release, notarize and staple both app and DMG with
`macos/scripts/prepare-beta.sh`, validate with Gatekeeper, then update the manifest
and setup page to match that exact release. Never substitute a signed-only build.

### Windows setup downloads

`/windows` contains the Win + Alt compatibility setup and is linked from the
Settings → Desktop apps and installation help. The two downloads stream
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

The credential-storage secret is `CREDENTIAL_ENCRYPTION_KEY`, set with
`wrangler secret put CREDENTIAL_ENCRYPTION_KEY`. Never add secrets or a provider
key to `wrangler.jsonc`, Git config, source, or frontend environment.

### Legacy sign-in and beta access

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

The new application sign-in is enabled with `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.
It takes precedence over the verified legacy Access identity. Keep the Access gate
until existing users have linked their new login as documented in the rollout guide.
Do not remove the old Access configuration or gate before that migration.

V2 includes project collections/tags, personal vocabulary, reusable templates,
persistent recording recovery and offline capture. Native Mac clipboard handoff
is available through the separately implemented Dictation Operative Sync.

## Account sync

Sync now includes an optional account device directory, encrypted shared Groq settings, and latest per-device clipboards. The first browser bootstraps from the verified Access identity; further devices join through approved pairings. Browser account requests use the `SYNC_ACCOUNTS` named service binding. Deploy the relay with `AccountAdmin` and its `v3` migration first, then apply the new D1 model migration before deploying this web build. No provider key is automatically exported from the existing server credential store.

For local multi-worker development, set `DO_SYNC_RELAY_CONFIG` to the sync relay’s `wrangler.jsonc` path before `npm run dev`. This enables the local auxiliary Worker.
