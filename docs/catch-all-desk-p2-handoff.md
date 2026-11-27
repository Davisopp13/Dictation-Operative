# P2 collection mapping and backfill handoff

November 27, 2026 (America/New_York). **Implemented and locally validated.
Not independently reviewed, integrated or released.**

## Exact target and authority

- Worktree: `/Users/davis/.codex/worktrees/catch-all-desk-p2/Dictation Operative`.
- Branch: `codex/catch-all-desk-p2`.
- Exact fetched base: `ae0446da6b278b3b6a9ba23cd6be27798c2e7c2e`.
  `origin/main` was exactly the supplied integrated P1 merge; no additional
  changes needed inspection or incorporation.
- Implementation commit: `0e6bcac994128ef7f1a50e2534f520a971037ebb`.
  Includes runtime, migration, tests and contract/runbook documentation.
- This final documentation commit updates this handoff. Final HEAD, full base-to-HEAD
  patch hash and clean final state are recorded in
  `/Users/davis/.codex/worktrees/catch-all-desk-p2/review-manifest.json`.
  This avoids a self-referential commit ID. The exact full review patch is
  `../p2-review.diff`, and the final-HEAD prompt is `../OPUS-REVIEW-PROMPT.txt`.
- No P2 branch/worktree existed. Created this isolated root-Git worktree from
  the verified base, initially clean. No nested PWA checkout was used.
- Original checkout remains `codex/web-print-pdf-preview` at
  `e4cc4141364f1524c42b8d2327a084254b2a2238`, with its pre-existing edits/untracked
  work. Its application/design files were not edited. Only the requested P2 row
  in the existing canonical roadmap is updated at handoff; no roadmap copy exists
  here. The workflow-kit project checkpoint is updated separately.
- Seven pre-existing worktree HEADs/statuses and all 35 initial dirty/untracked
  file hashes were verified unchanged before the roadmap update. Evidence:
  `../preservation-before.json`, `../preservation-before-checkpoint.json` and
  final `../preservation-verification.json`. The last file allows only the
  specifically authorized original roadmap edit.
- Phone-print-fix remains `59c6bbd64086bbc229cf33d7fe206bd3baa54d96`; release work
  remains `b22738914ce0161aa0e5f92f1963b15ac00e972f`. Neither was changed,
  cherry-picked, deleted or made a P2 prerequisite.
- No push, PR, merge, remote migration, deployment, production data/activation,
  physical print job, agents or new chats. All D1/R2 fixtures were synthetic/local.

## Instructions and context actually read

User-supplied global AGENTS instructions and the complete pasted P2 request at
`/Users/davis/.codex/attachments/3028116e-fac6-4452-a45f-d998563b6585/Pasted text.txt`;
`/Users/davis/.codex/AGENTS.md`; `/Users/davis/ai-workflow-kit/AGENTS.md`;
workflow-kit `PROJECTS.md` (personal boundary/project checkpoint), `SKILL-CATALOG.md`,
and `prompts/DAILY-PROMPTS.md` (implementation, review and handoff guidance).
No repository AGENTS.md was found in the original or integrated checkout.

Read the original untracked roadmap and interaction spec in place, including
§6 and §14–16; integrated shared-items, piles, api-v1 and account-erasure
reconciliation docs; F2/P1 handoffs; schema and 0009/0010; text/domain/repository/
backup paths; membership, lifecycle, cleanup and account-erasure implementation;
relevant tests, actual package commands and shared-items CI step. Read the current
P1 `p1-integration/integration-report.md` and `p1-review-followup/handoff.md` receipts
beside the P1 worktree: P1 was reviewed without blockers and integrated as PR #14,
not released. Historical committed P1 wording was not rewritten. O1–O6 deferred.

Applied Workers best-practices skill at
`/Users/davis/.codex/skills/workers-best-practices/SKILL.md`, including its
`references/runtime-patterns.md`. Retrieved official Cloudflare D1 batch,
transaction and limit documentation. Ordinary Implement workflow; no goal or
agent delegation was started.

## Delivered behavior and material decisions

The authoritative contract and full mutation inventory are in
[pwa/docs/collection-mapping.md](../pwa/docs/collection-mapping.md).

- Exact owner/key mapping, unique stable pile identity, no matching-name reuse.
  Keys are not normalized/truncated. Printable ASCII display names are trimmed/
  capped at 60; other historical keys get a valid deterministic UTF-8 hex label.
  Display collisions are legal. Rename/color leave the exact key unchanged.
- Existing membership surface now represents manual OR collection provenance.
  Nullable manual inherits the pre-P2 active flag until changed, avoiding an
  all-account migration rewrite. Inactive slots, order and receipts survive.
  Manual add on an already collection-derived active reference is a real semantic
  write; repeating it is a no-op. Provenance-only changes invalidate revisions.
