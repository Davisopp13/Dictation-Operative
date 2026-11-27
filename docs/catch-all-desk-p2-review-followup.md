# P2 independent-review follow-up

November 27, 2026 (America/New_York). **B1 fixed and locally validated; the changed
candidate awaits independent rereview. Not pushed, integrated or released.**
This supersedes the original P2 handoff's capacity behavior and pre-review status.

## Exact target and review receipt

- Worktree: `/Users/davis/.codex/worktrees/catch-all-desk-p2/Dictation Operative`.
- Branch: `codex/catch-all-desk-p2`.
- Integrated P1 base: `ae0446da6b278b3b6a9ba23cd6be27798c2e7c2e`.
- Independently reviewed P2 head: `b655b48bdb678edace7025f8e22699518316976e`;
  implementation `0e6bcac994128ef7f1a50e2534f520a971037ebb`.
- Reviewed full patch SHA-256:
  `831a87bf7623791395868956eb195095502b417133653e73551a85911f45ccb1`.
  Branch, clean tree and patch hash were verified before editing.
- Follow-up implementation: `2a6ddddc99e98d47f4d2cee2bc92d6759dd11488`.
  The subsequent commit only records this handoff and a superseding link.
- Final HEAD and clean state, exact incremental/cumulative patches and SHA-256
  hashes are in the external `p2-review-followup/review-manifest.json`, beside
  this worktree. `OPUS-REREVIEW-PROMPT.txt` there pins the final target without
  embedding a self-referential commit ID in this document.

The supplied review is preserved verbatim at
`/Users/davis/.codex/worktrees/catch-all-desk-p2/p2-review-followup/claude-review.txt`.
It reports one blocker, B1: after 500 retained slots or 100 empty mapped piles,
ordinary collection source writes fail and sequential backup restore stops at the
first affected row. The reviewer read the prior 183-test evidence and ran SQLite
simulations, but did not rerun the suite or built checks. This follow-up's fresh
D1/Worker validation is implementation evidence, not independent approval.
The earlier P1 review attachment is a separate historical receipt.

## Fix and contract

Additive migration `0012_collection_capacity_pending.sql` replaces only the source
insert/update reconciliation triggers. On insufficient pile or member capacity,
the source commits with its requested collection and `collection_synced=0`.
Old collection provenance is removed in the same transaction, retaining manual
membership, inactive slots, position and historical receipts. No slot compaction
or automatic eviction was added: the original request explicitly forbids it.
The review's suggested slot deletion was therefore not adopted.

Existing progress reads count these sources as capacity-blocked; the existing
owner/source cleanup predicate holds them until reconciled or deliberately changed.
Normal source success responses, import IDs, backup format, content/history and
whole-file retry semantics are unchanged. The existing UI restore loop can reach
all later rows, including unfiled rows. Unexpected SQL failure still rolls back
source and provenance together; stale saves and duplicate creates remain safe.
Existing-slot reactivation fits even at 500 retained slots, and suppressed keys
retain their existing non-resurrection policy.

Actual capacity recovery is documented accurately: source deletion frees its slots;
pile deletion frees pile count and permanently suppresses its mapped key. Clearing
or reassigning a collection does not free its old slots or remove an empty pile.
Sources still save while blocked. A hold may last indefinitely; no false completion
or silent cleanup exposure is introduced.

Current contract: [collection mapping](../pwa/docs/collection-mapping.md).
Navigation and editor presentation are unchanged. P3 can rely on successful source
capture/import at capacity and explicit blocked progress, without assuming that
successful source save means committed collection membership.

## Optional findings

| Finding | Disposition |
| --- | --- |
| O1, source CAS wording | Corrected: clearing a collection or pinning checks source revision; manual-only Remove relies on pile revision. |
| O2, tag-only historical rekey | Fixed in `changeClip`: an exactly unchanged incoming collection retains its historical string, including whitespace and overlength values. Changed input keeps existing trimming/validation. Both legacy/v1 routes tested before and after backfill. |
| O3, pending partial index | Deferred performance improvement. Existing owner/sync/ID index remains; empty historical rows can increase scan work. No claim of large-account performance validation. |
| O4, suppressed pending retention | Explicitly documented as potentially indefinite; no unsuppress endpoint or retention-policy change. |
| O5, unusual-key Undo | Added Remove-and-pin/Undo round trips with NUL and decomposed Unicode/emoji exact keys. Pin, field and provenance survive. |

