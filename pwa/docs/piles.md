# Pile management (P1)

Backend contracts for browser sessions and native bearer clients on `/api/v1`.
Requires additive `0010_pile_created_at.sql` after 0000–0009. No navigation,
start-page, collection, capture, tray or general-bookmark change. Google Docs and
Sheets shortcuts remain ready `document` references. Use the existing
[shared-item contract](shared-items.md) to resolve sources and manage memberships.

## P2 coexistence

After migrations 0011 and 0012, [collection mapping](collection-mapping.md) extends these
same piles/slots/receipts. Mapping-created piles count against the same limits.
Manual add can change provenance without changing active count. Deleting a mapped
pile permanently suppresses its exact collection key; source collections stay
intact. Unprocessed collection text retains its explicit cleanup hold, reflected
in impact reads. Source revision checked removal/Undo can clear/restore the mapped
legacy collection. All P1 confirmation and historical replay rules remain.

## Reads

A `pile` is exactly:

```json
{
  "id": "server-generated-uuid", "name": "Saturday errands", "color": "mint",
  "revision": 1, "createdAt": 1795800000000, "updatedAt": 1795800000000,
  "memberCount": 4
}
```

Times are Unix milliseconds. `createdAt` is immutable for P1 creates and `null`
for piles made by F2/older fixtures: the original creation time was not retained,
so migration does not invent one. `memberCount` counts active references only.

- `GET /piles?limit=50&cursor=…` → `{piles: pile[], nextCursor: string|null, revision: number}`.
- `GET /piles/:id` → `{pile, revision: number}`.
- Existing `GET /piles/:id/members` → `{pile, members: [{ref:{kind,id},position}], revision}`;
  its pile summary now also includes `createdAt` and `memberCount`.
- Resolve each reference through `GET /items/:kind/:id` or the aggregate item
  read. Pile records contain no source body or file copy. Member reads retain
  F2 manual ordering and inactive Undo slots.

`revision` at the top level is the workspace invalidation counter;
`pile.revision` is the write precondition. Each read's rows/count/revision come
from one D1 batch transaction. Pile list order is `(updated_at DESC, id DESC)`
with SQLite binary ID ordering. There is no manual ordering of pile covers in
P1; manual **member** ordering remains F2's protocol.

List limit is 1–100, default 50. Unknown query filters are rejected with 400.
Cursors are opaque, versioned, owner-bound and workspace-revision-bound. Changing
limit is permitted. A changed workspace gives 409 `cursor_stale`: discard the
page sequence and restart. Malformed/cross-owner cursors give 400. Cursors and
impact tokens are consistency markers, not credentials: every query separately
checks the authenticated owner. Separate reads can observe later commits; compare
workspace revisions when assembling multiple responses.

## Create

`POST /piles` takes:

```json
{
  "operationId": "client-generated-uuid",
  "name": "  Saturday errands  ", "color": "mint",
  "members": [
    {"kind":"image","id":"existing-image-id"},
    {"kind":"document","id":"existing-document-id"},
    {"kind":"text","id":"existing-text-id"}
  ]
}
```

Only `operationId` and `name` are required. `color` defaults to `blue`; allowed
values are `blue`, `glow`, `sky`, `mint`, `sunny`, `paper`. `members` defaults to
`[]`. Null is not an omitted value. Names are trimmed, 1–60 Unicode code points
(as counted by SQLite), with NUL rejected; duplicate names are allowed. Combined
emoji can contain several code points. Unknown top-level fields are rejected.

Initial selection limit is **50 references**, preserving the explicit array
order. Duplicate typed references are rejected; the same ID across different
kinds is legal. The request body is bounded to **12,000 bytes**, including JSON
syntax. Invalid/foreign/missing/not-ready sources abort the entire transaction,
including the pile, prior selection inserts, receipt and workspace invalidation.
F2's source guards check owner and readiness again during insertion. Cleanup
winning first returns `item_cleared` when its tombstone remains; if creation wins,
the active membership protects the source from cleanup. Explicit source deletion
can still remove it after creation, as it can after any successful membership add.

Account limit is **100 extant piles**, including empty piles. Count and conditional
insert run in the same transaction; concurrent requests cannot exceed it. Delete
a pile to free capacity. An identical retry can succeed at the limit via its
receipt. Initial selection is one bound JSON parameter expanded by `json_each`,
not one query per reference. Creation uses four batch statements, and deletion
six, each comfortably below the pinned runtime's parameter/SQL-size limits.