- Source insert/import and deliberate collection assignment reconcile through
  SQL triggers in their successful source transaction. A→B/clear removes only
  collection provenance; manual membership survives. Rejected/stale/duplicate
  source requests leave no mapping/provenance changes. Existing payloads,
  history, backups, collection/tag filters and retry behavior are preserved.
  Only an actual collection value change activates an existing unsynced source;
  unchanged collection values in legacy tag-only organize saves retain the hold.
  This distinction was caught in the final safety pass and regression-tested.
- `GET /api/v1/collection-backfill` inspects; `POST` with `{limit:25}` advances
  1–50 current rows in one transaction. It repeatedly chooses the first currently
  processable pending ID. No saved cursor or stale assignment exists. Current
  counts distinguish ready, pile capacity, member capacity and suppression.
  Complete means no pending rows at that transaction snapshot. Retrying advances
  remaining work, not a historical progress receipt. Empty repeats write nothing.
- Mapping respects 100 piles and 500 slots including inactive slots. New source
  assignments that cannot fit fail atomically with 409 `collection_capacity`.
  Backfill commits useful bounded work and explicitly reports blocked rows;
  no eviction, compaction, limit increase or key splitting. Free capacity and
  resume, or deliberately reorganize the affected source collection.
- Explicit membership removal clears both provenances and clears the current
  matching legacy collection under source/pile CAS, with a text revision bump.
  Remove and pin stays atomic. Undo restores prior provenance/collection/order
  only if its post-removal source revision is still current when collection
  restoration is needed. Newer edits refuse Undo. Pins never silently revert.
  Old manual-only Undo and exact historical receipts remain supported.
- Deleting a mapped pile permanently suppresses that exact key for the account
  lifetime. Source collections remain intact. Neither backfill, unrelated edits,
  old replay nor later same-key assignments recreate it. A manual pile or a
  different exact collection key provides deliberate later organization.
  No unsuppress endpoint or pile-deletion Undo is introduced.
- Unprocessed nonempty collection rows have an explicit `collection_pending`
  cleanup hold before/during backfill, including capacity-blocked and suppressed
  pending rows. Reads/receipts/impact reflect it. Successful mapping replaces it
  with real membership atomically. Unrelated edits preserve it. Ordinary unfiled
  cleanup keeps the existing opt-in, age/history and transactional recheck.
- P1 deletion confirmation still binds the whole workspace. Previously mapped
  members use safe pinning or explicitly acknowledged exposure. Pending sources
  retain their hold after mapped-pile deletion; no unbounded source rewrite/pin
  is needed. A 502-text test confirms 500 safe pins plus two remaining holds.
- Source creation/import and backfill recheck application account→owner identity
  at the write transaction, preventing late operations after account erasure.
  Mapping/suppression erasure and the guarded six-table reconciliation plan are
  tested for direct/mapped owners, interruption/retry, live and unclaimed owners.

## Migration, retention and older Workers

Apply **0011 before P2 code**, after prerequisites. 0009/0010 are byte-identical
to the base. Drizzle reports no schema drift. The new table, two membership columns,
source sync marker, index, view and triggers are additive. No automatic source
backfill occurs in migration, startup or reads. No quotas/byte queues are changed.

Quiesce workspace/account writes and cleanup, drain in-flight work, and capture
verified owner evidence before the migration/code window. Deploy P2, reconcile
any old-Worker account erasures, verify, then reopen. New source/import/assignment
compatibility activates with P2 writes; historical backfill needs explicit POSTs.
The old scheduler cannot protect pending collection rows. P1 account deletion
cannot erase the new mapping/suppression table. P1 membership writes cannot maintain
populated provenance. **Do not roll back a populated P2 to live P1 writes**; keep
any rollback interval quiesced, retain additive data, return to corrected P2 and
reconcile before reopening. Source-schema compatibility is not operational safety.

Older clients using P2 get full compatibility. Older Worker SQL on already synced
texts still triggers transactional collection reconciliation, but unsynced writes
remain pending and capacity errors may surface as generic 500. That partial
compatibility does not authorize an old serving fleet or old account erasure.
The updated reconciliation generator targets schema 0011 and six tables; use the
previous tool on a 0009/0010-only schema. Verified owner/live-account guards remain.
Suppression and receipts last until account erasure; no retention pruning is added.
A future remote rehearsal remains separately authorized and was not performed.

## Validation and evidence

All required commands passed on synthetic isolated Miniflare D1/R2. Build finished
before the built checks. All eight commands were rerun after the final tag-only
organization safety fix. No source/runtime/test changes followed that validation;
only handoff and external checkpoint/review artifacts were updated.

| Check | Result |
| --- | --- |
| `npm ci` | Passed; lockfile/dependencies unchanged; existing audit advisories reported |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | **183 passed**, zero failed/skipped |
| `npm run build` | Passed; existing bundle/route-classification notices |
| `npm run test:built-auth` | Passed, including real native PKCE bearer backfill |
| `npm run test:built-clipboard` | Passed |
| `npm run test:built-content` | Passed |
| `npm run test:built-shared-items` | Passed, including session backfill/provenance/Undo/suppression/erasure |
| `npm run db:generate -- --name verify_p2_schema` | No schema changes |
| Base migration/lockfile/CI comparison and `git diff --check` | Passed |

