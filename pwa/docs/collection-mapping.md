# Collection mapping and backfill (P2)

Requires additive `0011_collection_mapping.sql` after 0000–0010. This extends
[F2 memberships](shared-items.md) and [P1 piles](piles.md). Navigation, start page,
Collection editor, source payloads, text-only filters, tags and backup format stay
as they are. No UI, tray, general bookmarks, printing or source copies are added.

## Identity and provenance

`collection_mappings` has a binary, exact `(owner,collection_key)` primary key and
one unique `pile_id`. Empty means exactly `''`; whitespace, case, Unicode forms,
NUL and arbitrarily long historical strings are not normalized or truncated as
keys. Different accounts never share a mapping. Matching manual pile names are
not reused. Renaming/recoloring a mapped pile changes only its display metadata.
Unused mapped piles retain their identity and count toward the 100-pile limit.

Initial display name policy is deterministic and deliberately separate from
identity. Nonempty printable ASCII keys are space-trimmed and truncated to 60
characters. All other keys use `Collection ` followed by the first 32 uppercase
hexadecimal digits of their UTF-8 bytes. This handles control/NUL/whitespace-only
and Unicode keys without an invalid display name. Display collisions are legal;
no suffix, identity folding or pile reuse occurs. Users may rename normally.
IDs are 32 random hexadecimal characters, valid existing API identifiers.

The existing `pile_members` row adds nullable `manual` and `collection_key`.
Active membership is the union of manual and collection provenance. For untouched
pre-P2 rows, NULL manual means the existing `active` flag: active rows are manual,
inactive Undo slots are not. The first provenance mutation materializes that
meaning. P1 initial selections also inherit manual=true. The schema migration
does not scan/rewrite membership rows or perform collection backfill. Positions,
last-operation IDs and existing receipts are unchanged by upgrade.

Manual add establishes manual provenance even when collection provenance already
keeps the member active. That semantic change bumps pile/workspace revisions and
invalidates stale moves/removals/deletion confirmations, without moving the slot.
A repeated manual add is then a true no-op. Collection assignment appends a new
slot after the greatest retained position; an existing active/inactive slot keeps
its position. No slot compaction occurs. Collection changes invalidate the member's
last-operation marker, preventing a later Undo from overwriting them.

## Every source write path

The actual mutation inventory is:

| Reachable path | Shared implementation and behavior |
| --- | --- |
| Legacy `POST /api/clips`, v1 `POST /api/v1/text` | `repository.insertClip`; creates with `collection_synced=1`, source and mapping/provenance in one SQL transaction |
| Legacy `POST /api/import` | `backup.importClip` / `importedId`, then the same insert; deterministic imported IDs and existing-ID skips unchanged |
| Legacy `PATCH /api/clips/:id`, v1 `PATCH /api/v1/text/:id` | `changeClip` then `repository.saveClip`; optimistic source revision remains the SQL precondition |
| `organize` | Assigns collection deliberately, including an unchanged value, and sets `collection_synced=1` |
| `edit`, `rename`, `pin`, `append`, `without-segment`, `restore`, `restore-original` | Preserve the current collection and sync marker; text versions/segments retain existing behavior. A helper caller changing the actual collection also sets the marker |
| Duplicate create / repeated append / duplicate import | Existing early-return or insert-conflict behavior; no trigger for a rejected insert, no provenance changes on replay |
| Explicit Remove / Remove and pin / membership Undo | `pile-members.writePileMember`, with the collection/source CAS described below |
| P1 safe pile deletion | Existing atomic source pin updates; does not assign/rewrite collection |
| Legacy/v1 single source delete, scheduled cleanup, account deletion | Existing source-delete triggers remove references atomically; no source restoration endpoint exists beyond content-version restoration/import |

Collection triggers run **after a successful source insert/update**, inside that
statement's transaction. A→B removes only A's collection provenance, preserves
manual A membership, and adds B's collection provenance. Clearing removes only
collection provenance. New creates/imports and deliberate assignments that need
unavailable pile/slot capacity fail with HTTP **409 `collection_capacity`**, leaving
source, history, mapping and provenance unchanged. An unrelated edit of an
unprocessed historical row does not try to migrate it or remove its cleanup hold.
A stale save cannot change provenance. Source success still uses `RETURNING`,
not trigger-inclusive change counts. Workspace invalidation comes from the
existing SQL triggers; redundant application bumps on rejected text writes were
removed to avoid recreating owner metadata after erasure.

