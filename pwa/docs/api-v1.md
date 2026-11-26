# /api/v1

The contract native clients build against. It sits on the same storage,
ownership checks, quotas, and deletion queues as the browser API, which keeps
working unchanged. The router is `lib/api-v1.ts`.

## Status

Local only. Migrations `0007_workspace_revision.sql` and
`0008_oauth_provider.sql` are not applied to production.

## Authentication

Two ways in, never mixed on one request:

- **Bearer token** from [native sign-in](native-sign-in.md):
  `Authorization: Bearer <access token>`. No `Origin` is needed. This is what
  native apps use.
- **Browser session cookie.** Every non-GET request also needs an `Origin`
  equal to the request's own origin.

A request that carries a bearer token is judged on the token alone.

## Conventions

- JSON in and out. Errors are `{ "error": "message" }` with a 4xx or 5xx status.
- Identifiers are 8 to 80 characters of `A-Z a-z 0-9 _ -`. Clients should
  generate UUIDs. Identifiers are global across accounts: using one that
  belongs to another account returns 409 and reveals nothing about it.
- Times are milliseconds since the Unix epoch.
- Every response is `Cache-Control: no-store`.

## Revision

`GET /api/v1/revision` → `{ revision, updatedAt, serverTime }`

One counter per workspace. It increases on every change to saved text, images,
or documents, from any device and from scheduled cleanup. A workspace that has
not changed since the counter was introduced reads `0`.

Intended client loop: poll the revision every five seconds while in the
foreground, and immediately on resume, on reconnect, and after a successful
write. Refetch lists only when the number differs from the one stored with the
last fetch. Each list response includes the `revision` read just before the
list, so storing that value never hides a change that raced with the listing.
The number only ever increases; compare for inequality, not for size of jump.

## Lists

`GET /text`, `GET /images`, and `GET /documents` return

```json
{ "items": [], "nextCursor": "opaque-or-null", "revision": 12 }
```

Newest first. Pass `nextCursor` back as `cursor` for the next page; `null`
means the end. `limit` is 1 to 100 (default 50 for text, 40 for images and
documents). Cursors are keyset positions, so deleting items between requests
never causes a later item to be skipped. An item edited while you page through
text can move to the top and be missed on that pass; the revision will have
moved, so the next refresh picks it up.

Filters: `q` (search), `pinned=true`, and for text `collection` and `tag`.

## Text

| Request | Result |
| --- | --- |
| `GET /text` | Page of summaries. `content` is the first 500 characters; `contentLength` is the full length. |
| `POST /text` | Create. Body: `id`, `content`, optional `title`, `pinned`, `collection`, `tags`, `clipboardItem`. 201 when created, 200 with the saved item when the `id` already exists in this account. |
| `GET /text/:id` | Full item with original segments and versions. |
| `PATCH /text/:id` | Body carries `action`, the item's current `revision`, and the action's fields. Actions: `edit`, `rename`, `pin`, `organize`, `append`, `without-segment`, `restore`, `restore-original`. 409 if `revision` is stale. |
| `DELETE /text/:id?revision=N` | 409 if `revision` is stale. The revision may be sent in a JSON body instead. |

A repeated create is first-write-wins: the response is what was saved the first
time, even if the retry carried different text.

Text created through this API is a Clipboard item unless `clipboardItem` is
`false`, so it is removed by daily cleanup when the account has turned that on
and the item is unpinned and older than 24 hours.

Each item has its own `revision` for optimistic locking. That is separate from
the workspace revision.

## Images

| Request | Result |
| --- | --- |
| `GET /images` | Page of `{ id, name, size, width, height, createdAt, pinned }`. |
| `PUT /images/:id?name=…` | Create. Body is the PNG, `Content-Type: image/png`, at most 8 MiB. 201 when created, 200 with the saved metadata when the `id` already exists in this account (the body is not stored again). |
| `GET /images/:id` | Metadata. |
| `GET /images/:id/file` | The PNG. Add `?download` for an attachment disposition. |
| `PATCH /images/:id` | Body `{ "pinned": true }`. |
| `DELETE /images/:id` | |

