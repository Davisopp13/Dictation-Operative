# Content tray — local implementation, October 2, 2026

> **Status, November 24, 2026:** the view is now labelled **Documents** in the
> app. Its stored page value (`content`), API path (`/api/content`), tables
> (`content_items`, `content_deletion_queue`), and R2 key prefix (`content/`)
> are unchanged. `npm run test:built-content` runs the built check below.

Content is a small cross-device tray beside Clipboard, not a Google Drive archive.
Use the same Cloudflare PWA and signed-in account on each device. Explicitly add
files or Google Docs/Sheets links; search titles/filenames, pin, play MP3/MP4,
download and delete. Other formats download only. Playback depends on browser
codec support. No captions or transcoding are generated.

## Defaults and privacy

- 50 MB/file, 2 GB/account (decimal bytes), 500 items including links. Constants:
  `lib/content-model.ts`; the SQL migration also checks the per-file limit.
- Saved files and links remain until explicit deletion, including unpinned items.
  Clipboard cleanup does not apply and existing data is never reclassified.
- Files use private R2 under `content/<uuid>` with owner-scoped D1 metadata.
  They are readable by the DO server, separately from E2E device Sync. Content
  is not sent to AI. Existing `IMAGES` binding is reused; no new bucket or scopes.
- Google links point to HTTPS `docs.google.com/document/d/...` or
  `/spreadsheets/d/...`. Originals and access permissions remain with Google.
  No integration, copying, credential access, preview crawling or native Mac tray.
- Content requires internet and is excluded from text JSON backups. Download
  important files separately.

## Streaming and recovery

`POST /api/content` reserves quota atomically; `PUT /api/content/<id>/file`
streams the exact reserved byte count via Workers FixedLengthStream into R2.
A single upload claims each reservation. No entire video is buffered in Worker
memory. Uploads have a ten-minute deadline; abandoned reservations expire after
one hour and are removed by the existing 08:00 UTC daily scheduled handler.
This can take about 25 hours after reservation, longer during outages. Saved
ready files and links never expire.

D1 deletion triggers atomically queue byte cleanup with metadata removal. Failed
R2 deletions retry daily; deleted metadata is immediately inaccessible. Quota
includes ready files, unfinished reservations and queued byte deletions until
storage cleanup succeeds. Parallel reservations cannot bypass the cap. Preserve
`content_items_queue_delete` in future migrations. Cleanup attempts 500 queued
files per run; larger backlogs drain over subsequent daily runs.

All requests use existing app authentication and owner checks; mutations require
same origin. Every read/range request rechecks the session. Streamed GET/HEAD
supports single explicit/open/suffix byte ranges, 206/416 and If-Range ETags.
Responses are no-store, nosniff, same-origin and sandboxed. Only `.mp3` with
`audio/mpeg` or `.mp4` with `video/mp4` are inline; other types use opaque binary
attachments. MIME/extension is a playback hint, not antivirus or codec validation.
No OS clipboard monitoring or writes are introduced.

## Validation and production setup

Local only: no production migration, upload, provisioning, push or deployment.
Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then
`node scripts/verify-built-content.mjs`. Tests use isolated synthetic D1/R2 and
accounts. Existing built clipboard/auth/download checks remain relevant.

After separate production approval: review and apply `0006_content_tray.sql`
after existing migrations, deploy the validated PWA Worker, confirm the existing
daily cron reaches the combined cleanup handler, and keep R2 private. Do not
deploy `sites-pwa/`, change native/relay storage, reset the old migration journal,
or deploy without the new tables and deletion trigger. Additive storage can
remain intact during an application rollback.

The 2 GB cap is per account, not global. Retention and account count drive storage
costs; additions and playback add R2 operations and Worker requests. Existing
signup/auth limits remain. Decide on a global budget/access policy before broad
public rollout. Encryption, bigger resumable uploads and native share extensions
are separate future work.