Application-session and bearer create requests carry the verified application
account internally, separate from a mapped legacy owner. The insert rechecks that
the account still exists and resolves to the same owner. If account erasure won,
it returns 401 without resurrecting pile metadata. Access-only and local identities
retain their existing ownership rules; they are not incorrectly assumed to have
an `auth_user` row. No auth provider or sign-in behavior is added.

Fresh success is **201**:

```json
{
  "operationId":"client-generated-uuid", "action":"createPile", "changed":true,
  "committedAt":1795800000000, "replayed":false,
  "pile":{"id":"server-generated-uuid","name":"Saturday errands","color":"mint",
          "revision":1,"createdAt":1795800000000,"updatedAt":1795800000000,"memberCount":3}
}
```

Exact retry is 200 with the original result and `replayed:true`, even after later
renaming or deletion. The receipt does **not** assert that the pile still exists.
It never recreates it. New intentional creation uses a new operation ID.

## Rename / color

`PATCH /piles/:id` takes `{operationId, revision, name?, color?}`. At least one
field is required. Validation matches creation. Response 200:
`{operationId, action:"updatePile", changed, committedAt, replayed, pile}`.

Every new command checks the current pile revision, including a no-op. A changed
name/color increments it once and changes `updatedAt`; unchanged normalized
values retain both timestamps/revision and cause no workspace invalidation.
No-op commands still save retry receipts. Concurrent distinct edits at a revision
have one winner unless the earlier command is a no-op; stale writes get 409
`revision_conflict`. Retry only on the original operation/payload when uncertain.

## Membership

Continue using `POST /piles/:id/members` with F2's `add`, `remove`, `removeAndPin`,
`move`, `restore`, revision, operation ID and optional `before`/`undoOperationId`.
New/re-added members append; `restore` restores the retained order slot and never
unpins. Removing one reference preserves sources and other piles. Name/color
edits share the same pile revision and serialize with membership changes.

The **500-slot limit includes inactive Undo slots**. No compaction, pruning or
expiry change is introduced. P3 must handle `limit_reached` even when fewer than
500 active items are visible. Creating another pile is possible within the account
limit; silently discarding Undo history is not. One source in multiple piles uses
no duplicate bytes and adds no source-storage quota charge.

## Preview deletion

`GET /piles/:id/deletion-impact` returns a consistent snapshot:

```json
{
  "pile":{"id":"pile-uuid","name":"Saturday errands","color":"mint","revision":7,
          "createdAt":1795800000000,"updatedAt":1795800001000,"memberCount":4},
  "revision":42, "asOf":1795800002000, "memberCount":4,
  "exposed":[{"ref":{"kind":"image","id":"image-uuid"},"name":"Screenshot",
              "createdAt":1795600000000,"eligibleAfter":1795686400000,"clearsAt":1795852800000}],
  "impactToken":"opaque-token", "defaultMode":"pin"
}
```

`exposed` is in current manual member order, at most 500 entries: surviving active
sources that become cleanup-eligible after removing this pile. It excludes pins,
other active piles, documents, legacy/history exemptions and all sources while
cleanup is off. Inactive Undo slots are neither members nor protection.
`eligibleAfter` is creation + 24 hours (cleanup uses a **strictly older** comparison).
`clearsAt` is the next scheduled 08:00 UTC opportunity, strictly after that age and
`asOf`, using the shared F2 helper; it is not a guarantee of scheduler punctuality.
Elapsed time can advance that opportunity; refresh a displayed confirmation as
appropriate. There is no tray effect or tray storage.

## Confirm deletion (no Undo)

`DELETE /piles/:id` accepts a JSON body:

```json
{
  "operationId":"client-generated-uuid", "revision":7,
  "impactToken":"token-from-preview", "mode":"pin"
}
```

Two explicit modes:

- `pin`: safe/default for P3. Pin exactly the surviving sources that would lose
  their last cleanup protection, then delete the pile and its slots atomically.
- `expose`: delete just the pile. Requires **`acknowledgeExposure:true`**, even
  if the preview lists zero exposed sources. Sources stay unpinned and may then
  be removed by the existing cleanup schedule.

Neither mode deletes any source, bytes, another pile, or quota record. Text
pinning follows F2 (bump text revision/update time, keep body/history intact);
image pinning uses the existing revision trigger. Documents need no new pin.

