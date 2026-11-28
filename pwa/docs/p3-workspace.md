# P3 workspace and additive API contract

Local implementation on integrated P2 `2ddbb672ab15f19f51e0729bd0824ce7132b32cc`.
P3 adds browser Desk/Piles, capture, pending-collection guidance and general HTTPS
bookmarks. It requires the existing 0000–0012 schema; no migration is added or
rewritten. Deployment, remote migrations and production backfill are not part of
this implementation. P1/P2 provenance, capacity, cleanup, erasure and replay rules
remain authoritative.

## Organization is independent of protection

Shared list/detail items and new membership receipts add:

```json
{
  "organization": {"state":"member_capacity", "pending":true},
  "workspaceRevision":123
}
```

`organization.state` derives from committed sources, exact collection mappings,
collection provenance and `collection_backfill_pending`:

| State | Meaning | pending |
| --- | --- | --- |
| `none` | No collection, or a non-text source | false |
| `mapped` | Committed active collection provenance exists | false |
| `ready` | Pending, currently able to reconcile | true |
| `pile_capacity` | Pending, no mapping and 100 extant piles | true |
| `member_capacity` | Pending, mapped pile has 500 retained slots and no slot for this source | true |
| `suppressed` | Pending under a permanently suppressed exact key | true |
| `suppressed_settled` | A deliberate source write settled under a suppressed key | false |
| `unknown` | Missing/older projection or an inconsistent committed state | null for old receipts; current source marker otherwise |

Pins and manual piles can take precedence in `cleanup.reason`; they do not hide
organization status. Old receipts have unknown status and a null workspace
revision. New receipts preserve their commit-time projection on exact replay;
refresh item detail before making claims about current state. Raw owner and
private object keys are not included.

P3 keeps the legacy Collection control beside pile chips. Both text PATCH surfaces
accept additive `keepPinned:boolean` on `organize` and optional
`workspaceRevision` (nonnegative safe integer). `keepPinned:true` sets the pin in
the same source UPDATE as the collection change; false never unpins. A supplied
workspace revision is checked in that UPDATE along with the existing source CAS.
A stale guard returns 409 without changing the source. Exact unchanged historical
keys, including tag-only changes, retain P2 behavior. The UI warns conservatively
that changing a nonempty Collection can remove a hold/mapped membership and
refreshes the authoritative organization result after persistence succeeds.

## Bounded pile reads and removal impact

- `GET /api/v1/piles/:id/items?limit=3` resolves ordered active ready sources in
  one D1 batch, returning `{pile,items,revision}`. Omitted limit is 500 (the complete
  bounded member set); permitted limits are 1–500. `pile` contains id/name/color/
  revision/updatedAt. Top-level revision is the workspace snapshot. Other filters
  are rejected. Covers load at intersection, request at most three previews and
  reject a mismatched pile revision. Pile finding uses the complete member set;
  searchable fields are name, first 500 text characters, filename and host.
- `GET /api/v1/piles/:id/members/:kind/:id/impact` returns pile `revision`,
  `workspaceRevision`, `clearsCollection`, and projected `after` protection. It
  removes only that pile from effective protection and accounts for clearing a
  mapped Collection/hold. It does not mutate anything or claim a completed remove.
- Membership POST accepts optional `workspaceRevision`. The first transactional
  claim checks it before any source/provenance/pin write. It participates in new
  fingerprints only when supplied, preserving old receipt fingerprints. The UI
  sends both impact revisions and requires fresh confirmation after conflict.
- Pile deletion impact adds `mappedCollection:boolean` for the suppression warning.
  Existing workspace-bound tokens and pin/expose behavior are unchanged. There is
  no pile-deletion Undo. Member Undo remains receipt-backed and never unpins.

## Bookmarks

Both `/api/content` and `/api/v1/documents` accept general HTTPS links, maximum
2,048 input characters, without embedded credentials. Required titles retain the
120-character validator. Google Docs/Sheets labels require parsed `docs.google.com`
with the matching `/document/d/<id>` or `/spreadsheets/d/<id>` path and default port.
Other links have `displayKind:link` / provider `Link` and show their parsed host.

Content responses add `revision`. PATCH of a ready link may set `name` and/or
`url`, but must supply the current revision; stale edits return 409. URL edits
repeat the create validator. Pin-only PATCH retains its prior compatibility and
needs no revision. Updated responses account for the AFTER-trigger revision bump.
No new storage, quota exemption or byte copying is introduced. No server or
browser metadata, favicon, screenshot, iframe or destination preview request runs;
only explicit Open follows the HTTPS link with `noopener noreferrer`.

## Browser behavior and boundaries

Desk is the browser-local default when no valid stored choice exists. A once-per-
account/device notice offers Change; explicit legacy Clipboard/Documents choices
remain valid. History stores page/pile identity, not source contents. Account-keyed
providers reset selections, retries, notifications and pending reads on remount.

Desk reads preserve server sortTime order and paginate 40 at a time. A stale cursor
restarts the listing and clears selection. It has no unified search. Existing
Clipboard/Documents filters remain. Selection preserves choice order; new-pile
creation is atomic with at most 50 references, never truncated. Membership writes
are serialized, retain exact uncertain requests and exclude confirmed steps from
retry. Conflicts stop for a new user confirmation. No bulk deletion is offered.

The progress dialog does GETs on open/refresh and at most **one POST of 25** per
explicit Continue. No background migration loop or status timer exists. It refreshes
server counts after a batch, disables Continue at ready=0 and explains indefinite
holds, retained slots, empty mapped piles and permanent suppression. Counts are
not a percentage/ETA. A committed request cannot be undone by closing the dialog.

Capture saves a source first, then adds a ready reference. Failed membership offers
Add again for that source only. File/link retry identifiers are retained in the
capture form. Page text paste is staged and requires Save. Scanner and PDF/print
components are reused; no independent phone-print branch is included. Oversized
Clipboard images offer an explicit original-as-Document choice or Cancel.

Deferred: slot compaction, receipt pruning, unsuppression, capacity increases,
optional P2 partial index/defensive 409 cleanup, S1 unified search, tray, offline,
Trash and bulk deletion. Physical devices, real camera/printing and assistive
technology require separate acceptance; viewport/keyboard emulation is not that
acceptance.
