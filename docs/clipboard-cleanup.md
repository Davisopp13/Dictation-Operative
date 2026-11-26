# Daily Clipboard cleanup

Implemented September 28, 2026 in `pwa/`, the Cloudflare app. Integration uses
the root GitHub repository through `codex/daily-clipboard-cleanup` into `main`,
starting from `1946e2e`. No production migration, deployment, or account opt-in
was performed. The nested PWA checkout remains on `cloudflare-hosting` at
`b474461`, with substantial pre-existing changes; its older Sites remote is
not a release target. Existing demo changes were preserved.

## Behavior

- Settings → Daily Clipboard cleanup is optional, defaults off, and is stored per
  authenticated account. Turning it on does not immediately delete items.
- A server job runs at 08:00 UTC daily, even when the app is closed. At each run,
  unpinned Clipboard text and images with a creation time strictly older than
  24 hours are eligible. Depending on the daily run, removal normally occurs
  between 24 and 48 hours after creation. Temporary failures can delay cleanup.
- Pinned items stay until explicitly deleted. Images now have Pin/Unpin controls,
  and the Pinned filter combines text and images with search and pagination.
- Cleanup removes active records permanently. Image bytes are removed through a
  durable retry queue. It does not clear a device's current operating-system
  clipboard or alter the separate two-minute encrypted transfer lifetime.
- Dictation/capture history and imports remain saved. Only text newly created by
  the direct Clipboard form carries the `clipboard_item` marker. Pre-feature
  text defaults to preserved: its origin cannot be reliably inferred. Appending
  another segment removes this marker so the recording stays in history.
- Shared lists use the existing foreground refresh to reflect deletions and pin
  changes. The account setting is loaded on app entry and returned after changes.

## Storage and concurrency

Migration `0005_fuzzy_cable.sql` adds the account preference, text origin marker,
image pin, and `clipboard_image_deletion_queue`. It includes an `AFTER DELETE`
trigger on image metadata. Keep that trigger when changing future migrations;
Drizzle snapshots describe tables, not this hand-authored trigger.

The cleanup job deletes at most 100 text and 100 image records per transactional
D1 batch, rechecking pins and account opt-in each time. It counts `RETURNING id`
rows because D1 change metadata includes trigger writes. A successful pin that
commits before cleanup protects the item; pinning an already removed image
returns 404. A retried create cannot reclassify an existing history record.

Image metadata deletion and queue insertion are atomic. R2 keys are unique and
immutable. Byte deletion happens only after a queue record exists; failures keep
that record for retry. The job also drains files already queued when cleanup has
subsequently been turned off. Manual image deletion uses the same queue and tries
immediate byte deletion. Each scheduled invocation processes at most 50 pages of
metadata and 50 pages of queued files; pending work marks the invocation failed
and remains retryable on the next daily run. Logs contain counts only, never
clipboard contents or account identities.

## Verification

- Full PWA suite: 91 tests pass, including real D1/R2 retention, migration defaults,
  opt-in isolation and validation, exact age boundaries, pins, history protection,
  create retries, concurrent pin/cleanup, storage failures and multipage cleanup.
- Type checking, lint and production build pass.
- Isolated browser preview verified the Settings toggle and explanation, saved
  state, image pin/unpin, combined Pinned filter, and immediate removal from the
  Pinned view after unpinning. The Settings layout was visually checked.
- `npm run test:built-clipboard` exercises the actual bundled scheduled handler
  with synthetic fixtures in isolated D1/R2. It verifies opt-in, protected text
  and history, and deletion of both image metadata and bytes.

## Release

The code is built and verified locally. Production release remains next:

1. From `pwa/`, apply `npm run db:migrate` before deploying. The migration defaults
   every existing account to cleanup off and preserves all pre-feature text.
2. Run `npm run deploy`; confirm the generated config retains the daily trigger
   and the deployed Worker exposes the scheduled handler.
3. Verify Settings and image pins on the selected Cloudflare origin. Users can
   then enable daily cleanup for their own accounts.

Do not deploy the separate `sites-pwa/` app or migrate between its data store and
Cloudflare as part of this change. Existing native apps require no changes.

## F2 additive pile protection (local implementation)

With migration 0009 and the F2 Worker, active pile memberships are checked inside
the cleanup transaction. Cleanup records an owner-scoped cleared tombstone before
deleting a source, so a racing membership add can distinguish cleanup from an
unknown/deleted item. Source deletion atomically removes all references and keeps
the existing byte queues. Remove and pin is atomic. Defaults, strict 24-hour age
and 08:00 UTC schedule remain unchanged.

The pile UI, collection migration and tray remain gated. Do not roll back to an
older scheduler after populated memberships exist without disabling cleanup for
affected accounts. See [shared contracts and release gates](../pwa/docs/shared-items.md).
No production migration or deployment was performed.

The older Worker's account-deletion handler also leaves F2 tombstones/pile
metadata on schema 0009, even before memberships exist. Follow the separate
[account-erasure reconciliation procedure](../pwa/docs/account-erasure-reconciliation.md)
for rollout/rollback; the cleanup opt-out alone does not solve account erasure.
