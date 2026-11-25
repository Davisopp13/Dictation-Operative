# Catch-all Desk (web app)

Private, installable workspace for moving text, images, and documents between
your devices. Paste, type, or upload on one device; copy, share, or download on
another. It was previously called Dictation Operative ("DO — Voice Workspace").
Web recording, transcription, and AI writing tools were retired in the Catchall
Desk restructuring; text dictated or rewritten earlier remains as ordinary saved
text.

The daily site is `https://dictationoperative.com/`. Infrastructure names
(`do-voice-workspace`, `do-voice-images`, `dictation-operative-sync`) and the
`do-…` browser storage keys keep their original names on purpose: renaming them
would sign people out, break device pairing, or orphan stored data.

## Included

- **Clipboard**: All combines saved text and images by most recent activity,
  Pinned keeps reusable items handy, and Images shows saved pictures. Add text
  by typing, pasting, or **Paste from clipboard**. Text keeps its originals,
  versions, tags, and collections. Collection and tag filters apply to text only.
- **Clipboard images**: paste screenshots or upload PNG, JPEG, and WebP; private
  R2 storage with D1 ownership metadata, thumbnails, full-size previews, copy,
  download, and delete. Images are saved as PNG (8 MiB / 40 MP maximum); text
  JSON backups exclude image files.
- **Documents**: explicitly added files and Google Docs/Sheets shortcuts.
  50 MB per file, 2 GB per account, 500 items. Documents stay until deleted;
  Clipboard cleanup does not apply. See [implementation and production
  setup](docs/content-tray.md). The view's stored page value is `content`.
- **Scan a document** (in Documents): photograph paper with the device camera
  or choose a photo; the page outline is detected and its four corners can be
  dragged; the page is flattened, cleaned (Colour, Black & white, or Photo),
  and up to 40 pages are saved as one PDF. Everything runs in the browser
  (`lib/scan.ts`, no libraries); the PDF then uploads like any other file.
- Search, pins, naming, editing, copy, share, delete, text export, and lossless
  JSON backup export/import.
- **Device Sync**: end-to-end encrypted, short-lived text and image handoff
  between paired devices through a separate relay, plus an optional account
  device directory.
- Settings → Start page chooses Clipboard (default) or Documents for a fresh
  visit. Refreshing restores the current tab. Start pages saved as the retired
  Capture or Compose pages open Clipboard.
- Settings → Daily Clipboard cleanup (off by default) removes unpinned
  Clipboard text and images older than 24 hours once a day. Earlier dictation
  history, imports, and text saved before the feature existed are never removed.
- **Help · Quick start** in the sidebar and mobile menu; `/help` is the
  standalone guide. Copy lives in `lib/quick-start.ts`.
- Home-screen manifest, app icons, an offline notice, and an update prompt.

### Recordings left on a device

The recorder is gone, but audio it stored in a browser's IndexedDB
(`do-recordings-v2`) is not. When the signed-in account has recordings in the
current browser, the workspace shows **Recordings left on this device** with
Download audio, Save transcript as text (when a transcript was already cached),
and Remove from this device. Saving a transcript never deletes the local
record. This panel is temporary and can be removed once it is no longer needed.

## Run locally

Requires Node 22.13+.

```sh
npm ci
npm run db:local
# Create .dev.vars (see .env.example)
npm run dev
```

Open the printed local URL. `DEV_USER_EMAIL` in `.dev.vars` stands in for a
signed-in user on localhost only. To exercise real sign-in locally, set
`BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.

For local multi-worker development, set `DO_SYNC_RELAY_CONFIG` to the sync
relay's `wrangler.jsonc` path before `npm run dev`.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:built-auth
npm run test:built-clipboard
npm run test:built-content
npm run test:built-downloads   # needs the Windows ZIPs in ../windows/dist
```

Tests use real D1 SQLite through Miniflare. They cover ownership, same-origin
requests, optimistic concurrency, idempotent creation/append/import, version
restoration, literal wildcard searches, backups, navigation (including the
retired-page mapping), daily cleanup, images, Documents, `/api/v1` (revision,
cursor pages, idempotent creates, upload recovery, the image budget), the
service worker upgrade, and the read-only local recording export. The built checks run the
actual Worker bundle against isolated local D1/R2. No production data or
credentials are used.

Lint is scoped to authored product code. The bundled shadcn primitives and
scaffold hooks are preserved. Some development tooling still has transitive
advisories (Miniflare/Drizzle/Cloudflare tooling); these tools are not part of
the deployed Worker. Do not blindly run `npm audit fix --force`.

## Data model and API

`db/schema.ts` is the migration source; `drizzle/` contains migrations. Do not
run schema creation in request handlers. SQL statements use bound parameters
and owner predicates.

Saved text lives in `clips`: original segments, an append-only version list, a
current draft, and a revision. Conditional updates prevent another tab's changes
from being overwritten. Limits: 20,000 characters per draft, 300 versions, and
850 KB per item. Imports are additive and safe to retry.

Tables and columns from the retired features are kept, unused, so nothing is
lost and a rollback stays possible: `usage`, `shared_ai_usage`, the Groq
columns on `preferences` (`encrypted_key`, `consent`, `model`), and the
vocabulary and templates inside `workspace_tools`. Version kinds `cleaned` and
`rewritten`, and clip kinds `reply`, `prompt`, and `combined`, remain valid for
existing rows.