Application-session and bearer source creation recheck their authenticated
account-to-owner relationship in the INSERT. An in-flight create/import after
account erasure cannot recreate sources or mappings. Access/local owners retain
their existing identity boundary. Backfill uses the same guard.

## Remove and Undo

An explicit removal of an active slot removes both provenances. If the pile maps
the text's current collection, it clears `clips.collection`, increments the text
revision and updates its normal sort time in the same transaction. Source revision
is checked at the serialization point even for plain Remove. Remove and pin also
pins atomically; clearing and pinning may each increment the text revision. Bodies,
versions, tags and segments are untouched. Removing an absent/inactive membership
is a no-op, except Remove and pin can still establish the requested pin.

The immutable removal receipt privately retains prior provenance, the cleared
exact collection (if any), its sync marker and the post-removal source revision.
Undo restores that provenance and the retained slot's current position relative
to other moves. If it must restore a collection, both the preflight and transaction
claim require the source to remain at the post-removal revision with its cleared
collection. **Any newer text edit, including a pin, refuses this Undo** with
`409 revision_conflict`; it never overwrites newer source work. Manual-only Undo
retains F2 behavior because it does not edit the source. Pre-P2 removal receipts
are interpreted as manual-only. Undo never unpins. Replayed operations return
exact historical protection outcomes and cannot reapply over newer organization.
An intentional later collection assignment after removal creates collection
provenance again, using the same mapping and retained slot.

## Inspect and advance

- `GET /api/v1/collection-backfill` reads current progress; it never migrates.
- `POST /api/v1/collection-backfill` accepts `{ "limit": 25 }`; `limit` defaults
  to 25, must be an integer 1–50. Unknown fields/query parameters are 400. Body
  bound is 1,024 bytes. No account/owner selection is accepted.
- Both use the existing versioned authentication, session Origin checks, native
  bearer behavior and `Cache-Control: no-store`. POST succeeds with 200 even when
  blocked; **inspect the status**, not only HTTP success. Authentication failures
  remain 401/403; unexpected SQL failure is 500 and rolls back the whole batch.

Response (POST adds `processed`; GET omits it):

```json
{
  "status": "incomplete",
  "complete": false,
  "processed": 25,
  "pending": 40,
  "ready": 35,
  "pileCapacity": 2,
  "memberCapacity": 1,
  "suppressedPending": 2,
  "mappedKeys": 7,
  "suppressedKeys": 1,
  "mappedMembers": 25,
  "revision": 123
}
```

All counters are owner-scoped. `pending` counts nonempty historical collection
rows not reconciled or deliberately reassigned; its four categories are disjoint.
`mappedMembers` counts collection provenance, not all effective manual members.
`mappedKeys` counts live mappings including currently empty piles. Suppressed keys
are not advertised as mapped. `status` is `complete` if pending=0, `incomplete` if
ready>0, otherwise `blocked`. Counts are current state, not cumulative job totals.

Each POST is one transaction containing at most 50 single-row writes plus an
account check and a final status read. Each write chooses the **current first
processable pending ID in SQLite binary order**. Blocked rows are left intact;
other processable rows can continue. Source revision/collection are not read in
JavaScript and applied later: selection, current source state, mapping creation,
capacity checks and member insertion share the write transaction. This is the
equivalent transactional guard to a source-revision CAS. The next write sees the
preceding write's new capacity. Concurrent runs serialize and cannot duplicate
keys or references. A failed statement rolls back all writes in that POST; earlier
successful batches remain. The source sync marker and mapping are the durable
progress; no job cursor, additional progress table or receipt is required.

Retry an interrupted/uncertain POST to **advance remaining work**. It is not an
operation-ID command and does not replay a historical `processed` value. Repeated
calls after completion write nothing. New references are ordered by selection
order within each batch, appended after all existing slots; existing manual order,
name/color, position, provenance and receipts are never reset by a retry.

`complete=true` proves at the reported transaction snapshot that no pending
nonempty collection row remains. There is no moving pagination boundary: a row
created/changed/deleted between calls is re-evaluated from current state, including
IDs sorting before previously processed rows. Normal P2 writes keep this invariant
transactionally. An older Worker can create new pending rows later, so completion
is not a promise about future writes. Suppressed, deliberately assigned rows can
be complete without membership: `suppressedKeys` reports that intentional policy.

## Capacity, deletion and cleanup