Only PNG is accepted. Clients convert other formats, including HEIC and JPEG,
before upload.

Budget per account: 2 GB and 5,000 images. An upload past either returns 409.
These numbers are placeholders pending an agreed storage budget.

## Documents

| Request | Result |
| --- | --- |
| `GET /documents` | Page of ready items, plus `usedBytes`, `pendingBytes`, `itemCount`, `fileLimit`, `accountLimit`, `itemLimit`. |
| `POST /documents` | Reserve a file or save a link. File body: `kind: "file"`, `name`, `filename`, `size`, optional `id`, `mime`. Link body: `kind: "link"`, `name`, `url`, optional `id`. 201 when created, 200 with the existing item when the `id` already exists in this account. |
| `GET /documents/:id` | The item and its upload `state`. |
| `PUT /documents/:id/file` | Upload. `Content-Type: application/octet-stream` and a `Content-Length` equal to the reserved `size`. |
| `GET` or `HEAD /documents/:id/file` | The file. Single byte ranges and `If-Range` are supported. |
| `PATCH /documents/:id` | Body `{ "pinned": true }`. |
| `DELETE /documents/:id` | 409 while an upload is being written. |

Items carry `state`:

- `uploading`: reserved, waiting for the file. The reservation expires after
  one hour.
- `writing`: the upload is in progress.
- `ready`: saved. Links are ready immediately.

Recovering from an uncertain upload: `GET /documents/:id`.

- `ready`: it worked. Sending the same `PUT` again is also safe and returns the
  item.
- `uploading`: send the `PUT` again.
- `writing`: wait and ask again; the server allows ten minutes.
- 404: the upload failed and the reservation is gone. Reserve again with the
  same `id` and upload.

Limits: 50 MB per file, 2 GB per account, 500 items.

Media types: an item keeps its real `mime` only when the declared type is one
of MP3, MP4, PDF, PNG, JPEG, WebP, or GIF and the filename has the matching
extension. Everything else, including SVG and HTML, is
`application/octet-stream`. Audio, video, and images are served with an
`inline` disposition unless `?download` is given; PDFs and opaque files are
always attachments. Every file response carries `nosniff` and a sandbox
content security policy, so a native client should fetch the bytes and render
PDFs and images itself, using `mime` and `filename` from the item.

## Deployment notes

- Apply migrations before deploying the Worker, as usual. `0007` adds a table
  and triggers on `clipboard_images` and `content_items` only, so the currently
  deployed Worker keeps working after the migration and before the deploy.
- Saved text is deliberately not covered by a trigger. Its writes are
  conditional on a row revision, and D1 includes trigger writes in the row
  counts the older code checks. The application bumps the workspace revision
  for text in the same batch as the write.
- This Worker needs `0007`: saving text writes to `workspace_revision`. Do not
  deploy it before the migration.
- If the revision cannot be read, the web app reloads its lists on every tick,
  as it did before, so a revision outage never hides new items.

## Shared items and pile references (F2)

Migration `0009_shared_items.sql` adds `GET /items`, `GET /items/:kind/:id`, and
`GET`/`POST /piles/:id/members`. See [the shared browser/native contract](shared-items.md)
for typed references, current capabilities, cleanup status, revision-bound
aggregate cursors, retry receipts, manual ordering and activation/rollback gates.
These additions preserve the store-specific routes above. There is no pile
creation/deletion workflow, collection backfill or tray endpoint in F2.

With 0009, text source writes/deletes also invalidate the workspace through
triggers, including deletion in the cleanup transaction. The pinned base already
uses `RETURNING` for optimistic text writes, so trigger-inclusive row counts no
longer affect success detection. This supersedes the historical 0007-only
text-trigger warning above. Do not roll back to earlier row-count-based writers.

The pre-F2 Worker remains incomplete for account erasure after migration 0009.
The [B1 reconciliation runbook](account-erasure-reconciliation.md) is required
for the migration-before-code and rollback windows; a verified pre-window owner
census and current-account guards protect legitimate legacy workspaces.
