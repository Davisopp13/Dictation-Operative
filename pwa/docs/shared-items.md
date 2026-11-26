# Shared item and pile membership contract (F2)

Implemented locally on the exact root base `09675098986887be287b240d1b4e2449fa4e6f07`
(tree `d71da055df4c7cd6d50ab524caa713037a17a2a3`, identical to F0's tested
`e4cc4141364f1524c42b8d2327a084254b2a2238`). Requires migration
`0009_shared_items.sql` after 0000–0008. This document applies equally to browser
session clients and native `/api/v1` bearer clients. No UI, production migration,
deployment, collection backfill or tray was added.

## Identity and aggregate reads

An item is `{kind: 'text' | 'image' | 'document', id}`. IDs retain their existing
validation and stores. The same ID in different stores represents distinct items.
Google shortcuts are `document` with `contentKind: 'link'`; Google URL validation
is unchanged. File reservations and active writes are excluded until ready.

- `GET /api/v1/items?limit=50&cursor=…` returns `{items,nextCursor,revision}`.
- `GET /api/v1/items/:kind/:id` returns one shared item, or 404/410.
- No filters/search in F2: unknown query parameters return 400. Continue using
  store-specific search; unified search belongs to S1.

A shared item carries `ref`, `name`, `displayKind`, `contentKind`, `preview`
(excerpt capped at 500 characters, full text length, dimensions, byte size,
MIME, filename, URL and host), `pinned`, `piles` (`id/name/color`), item
`revision`, `createdAt`, `sortTime`, `cleanup`, and `capabilities`.
`tray: {available:false,member:false}` explicitly denotes the T1 gate.
Private byte/object keys and ownership internals are not exposed.

Order is `(sortTime DESC, kind DESC, id DESC)` with SQLite binary string ordering.
Text uses `updated_at`; images and documents use `created_at`. Text edits therefore
resurface. Ties across all stores are deterministic. Limit is 1–100, default 50;
changing limit between pages is permitted. Cursors are opaque, versioned,
owner-bound and workspace-revision-bound. Revision and page rows are read in one
D1 batch transaction. If anything invalidates the workspace while paging, the next
page returns **409 `cursor_stale`**: discard the accumulated page sequence and
restart. This intentionally gives stronger consistency than legacy store cursors;
it neither pretends to retain a database snapshot across HTTP requests nor silently
misses a note moved by an edit. Cursors are not credentials; every query separately
checks the authenticated owner. Malformed/cross-owner cursors return 400.

## Revisions and capabilities

Text item revisions are the existing optimistic edit revision. Images/documents
have additive `item_revision` counters (initially 1, incremented by SQL triggers
on source updates, including old clients). Their existing PATCH routes remain
last-write-wins; this read version is **not** a new optimistic-write protocol.
Membership and pile ordering use the pile revision. Pile changes do not edit text
history or item revision, except Remove and pin, which changes the source pin and
increments its item revision. Text pinning also updates its normal sort time.

Workspace revisions are monotonic invalidation counters, not event counts. SQL
triggers now cover text writes/deletes and cleanup-setting changes as well as
images/documents/piles, so source deletion and aggregate invalidation are atomic.
Existing application bumps may increase the counter additionally, including on
some legacy rejected/no-op text requests; compare inequality only. Text mutation
success uses `RETURNING`, never D1 change counts (which include trigger writes).
New no-op membership writes and exact retries do not move the workspace counter.

Capabilities describe currently implemented actions, subject to device/runtime
checks, sign-in and connectivity. They never claim that an action happened.

| Source | Copy | Preview/open | Print | Download | Play | Paired send |
| --- | --- | --- | --- | --- | --- | --- |
| Text | `text` | `editor` | yes (draft) | yes (.txt) | no | yes |
| Clipboard image | `image-if-supported` | `image` | yes | yes (PNG) | no | yes |
| PDF document | null | `pdf` | yes (existing limits) | yes | no | no |
| Image document | null | `image` | yes | yes | no | no |
| MP3/MP4 | null | `audio`/`video` | no | yes | yes, codec dependent | no |
| Other file | null | null | no | yes | no | no |
| Google shortcut | null | `open: external` | no | no | no | no |

System share, copy-link and OCR copy remain unavailable. File preview uses the
existing MIME allowlist, never filename guessing. Print is still bounded by the
existing PDF preparation limits, and a dismissed dialog is not proof of output.

## Minimal pile membership surface