`/api/v1` is the versioned contract for native clients: cursor-paged lists,
idempotent creates on client-chosen identifiers, upload status, and a
per-workspace revision for cheap change detection. See [docs/api-v1.md](docs/api-v1.md).
The browser routes under `/api/` are unchanged. The web app polls the revision
every five seconds and reloads its lists only when it moves.

Native apps sign in through the system browser with OAuth 2.1 authorization
code and PKCE, then call `/api/v1` with a short-lived bearer token. See
[docs/native-sign-in.md](docs/native-sign-in.md), including how an operator
registers an app.

Settings → Account sign-in also offers **Delete my account**, which removes the
workspace, its files, and the sign-in after a fresh sign-in and a typed
confirmation.

Clipboard images have a per-account budget of 2 GB and 5,000 images
(placeholders pending an agreed storage budget), separate from the Documents
limits.

Workspace APIs enter through `worker.ts` and share `lib/workspace-request.ts`
with the framework route. Every non-GET request must carry an `Origin` equal to
the request's own origin. Session validity is checked in D1 on every request.

### Adding password sign-in to a Google account

Open **Settings → Account sign-in** (`/account/sign-in`) while signed in with
Google. Confirm Google sign-in again if prompted, then add a password of at
least 12 characters within 10 minutes. The password is attached to the existing
user and workspace; Google sign-in stays connected. Email password recovery is
not configured.

### PWA installation

Sign in, then use **Install app** in the workspace or the browser's install
menu. On iPhone/iPad, open the site in Safari and use **Share → Add to Home
Screen**.

The manifest `id`, `start_url`, and `scope` are all `/` and must not change:
installed apps are identified by them. The service worker is `/sw.js` with
scope `/`. Its cache is named `do-static-v<n>`; bump the number when the
precached files change and keep the prefix, because activation deletes older
caches by that prefix. Private API responses are never cached.

## Publishing

### Workspace deployment

The site is a Cloudflare Worker (`wrangler.jsonc`): `do-voice-workspace`, on
the custom domain `dictationoperative.com` and the account's `workers.dev`
subdomain, with D1 `do-voice-workspace` and R2 `do-voice-images`.

```sh
npm run db:migrate   # apply new migrations to the remote D1
npm run deploy       # vinext build, then wrangler deploy
```

Both commands change production and need explicit approval. Before the first
Catch-all Desk deploy, confirm which migrations production already has:
`0005_fuzzy_cable.sql` (daily cleanup), `0006_content_tray.sql` (Documents),
`0007_workspace_revision.sql` (sync revision), and `0008_oauth_provider.sql`
(native sign-in) were all unapplied when this branch was cut. Apply migrations before deploying the Worker.

Sign-in uses Better Auth application sessions (`BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `AUTH_ADDITIONAL_ORIGINS`, and optional Google credentials).
`lib/identity.ts` still accepts a verified Cloudflare Access identity as a
legacy fallback when `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set; production
leaves them unset.

The Worker no longer reads `CREDENTIAL_ENCRYPTION_KEY`, `GROQ_API_KEY`,
`SHARED_GROQ_CREDENTIAL_OWNER`, or the `SHARED_AI_*` limits. Leave the
`CREDENTIAL_ENCRYPTION_KEY` secret in place: it is the only way to decrypt the
Groq keys still stored in `preferences`. Never add secrets to `wrangler.jsonc`,
Git config, source, or frontend environment.

### Legacy desktop downloads

`/mac` and `/windows` and their authenticated download routes
(`/api/mac-downloads/arm64`, `/api/windows-downloads/{x64,arm64}`) still work
but are no longer linked from the workspace. They serve the earlier Dictation
Mac beta and the Windows hotkey test app from the private R2 bucket under
`releases/`. `lib/mac-release.ts` and `lib/windows-release.ts` pin each file's
name, size, and SHA-256; `npm run publish:mac-download` and
`npm run publish:windows-downloads` verify bytes before uploading.

## Account sync

Browser account requests use the `SYNC_ACCOUNTS` named service binding to the
relay's `AccountAdmin` entrypoint. The earlier Mac app can still publish
encrypted Groq settings through the account layer; the web app ignores them.
Pairing links are issued for `https://do-voice-workspace.davisopp.workers.dev`,
and the wire identifiers and key-derivation strings in `lib/sync/` (including
the salt `Dictation Operative Sync v1`) must stay byte-identical with
`../Shared/Sync/` and the Mac app.

## Look and brand

The visual design is "Catch-all Desk": white cards on a pale sky, blue gradient
panels where things come in, mint for what just arrived, sticky yellow for what
is pinned. Colours, radii and fonts are tokens at the top of `app/globals.css`;
the workspace's layout and components are styled in `app/desk.css`. The
Midnight (dark) theme is derived from the same tokens and was not separately
designed.

Fonts (Figtree and Nunito) are bundled through `@fontsource-variable`, so no
page load contacts a font service.

Logo files live in `public/brand/` and are raster drafts; see the README there.
The installed-app icons in `public/icons/` still carry the previous artwork.