The same 100-pile account limit and 500 **retained slots** per pile apply to manual
and mapping operations. Active manual references and inactive Undo slots consume
capacity. Existing slots can acquire collection provenance without a new slot.
Backfill reports capacity-blocked rows rather than rejecting the whole useful
batch. New source assignments fail atomically if they cannot fit. Free capacity
by a normal pile deletion or source deletion, or deliberately clear/reassign a
collection; then repeat POST. No automatic limits increase, slot eviction, splitting
of keys, source loss, hidden pinning or "complete after skipping" behavior exists.
A >500-item collection cannot fit without deliberate user organization changes.

Deleting a mapped pile permanently suppresses its exact owner/key for this account
lifetime: `pile_id=NULL` is the suppression, never a dangling live mapping. Pile
sources and their collection fields remain unchanged. Backfill, unrelated edits,
explicit later assignments of that same key and old request replay **never recreate
it**. A user can create a manual pile and add those sources, or use a different
exact collection key for a new automatic mapping. There is no unsuppress endpoint
or mapped-pile deletion Undo in P2. This policy is intentionally conservative.

A historical text with nonempty collection and `collection_synced=0` has a
**transitional cleanup hold**, even before the first backfill request and while
capacity-blocked or suppressed-pending. Shared reads/receipts/impact calculations
report `{eligible:false, reason:"collection_pending", clearsAt:null}` when no
higher-priority pin/pile protection exists. This is not a claim of committed pile
membership. The scheduler adds exactly this owner/source predicate to its existing
transactional exclusion. It does not disable cleanup globally; ordinary unfiled
text/images retain opt-in, age and history rules.

After successful backfill the hold is replaced atomically by real membership.
Clearing or deliberately assigning a collection replaces/releases the hold within
the source write transaction; unrelated edits preserve it. After mapped-pile
deletion, unprocessed rows keep their hold and `suppressedPending` remains blocked.
They are not part of the pile's active members and cannot be silently exposed by
its deletion. Previously mapped members use P1's existing workspace-bound impact:
safe mode pins newly exposed members; expose requires acknowledgment. No bulk
collection rewrite is used. Other manual piles and pins continue protecting sources.
Provenance-only changes invalidate confirmation even when visible counts are equal.

## Upgrade, activation, older Workers and rollback

Older **clients** calling this new Worker receive all compatibility behavior above.
An older deployed **Worker** is a different case:

1. Quiesce workspace/account mutations and scheduled cleanup through the approved
   maintenance mechanism; drain in-flight requests before schema change. Capture
   verified account/owner evidence per the [erasure runbook](account-erasure-reconciliation.md).
2. Apply 0011 after its prerequisites. It only adds schema/triggers/index/view;
   it does not map sources. Default source marker=0 and inherited manual provenance
   preserve populated P1 data. P1's scheduler lacks the transitional hold, so it
   must not run during this window. P1 account deletion lacks mapping erasure.
3. Deploy P2 before reopening writes/scheduling. New source/import/assignment
   requests now activate their compatibility behavior; historical mapping starts
   only with explicit owner POSTs. Reconcile any old-Worker account-erasure window
   before reopening. Do not activate mapping on a P1 serving fleet.
4. In an old-Worker text-write window, new inserts and unsynced historical rows
   remain marker=0 and pending. Updates to already synced collection values still
   run the SQL reconciliation trigger. Capacity failure aborts their source write,
   but an old Worker may return generic 500 rather than P2's 409. Unchanged values
   do not resurrect suppressed mappings. These tests do not make old membership
   handlers, cleanup or account-erasure code P2-compatible.
5. **Rollback to P1 is not a safe live-write rollback after mapping population**:
   old membership handlers cannot maintain provenance, old cleanup misses pending
   holds, and old erasure leaves mappings/suppressions. Before any population the
   additive schema is source-compatible, but the pending-hold/scheduler and
   old-erasure gates still apply. A rollback interval must remain quiesced; retain
   0011 and return to corrected P2, reconcile, verify, then reopen. Do not delete
   populated metadata or use P1 to process new pile commands. Unknown/unquiesced
   intervals require explicit investigation, not an assertion of reconciliation.

P2 account deletion erases mappings/suppressions after deleting piles (whose
trigger suppresses mappings), then existing receipts/tombstones and finally
workspace revision. Sync/provenance metadata lives on source/member rows and is
erased with them. The reconciliation generator now audits/removes six tables,
including `collection_mappings`, preserving verified-owner evidence, live/raw/mapped
account guards, unclaimed owners and durable byte queues. Validate the generated
plan against a 0011 schema; use the previous release tool for a 0009/0010-only
schema. Local synthetic tests do not replace a separately authorized remote query
API rehearsal or production release. No such action is authorized by this code.
