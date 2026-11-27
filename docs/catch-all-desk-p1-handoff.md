# P1 mixed-content pile management handoff

November 27, 2026 · Local implementation complete; independent review pending.
Implemented and tested locally. Not independently reviewed, integrated or released.

## Exact source and working state

- Worktree: `/Users/davis/.codex/worktrees/catch-all-desk-p1/Dictation Operative`
- Branch: `codex/catch-all-desk-p1`
- Exact fetched base: `f812cd090fc5ff11f849cb47938329ef20b13912`.
  `origin/main` had not advanced beyond the supplied integrated F2 commit.
- Exact implementation head: `9def3ade04622a0fea48d10a5dc001de3387f2a0`.
  This includes all runtime, migration, test, CI and contract-document changes.
- This handoff is a subsequent documentation-only commit. Its final branch HEAD,
  full base-to-HEAD patch hash and review target are recorded in
  `/Users/davis/.codex/worktrees/catch-all-desk-p1/review-manifest.json` and the
  final chat handoff, avoiding a self-referential commit ID in this file.
- No P1 worktree existed. Created this clean root-Git worktree directly from the
  exact base; no nested PWA checkout was used. Initial worktree HEAD was the base,
  with no changes. Original checkout stayed on `codex/web-print-pdf-preview` at
  `e4cc4141364f1524c42b8d2327a084254b2a2238` with its existing dirty/untracked work.
- Original initial porcelain state and SHA-256 hashes of 35 dirty/untracked files
  are in `../initial-state.json` (relative to the worktree root). All 35 were
  unchanged before the explicitly requested canonical roadmap status update.
  That single planning-document edit is the only change made in the original
  checkout; no competing roadmap copy was created here. The original branch,
  application files and other planning/design inputs were preserved.
- No other worktree was changed. The unfinished phone-print-fix candidate was
  neither cherry-picked nor made a prerequisite. No push, PR, merge, deployment,
  remote migration, production activation, hardware print, agent or chat launch.

## Instructions and sources actually read

User-supplied global AGENTS instructions and the complete attached P1 request;
`/Users/davis/.codex/AGENTS.md`; `/Users/davis/ai-workflow-kit/AGENTS.md`;
workflow-kit `PROJECTS.md` (personal project row/data boundary), `SKILL-CATALOG.md`,
and `prompts/DAILY-PROMPTS.md` (implementation and handoff workflows).
No repository AGENTS.md was found in the original or integrated tree.

Read the original checkout's untracked `docs/catch-all-desk-product-roadmap.md`
and `docs/catch-all-desk-interaction-spec.md`, especially §6 and §14–16, in place.
Read the integrated F2 handoff, `pwa/docs/shared-items.md`, `pwa/docs/api-v1.md`,
account-erasure reconciliation runbook, schema, migration 0009, source/membership
implementation, cleanup, account deletion and relevant tests/build scripts.
Used the Workers best-practices skill plus its runtime-patterns reference and the
Wrangler skill; retrieved Cloudflare's D1 batch and limits documentation.
This was the ordinary Implement workflow, with no `/goal` or delegated agents.

## Delivered contracts and decisions

The authoritative request/response and concurrency specification is
[pwa/docs/piles.md](../pwa/docs/piles.md). The API and shared-item docs link it.

- Owner-scoped `GET /api/v1/piles` and `GET /api/v1/piles/:id` return identity,
  normalized name/color, pile revision, timestamps and active member count.
  List uses `(updated_at DESC,id DESC)` keyset pagination, 1–100/default 50,
  owner/workspace-bound cursors and transactional rows/count/revision reads.
  Membership reads add the same creation timestamp and count fields.
- Retry-safe `POST /piles` creates a server-generated pile ID, optionally with
  up to 50 ordered typed references in a 12,000-byte request. The 100-pile account
  limit is checked inside the insert transaction. F2 source triggers validate
  every row; failure rolls back pile, selection, receipt and invalidation.
  Google Docs/Sheets shortcuts work as ready document references. Typed identity
  permits overlapping IDs across the three kinds; array-shaped kinds are rejected.
- `PATCH /piles/:id` renames/changes color under the pile revision. No-op edits
  preserve timestamps/revisions and cause no invalidation. Name length is 1–60
  Unicode code points after trimming; NUL is rejected, duplicate names allowed.