The server recomputes impact, then conditionally claims the pile inside the write
transaction only if both its revision and the **entire workspace revision** match
the preview. This detects changes to source pins, memberships in this or other
piles, source deletion/history, and cleanup settings. An unrelated workspace write
can also invalidate confirmation: this deliberate conservative policy is simpler
and safer than maintaining a separate protection counter. No-op/retry writes do
not invalidate it. If a change races after preflight, the transactional claim still
fails. No pins, reference changes or receipt are committed on conflict.

**409 `impact_stale`** means read a fresh impact and ask for confirmation again,
using a new operation ID and the new token. Never silently replace a token and
resubmit a destructive choice. A concurrently deleted/foreign/unknown pile gives
404 `pile_gone` after token validation. Tokens copied across owners/targets are
invalid (400); this reveals no target existence.

Success 200 is exactly:

```json
{
  "operationId":"client-generated-uuid", "action":"deletePile", "changed":true,
  "committedAt":1795800003000, "replayed":false, "pileId":"pile-uuid",
  "deleted":true, "pinned":[{"kind":"image","id":"image-uuid"}]
}
```

`pinned` lists the pins committed by this deletion (`[]` for expose). Receipt,
pins and cascade deletion share one transaction; there is no unprotected
intermediate state. The receipt survives deletion. Identical concurrent/later
retries return its historical result with `replayed:true`, without touching later
pin changes or recreating the pile. A fresh operation on the deleted ID gets 404.
**There is no pile-deletion Undo.** Individual membership removal retains F2 Undo.

## Retries, errors and retention

All three lifecycle mutations use F2's **account-wide `pile_operations` namespace**,
including membership operations. IDs use existing validation (8–80 alphanumeric,
underscore or hyphen; generate UUIDs). Successful operations, including no-ops,
store their outcome atomically. Reusing an ID with a different normalized command
or another operation/target returns **409 `operation_conflict`**. JSON property
ordering does not matter; trimmed names/defaulted optional fields are normalized;
selection order, expected revision, supplied update fields, deletion token and
choice do matter. Failed operations save no receipt. Concurrent identical requests
apply once. Historical replay changes only `replayed`; it never undoes later work.
Clients must refresh/poll current state after replay rather than treating it as
current state.

Errors follow `{error,code}` for shared-item domain errors: 404 `pile_gone` /
`item_gone`, 410 `item_cleared`, 409 `operation_conflict` / `revision_conflict` /
`cursor_stale` / `impact_stale` / `limit_reached`. A source that disappears and
reappears during failure diagnosis can return 409 `selection_changed` (refresh).
Input errors use the existing `{error}` convention (400, or 413 oversized body);
expired authentication is 401; browser Origin failure is 403. All responses are
`no-store`. Session and native bearer routes share the same implementation.

Receipts last for the account lifetime, including deleted-pile create/update/delete
receipts. They contain pile metadata, reference arrays and operation results, not
source bodies/files. There is no new receipt/tombstone table and no pruning or
expiry change. Existing account erasure removes piles, members, all receipts and
item tombstones, then workspace revision; deletion queues retain their existing
byte cleanup contract. Tests cover actual P1 receipts and mapped owners.

## Migration / rollout / next phases

0010 only adds nullable `piles.created_at`. It does not rewrite 0009, populate
piles, change source tables, or invalidate existing workspaces. Its Drizzle
snapshot/journal are checked in. Apply it before this Worker. F2 can continue
using the additive schema and erases these rows; older-than-F2 account erasure
still requires the [existing reconciliation runbook](account-erasure-reconciliation.md).
Keep pile-aware cleanup after references exist. Do not drop populated storage,
roll back to trigger-inclusive row-count writers, or weaken prior release gates.
No remote migration or production activation was performed for P1.

P2 can use stable pile IDs and the shared reference protocol, but still must
implement the documented collection provenance/backfill semantics. P1 does not
change collection writes or count/mapping policy; P2 must respect the 100-pile and
500-slot bounds and define overflow explicitly. P3 can rely on these endpoints,
revision/receipt semantics, colors, counts, manual membership order and explicit
delete confirmation. P3 owns screens and general HTTPS bookmarks; navigation and
start page are unchanged. Browser emulation/tests are not device acceptance.

Implementation uses the pinned Wrangler 4.92.0 / Miniflare 4.20260515.0 runtime.
Cloudflare's [batch transaction contract](https://developers.cloudflare.com/d1/worker-api/d1-database/)
and [SQL/parameter limits](https://developers.cloudflare.com/d1/platform/limits/)
were checked; synthetic local tests exercise rollback and full 500-member deletion.
