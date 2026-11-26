# F2 implementation handoff

November 26, 2026 (America/New_York) · GPT-6 Astra · Local implementation; Opus B1-R1 fix awaiting re-review

## Source and authority

- Root worktree: `/Users/davis/.codex/worktrees/catch-all-desk-f2/Dictation Operative`.
- Branch: `codex/catch-all-desk-f2`.
- Exact base: `09675098986887be287b240d1b4e2449fa4e6f07`.
- Initial tree: `d71da055df4c7cd6d50ab524caa713037a17a2a3`, identical to F0's verified printing head `e4cc4141364f1524c42b8d2327a084254b2a2238`.
- Root Git is authoritative. The isolated worktree has no nested PWA Git checkout.
- Final commit and review patch SHA-256 are recorded in the external review manifest next to this worktree, and in the task handoff, to avoid a self-referential commit ID.
- Original F2 at `b8ebea2f0d55b1f3db952c854e43114514c2545e` was independently reviewed by Opus: changes required for B1. B1 follow-up `a67d99ae418f5864aa159935f0b22ed14d2fcb90` then received the B1-R1 tooling blocker. This focused B1-R1 fix awaits re-review. No push, PR, integration, remote migration or deployment.

Instructions actually read: workflow-kit `PROJECTS.md` (project row and personal data boundary), `SKILL-CATALOG.md`, `prompts/DAILY-PROMPTS.md` (§1 and §6); original untracked F0 baseline, F1 interaction spec (including §6.4–6.5, §14–16), and product roadmap; Workers best-practices skill plus runtime-patterns reference, and Wrangler skill. Cloudflare D1 batch transaction documentation was retrieved. No repo AGENTS.md was found. During the B1 follow-up, `/Users/davis/.codex/AGENTS.md` and `/Users/davis/ai-workflow-kit/AGENTS.md` were read, along with the complete supplied Opus review. Existing schema, source APIs, cleanup, account deletion, revision, content capability, API/native docs and behavioral tests supplied implementation context.

The original checkout and its untracked planning/design inputs were read in place. Parent verified its HEAD `e4cc414`, full porcelain state and SHA-256 hashes of all 35 initial changed/untracked files remained identical before handoff. Parent owns the final preservation recheck and workflow-kit project-row update. No employer data or production records were used.

## Delivered contract

The [shared browser/native contract](../pwa/docs/shared-items.md) is the implementation reference. F2 adds typed references over the existing stores; current per-kind capabilities and cleanup status; an owner-scoped aggregate with deterministic cross-store ordering and revision-bound cursors; owner/source-checked CAS membership writes; retry receipts; manual ordering with retained removal Undo slots; and atomic source-reference deletion. A source can be in multiple piles with no copied bytes or additional source quota charge.

Migration `0009_shared_items.sql` adds piles, reference slots, operation receipts, deletion-reason tombstones, image/document item revisions and source/pile/settings invalidation triggers. Drizzle journal/snapshot are included. The migration neither creates piles nor backfills collections. Existing IDs, source payloads, text history/backup, upload recovery and byte-deletion queues stay intact. The F2 Worker account-erasure handler removes all new owner data. The pinned older Worker does not; the B1 reconciliation procedure below addresses that rollout/rollback window.

The server's pile cleanup exclusion was implemented in F2 rather than waiting for P2, because membership cannot safely become usable without it. The scheduler retains default-off opt-in, the strict 24-hour age boundary and daily 08:00 UTC run. Candidate selection is ordered identically for tombstones and deletion. Add-versus-purge has a server-side winner. Source deletion atomically drops references; Remove and pin atomically protects the surviving source. Source revisions and workspace revisions are distinct; existing text CAS remains RETURNING-based.

## Verification

All data was synthetic and isolated in local Miniflare D1/R2. Node 24.13.0 / npm 11.6.2.

| Check | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed on original F2; dependency manifests unchanged in B1 |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed, 151 tests after B1-R1 regression additions |
| `npm run build` | Passed; existing chunk-size and route-classification notices |
| `npm run test:built-auth` | Passed |
| `npm run test:built-clipboard` | Passed |
| `npm run test:built-content` | Passed |
| `npm run test:built-shared-items` | Passed, new shipped-Worker check |
| `git diff --check` | Passed |

New tests cover owner isolation at API and SQL guard layers; overlapping IDs across kinds; ready-only documents; capability/cleanup metadata; deterministic cross-store pagination, owner cursor rejection and revision invalidation; duplicate concurrent writes/replays and operation-ID conflicts; no-op revisions; concurrent moves and stable Undo slots; stale Undo; concurrent last-protection removals; Remove-and-pin versus cleanup; cleanup/source-delete races; truthful cleared errors; all-source reference cleanup with existing queues; legacy collection writes; populated 0008→0009 upgrade preservation; and complete account erasure. Existing text backup/history, quotas, upload recovery, legacy APIs and auth tests also pass.

The new built check exercises real sessions, cross-account denial, absent pile creation route, aggregate cursor invalidation, an old piled source versus an old loose source under the shipped scheduler, exact retry, atomic pinning and legacy text CAS/deletion. It also deletes piled document shortcuts and images through the legacy routes. No UI was added, so no rendered-flow claim is made. No native app, physical printer, phone, Safari/Firefox or offline acceptance is claimed. Relay/printing/download implementation is unchanged; their previous F0 hardware/runtime limitations remain.

## Deferred gates and constraints