- F2 add/remove/removeAndPin/move/restore, manual order, source deletion and
  cleanup are reused. No slot compaction, Undo expiry, source copy or quota change.
  Source bodies, histories, backups, collections, upload recovery and byte queues
  retain their existing behavior. Navigation and start page were not changed.
- `GET /piles/:id/deletion-impact` computes active member count and newly exposed
  sources, names, age thresholds and next scheduled cleanup times. Pinned sources,
  other piles, documents, legacy/history exemptions and cleanup-off are respected.
- `DELETE /piles/:id` requires a pile revision, preview token and explicit `pin`
  or `expose` mode. `pin` is the safe UI default; `expose` also requires
  `acknowledgeExposure:true`. Both modes preserve every source and other pile.
  Pinning, receipt and reference cascade share one transaction.
- Confirmation is bound to the **whole workspace revision**, rechecked during
  the deletion transaction. Changes to pins, other piles, source state or cleanup
  settings return `impact_stale`; even unrelated workspace changes may conservatively
  require reconfirmation. P3 must not automatically refresh the token and delete.
- All mutations share F2's account-wide operation namespace. Successful receipts
  are historical: duplicates return the original result and never reapply over
  newer work. Create replay after deletion never recreates the pile; delete replay
  never repins a subsequently unpinned source. Changed commands sharing an ID get
  `operation_conflict`. **Pile deletion has no Undo; membership removal still does.**
- Creation passes the verified application account internally through the existing
  session/bearer service path. Its insert checks that account-to-owner mapping
  still exists, preventing in-flight creation from resurrecting pile metadata after
  erasure. Legacy Access/local owners remain supported. No provider work was added.

## Migration, retention and compatibility

Only new migration is `0010_pile_created_at.sql`, one nullable column on `piles`,
with generated Drizzle snapshot/journal. It is necessary to retain creation time
independently from later updates. Pre-P1 creation times are unknown and remain
`null`; no speculative backfill. Snapshot comparison confirmed no other schema
change. Deployed 0009 is byte-identical to the base. Apply 0010 before this Worker.

P1 adds no metadata tables. Lifecycle receipts use `pile_operations`, remain after
pile deletion and last for the account lifetime. They retain pile metadata and
references/results, not source bodies/files. No silent pruning, expiry or capacity
relaxation. The 500-slot bound includes inactive Undo slots; account pile count can
be freed by deleting a pile, but receipt history remains until account erasure.

F2's account erasure and existing reconciliation table list already cover the
new timestamp and receipts. Tests now create actual P1 create/update/delete
receipts for raw/mapped accounts and verify total removal, including workspace
revision and bytes/queues. The in-flight create guard adds protection for this
new operation. F2 can run on the additive schema and erase P1 metadata. Pre-F2
rollback still requires its existing verified-owner census, maintenance and
reconciliation safeguards. Keep pile-aware cleanup once references exist; never
roll back to the unsafe older scheduler or drop populated references. No prior
release gate was relaxed, and no remote command was run.

## Validation

Synthetic isolated local D1/R2 only. Node v24.13.0, npm 11.6.2; pinned Wrangler
4.92.0 / Miniflare 4.20260515.0 and compatibility date 2026-05-22 preserved.

| Command/check | Result |
| --- | --- |
| `npm ci` | Passed with unchanged lockfile; npm reported existing dependency audit advisories (no dependency upgrade in P1) |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | **166 passed**, zero failed/skipped |
| `npm run build` | Passed; existing bundle-size / vinext route-classification notices |
| `npm run test:built-auth` | Passed, now includes real PKCE bearer pile create/read/impact/delete |
| `npm run test:built-clipboard` | Passed |
| `npm run test:built-content` | Passed |
| `npm run test:built-shared-items` | Passed; previous creation-404 assertion replaced with real P1 lifecycle coverage |
| Web CI | Added `test:built-shared-items`; local checks run, no remote CI run requested |
| `git diff --check` / snapshot delta / original-file preservation | Passed |

Logs and built-check exit codes are beside the worktree. One premature final
built-check attempt ran while the rebuild was still producing `dist/server/index.js`
and failed with ENOENT; its logs are retained in `../premature-built-run/`. After
build completion all four checks were rerun and passed. Initial lint findings
were corrected before the final green runs. No unresolved test failure.