F2 supplies storage and membership reads/writes for existing piles. **There is no
pile create/rename/delete/list workflow or UI.** P1 owns those endpoints, pile
creation with initial selection, deletion impact/confirmation, and limits at
creation. SQL fixtures create piles for verification. Pile records require a
trimmed-name length of 1–60 and one of `blue/glow/sky/mint/sunny/paper`; duplicate
names are legal. Proposed P1 account limit: 100 piles. Current enforced membership
limit: 500 slots per pile, including inactive Undo slots. P1 must deliberately
design slot compaction/Undo expiry before relaxing that bound.

`GET /api/v1/piles/:id/members` returns `{pile,members,revision}` in one transaction.
`pile.revision` is the write precondition; top-level `revision` is the workspace
counter. Active members are `{ref,position}`, in ascending manual order.

`POST /api/v1/piles/:id/members` takes:

```json
{
  "operationId": "client-generated-uuid",
  "revision": 3,
  "ref": {"kind":"text","id":"existing-item-uuid"},
  "action": "add"
}
```

Actions:

- `add`: append a new member; already-active membership is a no-op. Re-adding an
  inactive member appends; use `restore` for Undo.
- `remove`: deactivate the membership; source, bytes and other piles survive.
- `removeAndPin`: deactivate and pin the source in the **same transaction**. It
  pins even if another protection exists; this is the safe choice after a warning.
- `move`: move an active member before the optional `before: {kind,id}` reference;
  null/omitted means the end. The target must be active in this pile.
- `restore`: restore the retained slot using `undoOperationId` from the removal.
  It refuses if a later operation changed that member. It does not undo a pin.

Every request requires a current pile revision, even if it would be a no-op.
Each logical command gets one immutable operation ID; retry the **identical**
payload on uncertainty. Reuse with different payload returns 409
`operation_conflict`. A transaction records its receipt with the mutation.
Concurrent identical submissions apply once. Later replay returns the historical
receipt and never re-applies the mutation over newer work. Receipts retain only
reference/protection metadata, not note contents or file bytes.

The result contains `operationId`, `action`, `ref`, `changed`, `pileRevision`,
`committedAt`, `replayed`, and `item: {ref,pinned,revision,piles,cleanup}`. The item
protection result is computed **inside the committing transaction**, not from the
preflight read. It is authoritative at `committedAt`; on replay it is historical.
After a response, refetch/poll for subsequent changes, especially on a replay.

All mutations validate both pile owner and source owner. SQL membership guards
validate again at write time; document sources must still be ready. One bounded
D1 batch claims the expected revision, changes references/order/pin, and saves the
receipt. Conditional statements cannot run without the claim, and a failed SQL
guard rolls back the whole batch. Concurrent distinct commands from the same
pile revision have one winner; the loser receives 409 `revision_conflict` and
must refresh before a new intentional command. No automatic stale move replay.

Ordering retains inactive slots. Moving active rows reorders the complete slot
sequence, including those gaps; a removal Undo restores its retained position
relative to that sequence, preserving other committed moves. It does not reverse
another device's order changes. Appends follow all existing slots. Positions are
server-assigned integers, not arbitrary client ranks. Source deletion physically
removes slots and invalidates affected pile revisions. Gaps remain harmless.

Errors carry `{error,code}`: `pile_gone`/`item_gone`/`membership_gone` (404),
`item_cleared` (410), `revision_conflict`/`operation_conflict`/`limit_reached` (409).
A cleanup tombstone provides positive evidence for `item_cleared`; an unknown
or foreign ID gets generic `item_gone`. Source recreation clears its own tombstone.

## Retention, impact and deletion

`cleanup` is `{eligible,reason,clearsAt}`. Eligibility means **opt-in cleanup can
remove this item at its scheduled age**, not that it is already old. Reasons,
in precedence order, are `pinned`, `pile`, `document`, `history`, `legacy`, or null.
`tray` is reserved for T1 and never claimed in F2. With cleanup disabled, eligible
is false and clearsAt is null even for an otherwise loose item. `clearsAt` is the
first 08:00 UTC strictly after creation + 24 hours and after the read/commit time;
editing never extends cleanup age. At an exact 24-hour boundary it waits a day.
This is the next scheduled opportunity, not a promise about scheduler punctuality.

The current shared-item read supplies pile names for source-deletion warnings.
The membership write result supplies the actual post-removal protection state, so
a client can correct a stale warning/toast. F2 adds no destructive pile operation.
P1 must add transactionally consistent pile-deletion impact and atomic pinning of
newly exposed sources before enabling Delete pile. Recommended initial behavior:
confirmation only, **no pile-deletion Undo**; pile restoration is not in F2.