Exact command timestamps, exit codes and full logs:
`/Users/davis/.codex/worktrees/catch-all-desk-p2/validation/results.json` and sibling
logs. Earlier focused/full logs are retained beside the worktree; early fixture
column-list and volatile D1 timing-comparison failures were corrected. No unresolved
failure. Existing shared-items CI step is unchanged and now runs extended coverage.
No remote CI or independent review ran. Automated Worker checks are not physical
phone/PWA/printer acceptance. Production and the separate printing release remain
unchanged.

## P3 and remaining work

P3 can rely on stable mapped piles, union membership, ordered slots, source-aware
Remove/Undo, honest migration status, explicit pending retention and existing P1
confirmation/replay semantics. It must render `collection_pending` without calling
it a committed pile, preserve blocked/incomplete status, and explain permanent
mapped-key suppression before exposing pile deletion. The Collection editor and
navigation are intentionally unchanged. No new mapping UI is delivered here.

Next: independent Claude Opus 5.5 review of the exact diff, then address blocking
findings. Integration/release/remote rehearsal/activation require separate authority.
Capacity-blocked datasets and permanent suppression are documented product limits,
not skipped success. P1 optional findings and printing/device acceptance remain
separate; no completion claim is made for them.

## Independent review prompt — Claude Opus 5.5, high effort

```text
Independently review P2 collection mapping and backfill. Read-only: do not edit,
commit, push, open a PR, merge, deploy, run remote migrations, touch production,
print, or launch agents/chats.

Worktree: /Users/davis/.codex/worktrees/catch-all-desk-p2/Dictation Operative
Branch: codex/catch-all-desk-p2
Exact base: ae0446da6b278b3b6a9ba23cd6be27798c2e7c2e
Exact implementation: 0e6bcac994128ef7f1a50e2534f520a971037ebb
Implementation diff: git diff ae0446da6b278b3b6a9ba23cd6be27798c2e7c2e 0e6bcac994128ef7f1a50e2534f520a971037ebb
The final documentation commit only updates this handoff. Verify final HEAD and full patch
SHA-256 against ../review-manifest.json, then review the full ../p2-review.diff.
../OPUS-REVIEW-PROMPT.txt repeats this prompt with the final full exact target.
All paths are local to Davis's Mac; do not assume access from another host.

Read applicable AGENTS, this handoff, the complete P2 request at
/Users/davis/.codex/attachments/3028116e-fac6-4452-a45f-d998563b6585/Pasted text.txt,
pwa/docs/collection-mapping.md, shared-items.md, piles.md, api-v1.md and the
account-erasure runbook. Read schema/migrations 0009–0011 and actual surrounding
code, not just the diff. Original canonical roadmap and interaction spec remain
under /Users/davis/Dictation Operative/docs/. P1 integration and review receipts
are beside its worktree in p1-integration and p1-review-followup. P1 is integrated
and reviewed without blockers; optional O1–O6 and printing/release work are deferred.

Check every text write path (legacy/v1/create/import/organize/edit/restore/append
and idempotent retries), exact owner/key identity including Unicode/NUL/whitespace
and long keys, no manual name reuse, manual/collection union and nullable inherited
manual semantics, retained inactive slots/order/receipts, provenance-only revision
invalidation, atomic source/mapping rollback, 100-pile/500-slot concurrency and
honest blocked progress. Verify transaction-current bounded traversal, interruption,
parallel backfill, source edits/deletes/imports, and what complete actually proves.

Review Remove/Remove and pin collection clearing and source CAS; Undo provenance,
order, newer-source conflicts and pin preservation; exact historical operation
replay; mapped rename/deletion suppression and all non-resurrection paths. Check
that pending retention is explicit, owner-scoped and accurately reported by reads,
receipts and deletion impact; cleanup races and stale confirmations must not expose
content silently. Safe deletion must protect mapped members while pending members
retain their hold. No source copies, quota/queue/body/history/backup changes.

Review migration-before-code behavior, older clients versus older Workers,
activation and quiesced rollback gates. Check complete account erasure (including
mapped owners, suppression, late source creation/backfill), six-table reconciliation,
verified-owner/live/unclaimed guards, interruption/retry and byte-queue preservation.
Check route auth, Origin/no-store and genuine PKCE bearer parity. No schema rollback
or production rehearsal is claimed. Pile deletion has NO Undo; member Undo remains.

Evidence: all eight required commands pass, 183 tests; ../validation/results.json
and logs. Shared-items CI is preserved and extended tests run through it. All
fixtures synthetic/local. Review meaningful coverage, omissions and unsupported
operational claims. No independent review has happened yet. Report concrete
blocking correctness/security/data-integrity findings with file/line and plausible
failure scenarios separately from optional improvements. State the exact reviewed
revision and residual limits. Return findings for fixes; do not integrate anything.
```