New coverage includes all kinds/overlapping IDs; cross-owner denials; ready-only
and foreign/missing selection rollback; 50-reference bound; duplicate, historical
and concurrent retries; operation collisions; stale/no-op edits; 100-pile races;
F2 move/remove/Undo across metadata edits; inactive-slot capacity; stale impact
from pins/other piles/settings; explicit exposure acknowledgment; malformed mode
rejection; safe pin deletion and source/byte/quota preservation; cleanup races;
forced transaction-time protection/source changes; 500-member safe deletion;
forced receipt-write failure rolling back all pins/deletion; exact deletion retry
committing between receipt and impact reads; migration preservation and account
erasure, including a create authenticated before erasure.

No UI was implemented, so no browser/device acceptance is claimed. No physical
phone, installed PWA, camera, printer or native-app check was run. Printing release
follow-up and its existing gates remain separate.

## What follows

P2 can rely on stable owner-scoped piles, typed references, revisions and receipts.
It must still implement collection provenance/backfill/coexistence and specify how
its mapping handles the 100-pile/500-slot bounds. Legacy collections are unchanged.
P3 can rely on all lifecycle and membership endpoints, colors/counts/timestamps,
manual order and the explicit impact/reconfirmation contract. P3 owns actual
screens, general bookmarks, selection UI and navigation/start-page work.

Remaining P1 step: independent Claude Opus 5.5 review of the exact diff, then fixes
if needed. Integration, release/migration execution and product activation require
separate authorization. This handoff does not authorize any of them.

## Independent review prompt — Claude Opus 5.5

```text
Independently review P1 mixed-content pile management. Read-only; do not modify,
commit, push, open a PR, merge, deploy, run remote migrations, print, or launch agents.

Worktree: /Users/davis/.codex/worktrees/catch-all-desk-p1/Dictation Operative
Branch: codex/catch-all-desk-p1
Exact base: f812cd090fc5ff11f849cb47938329ef20b13912
Exact implementation head: 9def3ade04622a0fea48d10a5dc001de3387f2a0
Review: git diff f812cd090fc5ff11f849cb47938329ef20b13912 9def3ade04622a0fea48d10a5dc001de3387f2a0
The subsequent commit adds only this handoff. The external review-manifest.json
beside the worktree also records final HEAD and the full base-to-HEAD patch.

Read applicable AGENTS instructions, this handoff, pwa/docs/piles.md,
pwa/docs/shared-items.md, pwa/docs/api-v1.md, migration 0009/0010, account-erasure
runbook and the actual diff plus surrounding code. Original planning inputs remain
at /Users/davis/Dictation Operative/docs/catch-all-desk-product-roadmap.md and
catch-all-desk-interaction-spec.md. The attached request is at
/Users/davis/.codex/attachments/9c2710d0-0ed9-4896-a4e1-34f16cef4f66/Pasted text.txt.
All paths are on Davis's Mac; do not assume another host can access them.

Check owner isolation and absence of existence leaks; browser/native auth/Origin;
atomic initial selections and concurrent 100-pile enforcement; 500 retained slots;
manual order/Undo compatibility; no-op revisions; operation namespace, concurrent
exact retries and historical replay after later changes/deletion; deletion-impact
consistency across pins/other piles/settings and the transaction-time recheck;
mandatory exposure acknowledgment; atomic safe pinning with no cleanup gap;
source bytes/quotas/history preservation; account erasure including in-flight
creation and mapped owners; 0010 upgrade preservation and unchanged 0009; rollback
constraints; bounded SQL/requests on the pinned runtime; and meaningful test coverage.

Pile deletion intentionally has NO Undo. Individual membership removal keeps F2
Undo. No tray, collection mapping, P3 UI/general bookmarks or printing changes are
in scope. Whole-workspace confirmation invalidation is deliberately conservative.

Evidence: typecheck, lint, 166 tests, build and all four built Worker checks pass
using isolated synthetic D1/R2. Logs are beside the worktree. No production or
physical-device result is claimed. No independent review has happened yet.
Report concrete blocking correctness/security/data-integrity findings with file
and line references and a plausible failure scenario separately from optional
improvements. Identify missing evidence, review the exact revision, and return
findings to the implementer. Do not change or integrate the work.
```