## Migration, erasure and rollback

Migrations 0000–0011 remain byte-identical to the reviewed candidate. The 0012
Drizzle snapshot links to 0011 and has identical schema content apart from snapshot
IDs; only triggers change. Applying 0012 to populated 0011 is tested to leave all
sources, piles, mappings, slots, receipts and revisions byte-equivalent.
Fresh built checks apply the full migration chain through 0012.

Retain the existing maintenance gates: quiesce and drain workspace/account writes
and scheduled cleanup, capture verified owner evidence, apply prerequisites then
0011 and 0012, deploy corrected P2, reconcile any old-Worker erasure window and
verify before reopening. No mapping runs in migration/startup/ordinary reads.
0012 adds no table; the guarded six-table P2 erasure plan remains applicable.
An older Worker can leave pending rows; old cleanup and erasure are still unsafe.
Do not use P1 as a live-write rollback after mapping population. Keep the schema
and remain quiesced until corrected P2 and required reconciliation are restored.
A remote query-API rehearsal of the P2 erasure plan is still a separately authorized
task. Neither prior F2 rehearsal nor these local tests establishes that gate.

## Validation

All commands ran from the P2 `pwa` directory with synthetic isolated local D1/R2.
Build completed before any built check. No dependencies or CI steps changed.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 190 passed, 0 failed, 0 skipped |
| `npm run build` | Passed |
| `npm run test:built-auth` | Passed, including real PKCE bearer save at 100-pile capacity |
| `npm run test:built-clipboard` | Passed |
| `npm run test:built-content` | Passed |
| `npm run test:built-shared-items` | Passed, including sequential restore crossing 500 slots, retry, pending capture and real scheduler |

The focused collection suite has 24 passing tests. New cases cover populated
0011 upgrade, both exact B1 exhaustion scenarios, restores continuing after a
blocked row, whole-file retries without workspace mutation, full body/history
round trips, pending cleanup holds, real SQL failure rollback, retained manual
provenance, later assignments/clears, source-delete recovery, exact tag-only keys
and unusual-key Undo. Existing concurrency, owner isolation, erasure and other
P2/P1/F2 tests continue to pass. The shared-items CI step is unchanged and runs the
extended script. No remote CI, device, installed-PWA, native-app hardware or
physical print acceptance is claimed.

Evidence directory:
`/Users/davis/.codex/worktrees/catch-all-desk-p2/p2-review-followup/`.
- `validation/results.json` and eight command logs: timestamps, commands and exits.
- `focused-first.log`, `focused-b1.log`, `focused-final.log`: focused iterations.
- `migration-verification.json`: prior migrations, snapshot and CI checks.
- `preservation-before.json`, `preservation-verification.json`: other worktree checks.
- `reviewed-*`: frozen original review artifacts; original root artifacts retained.
- `review-manifest.json`, `p2-review-fix.diff`, `p2-cumulative-review.diff`,
  `OPUS-REREVIEW-PROMPT.txt`: exact final independent-review package.

## Instructions read and preservation

The original handoff lists instructions and canonical planning docs actually read
for P2, including the global/kit AGENTS files, PROJECTS, SKILL-CATALOG,
DAILY-PROMPTS, canonical roadmap/spec and Workers best-practices skill/runtime
reference. For this follow-up, reread the latest project checkpoint and workflow
catalog, the supplied P2 review, relevant runtime/test/docs paths, and original
request constraints. No new skill, agent or chat was launched.

The P2 worktree started clean at the reviewed head and ends clean at the manifest
head. Other worktree heads/statuses and initial dirty/untracked file hashes are
verified in preservation evidence. The original checkout remains on
`codex/web-print-pdf-preview` at `e4cc4141364f1524c42b8d2327a084254b2a2238`;
only its authorized canonical roadmap P2 row changes. The workflow-kit project
checkpoint is updated in place. Phone-print-fix remains
`59c6bbd64086bbc229cf33d7fe206bd3baa54d96`; release work remains
`b22738914ce0161aa0e5f92f1963b15ac00e972f`.

Next: independent Claude Opus 5.5 rereview of the exact follow-up and cumulative
patches. Resolve any remaining blockers before integration consideration. No push,
PR, merge, remote migration, production mapping/backfill, deployment or printing
was performed. Implemented and locally validated is separate from reviewed,
integrated and released.