- P1 owns pile create/rename/delete/list workflows and deletion impact/confirmation. No source-visible pile UI or creation/deletion endpoint was added. Recommended initial pile deletion is confirmation-only, no Undo.
- Current membership bound is 500 slots including inactive removal slots. Proposed P1 pile-count bound is 100. P1 must define slot compaction and Undo expiry before changing those constraints.
- Receipts and deletion tombstones last for the account lifetime. Receipts contain protection metadata, not source contents. Pruning requires a later explicit replay/cleared-error policy. A replay is a **historical commit-time outcome**, so clients refetch current state. Undo of Remove and pin never silently unpins.
- P2 owns collection mapping/backfill and coexistence implementation. The shared contract specifies stable mapping IDs, manual/collection provenance union, revision-guarded repeatable migration, and how old-client edits and explicit removals must reconcile. F2 does not change collections.
- T1 stays unavailable until individual tray protection and source/pile deletion cleanup are implemented. Its future live pile references, direct references and Used/Hidden state remain possible. No tray/offline storage was added.
- Apply 0009 before the dependent Worker. The pinned RETURNING-based base can read/write the source schema but cannot completely erase accounts on 0009, even without piles. Follow the B1 runbook for a pre-window owner census, paused account mutations and reconciliation. Keep account deletion paused throughout an old-Worker rollback interval; unknown legacy owners must never be swept. **An older scheduler becomes unsafe once memberships exist**: retain this scheduler or disable cleanup for affected accounts before rolling back. No destructive migration rollback or older row-count-based text writer is an approved rollback path.
- Production migration/deploy, GitHub push/PR/integration and dependent feature activation remain separately authorized work. Independent Opus re-review of the focused B1-R1 fix is next.

## Opus B1 follow-up

The supplied independent review found one blocker: legacy account deletion after
0009 leaves tombstones and possibly piles/receipt names. The original claim of
rollback erasure compatibility was incorrect. The fix does not redesign membership
or change migration 0009. It corrects the compatibility statements and supplies a
[concrete runbook](../pwa/docs/account-erasure-reconciliation.md), a pre-window
account/owner snapshot query, and a bounded offline SQL generator that produces
separately reviewable audit/apply files. Nothing executes against a database while
generating them.

The predicate uses verified raw `auth_user.id` / `auth_legacy_owner.owner` pairs,
protects current users and mappings, and refuses cleanup while ordinary workspace
rows remain. Unlisted legacy/Access/local owners are untouched. Pile-triggered
workspace revisions are deleted last; byte queues are preserved. A missing
pre-window census must be recovered from authoritative evidence, not guessed from
orphan-looking metadata. This is a prepared operational remedy; no production
reconciliation or account-mutation pause has been performed. Keep account deletion
paused while an old Worker is live, then reconcile before reopening mutations on
the F2 Worker. One cleanup at the start of a rollback cannot cover later erasures.

New regression tests execute the exact pre-F2 deletion batch on a populated 0009
schema for raw and mapped owners, then exercise the generated SQL. They cover
source-less live/mapped accounts, unclaimed/local owners, incomplete ordinary
erasure, quote handling, trigger-created revisions, an interrupted pass and
repeat execution. The offline CLI smoke also verified mode-0600 output files and
refusal to overwrite existing plans, without contacting any database. Typecheck,
lint, all 148 tests, build and all four built Worker checks pass after this fix.
Optional Opus O1–O7 remain out of this B1-only follow-up.

## Opus B1-R1 tooling follow-up

Read both complete supplied B1-R1 review/request attachments. The prior remote
`--file` procedure was incorrect: pinned Wrangler 4.92.0 uses the import API,
which discards SELECT rows. The runbook now uses the query path for census,
audit, apply and re-audit, retains JSON evidence, and requires a separately
authorized non-production query-API rehearsal before production. Use
`--command="$(cat ...)"` with the equals sign: the real local smoke found that
leading SQL comments are otherwise interpreted as options by pinned Wrangler.

The offline parser accepts the single successful query envelope directly, as
well as plain pairs, and rejects import summaries with specific recovery guidance.
Strict envelope/row validation and conservative UTF-8 limits reject oversized
plans before output creation: every statement and complete output file must be
under 90,000 bytes against D1's documented 100,000-byte statement maximum.
The accepted owner guards and five-statement deletion order are unchanged.
No Worker runtime, migration, dependency, or O1–O7 change is included.

Typecheck, lint, all 151 tests, build and all four built Worker checks passed.
Offline CLI checks verified both input forms produce identical mode-0600 output,
existing plans cannot be overwritten, and import-summary/oversized inputs create
no SQL. Real Wrangler local query commands captured the census, generated plans,
audited/applied/re-audited, and repeated safely in a temporary synthetic-only
configuration/state directory outside the repository. Eligible residuals reached
zero; live/mapped/unlisted fixtures survived and no trigger-created workspace
revision remained. Exact commands, JSON outputs and logs are in the external
B1-R1 report/manifest next to the worktree.

Local envelopes have exactly `results`, `success`, `meta`; pinned remote query
serialization passes API results through, while `finalBookmark` is constructed
only on the import branch. Local Miniflare batches and duration-only metadata do
not verify remote execution/partial failures. No remote command, deployed
migration, production data or maintenance window was executed. The authorized
non-production remote rehearsal remains an explicit release gate.

## Independent review prompt

Review the focused `a67d99a`→head B1-R1 diff, with the full original-base→head diff available for context. Check owner isolation, CAS/receipt replay semantics, aggregate consistency, manual ordering and Undo, cleanup/source deletion races, old-client/backup compatibility, migration/rollback and account erasure. Treat the absent P1/P2/T1 surfaces as documented gates, not implemented product workflows. Use the F1 interaction spec from the original checkout as acceptance context. Report concrete blocking findings with affected lines separately from optional improvements. Do not edit, merge, push or deploy. Return findings to the implementer against the exact reviewed revision.