Scheduled cleanup still defaults off and runs daily at 08:00 UTC, with the same
strict `created_at < now - 24h` rule and history exemptions. Each deletion checks
active memberships inside the transaction. If add commits first, cleanup keeps
the source; if cleanup wins, add fails with a truthful `item_cleared`. An inactive
Undo slot is not protection. Remove-and-pin has no unprotected intermediate state.

Source-deletion triggers remove all memberships in the same transaction from
legacy browser APIs, `/api/v1`, cleanup and account erasure. Existing image and
document deletion queues remain authoritative; no byte/quota copy is made by
membership. Source deletion remains permanent. Pile deletion cascades references
only and preserves sources; a user-facing pile deletion route remains unavailable.
The F2 Worker account-deletion handler clears piles, slots, operation receipts
and tombstones before its final workspace-revision deletion; tests verify the
counter is not recreated. An older Worker on 0009 does not erase those new rows,
even before any piles exist; its erasure is incomplete until reconciliation.
Receipts/tombstones currently remain for the account lifetime; P1/C1 must define
bounded retention without violating replay/cleared-error semantics before pruning.

## Gates, migration and older clients

Migration 0009 is additive. Apply it before this Worker. Do not backfill collections
or enable any new UI during migration. Existing browser/native source payloads,
IDs, quota calculations, upload recovery, text backup formats, histories,
collections and tags are unchanged. The old text backup remains a text backup;
it does not claim to export piles or restore membership. No sync or printing
protocol changes.

The immediate application rollback target is the **pinned RETURNING-based base**,
not an older text writer that interprets D1 trigger-inclusive change counts.
That base remains compatible with source-table reads/writes, but **not complete
account erasure on 0009**. During migration-before-code rollout or rollback, its
source-delete triggers leave tombstones, and populated piles/receipts can remain.
Follow the [account-erasure reconciliation runbook](account-erasure-reconciliation.md):
capture verified account-to-owner pairs before the window, pause account mutations
through the old-Worker interval, and audit/reconcile after deploying the F2 Worker
and after a rollback interval. Keep deletion paused while the old Worker remains
live; one cleanup pass cannot cover later deletions. Do not sweep unmatched owners:
legitimate Access-only owners may have no application-account row. If an elapsed
window lacks identity evidence, document and resolve the gap before declaring
erasure reconciled.
**After memberships exist, an older scheduled cleanup implementation is unsafe**
because it lacks the exclusion predicate. Keep this scheduler or turn cleanup
off for all affected accounts before rolling back. Never roll back the migration
by dropping populated references; keep additive storage. Production migration,
deployment and rollback require the project's separate authorization.

F2 implements the server portion of F1 §6.5's pile-retention gate early because
membership cannot safely exist without it. Pile UI stays absent until P1–P3 and
P2's collection coexistence/migration verification. Tray entry points remain
absent until T1 adds atomic individual-entry retention and source/pile deletion
cleanup. T1 can use `pile` references resolved live in manual order, plus direct
`item` references; it must deduplicate and store Used/Hidden separately. F2 does
not create a materialized tray, snapshot members, or reserve speculative offline
columns. Offline writes/pack lifetime belong to T2/T3.

P2 mapping contract (not executed here): introduce an owner-scoped mapping table
with a unique `(owner, legacy_collection_key)` and stable `pile_id`; use the exact
stored nonempty collection string (existing validation trims writes), never pile
name as identity. Process old text rows in bounded batches with insert-on-conflict
and membership upserts guarded by the text revision read by that batch. Recheck
changed rows rather than applying stale collection assignments. Retries retain
existing pile IDs, names, manual order and manual memberships.

P2 must distinguish manual and collection provenance for a reference. Effective
membership is their union. An older client changing collection A to B removes
only A's collection provenance, adds B's collection provenance, and leaves any
manual A membership intact, all in the text write transaction. Clearing collection
removes only its collection provenance. Manual add does not rewrite collection.
An explicit Remove from pile removes both provenances; when that pile maps the
text's current collection it clears `collection` with the text revision checked
and bumped in the same transaction, so older clients see the intentional removal
and cannot recreate it through a repeated migration. New text/imports with a
collection receive mapped provenance transactionally; failed/stale text writes
must not alter membership. Pile renames do not rename legacy collection keys.

These rules must cover every legacy and v1 text/import path before P2 enables
mapping. Preserve legacy collection reads and text-only filters. Do not hide the
Collection editor until mapping, repeatability, concurrent legacy-write tests and
explicit-removal tests pass. F2 intentionally leaves collection edits independent.

Cloudflare's [D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/)
was checked: statements execute sequentially as a transaction and a failed
statement rolls back the batch. Local tests use real Miniflare D1/R2; built checks
exercise the shipped Worker and scheduler with isolated synthetic accounts.
