# P3 mixed piles and pending-organization handoff

November 27, 2026 (America/New_York). **Implemented and locally validated. Awaiting
independent Opus review. Not pushed, integrated or released.**

## Exact target and authority

- Worktree: `/Users/davis/.codex/worktrees/catch-all-desk-p3/Dictation Operative`.
- Branch: `codex/catch-all-desk-p3`.
- Exact integrated P2 base: `2ddbb672ab15f19f51e0729bd0824ce7132b32cc`, PR #15.
  Fetched origin/main was exactly this base when work began; its tree equals
  independently reviewed P2 `d63c7a52943fcb63ef8aa9e4271c8086428e1b9a`.
- Implementation commit: 9ce111741e528c57d42185e5c4deb3c64571164c.
- This handoff is a subsequent documentation commit. Its exact final review HEAD,
  tree, branch, clean state and full base-to-HEAD patch SHA256 are recorded in
  `/Users/davis/.codex/worktrees/catch-all-desk-p3/review-manifest.json`.
  The patch is `../p3-review.diff`; complete review prompt is
  `../OPUS-REVIEW-PROMPT.txt`. This avoids a self-referential commit ID.
- Authorship: Codex/GPT, configured model unchanged. No Claude implementation,
  delegated agents, new chats or independent reviewer were launched. Use Opus for
  independent review of this GPT-authored change.
- Task authority is the saved P3 prompt at
  `/Users/davis/.codex/handoffs/catch-all-desk-p3-implementation-20261127.txt`,
  SHA256 `c3eba2b0a2f04fccec5a92f10b73f3a47b5be2f6d76aebab87e0d1ebb4c51f71`.
  It authorizes local implementation/commits/review preparation only.

The branch/worktree was newly created from that exact base and initially clean.
All application work is isolated here. Original checkout remains on
`codex/web-print-pdf-preview` at `e4cc4141364f1524c42b8d2327a084254b2a2238`.
Eight existing worktrees and all original dirty/untracked hashes were preserved.
Only the canonical roadmap's P3 row and the workflow-kit project row are updated
outside this checkout. See `../preservation-before.json`,
`../preservation-before-checkpoint.json`, `../preservation-verification.json`.
No unrelated design files, historical review receipts, phone-print fixes or release
branch changes were copied into P3.

## Implemented behavior

- Real mixed Desk and Piles navigation, browser-local start page notice/Change,
  account-scoped history and selection; existing Clipboard/Documents filters and
  capture paths remain. Server sortTime ordering, 40-item pages and stale-cursor
  restart; no unified search or invented shared-item query filters.
- Six token-backed pile colors, lazy three-member cover previews, empty/error
  states, atomic new-pile selection (50-reference/request-size limit), duplicate
  name warning, rename/recolor, complete bounded detail, explicit accessible
  ordering controls and accurately labeled pile-scoped finding.
- Space/range/Select all loaded/Clear/Escape selection; pin and explicit membership
  actions with partial-success reporting. Checkboxes show effective/mixed state;
  Add establishes manual provenance. Individual removal confirms actual impact.
  Immutable retry bodies/operation IDs and a serialized membership controller
  retain uncertainty but exclude confirmed steps. Conflicts require reconfirmation.
- Real persistent membership Undo across dialog closure/navigation, named source
  and pile, no timeout. Undo preserves pins/order and cannot overwrite newer edits.
  Delete item everywhere remains a separate single-source action; no bulk delete.
- Safe atomic Remove and pin; fresh workspace-bound pile-deletion confirmation,
  pin-exposed default, explicit expose acknowledgement, permanent mapped-key
  suppression warning and no pile-deletion Undo.
- Per-item collection organization independent of cleanup priority, pending cards
  and editor guidance even while pinned/in a manual pile, legacy Collection/tags
  retained, atomic pin on deliberate Collection changes, and saved-versus-status-
  unavailable messaging. Existing historical key behavior remains exact.
- Collection progress with authoritative counts/reasons and one explicit POST of
  at most 25 per Continue. No migration-on-read/startup/timer. It stops when ready=0,
  distinguishes indefinite holds and suppression, and explains 100 empty mapped
  piles/500 retained slots. No delete-to-free-space recommendation.
- Text/image/file/scanner capture into Desk or a pile, source first then ready
  membership. Lost/failed membership retries only the saved source. Page paste
  stages text for Save. Explicit oversized-image original-as-Document or Cancel;
  existing normalization/dimension/size policies remain.
- General HTTPS links with editable title/URL, host suggestion and display,
  parsed Google classification, revision CAS and owner validation. No automatic
  server/browser unfurl, favicon, iframe or destination request. Explicit Open uses
  noopener noreferrer. Existing PDF preview/print components are reused.

## Additive contracts and invariants

Full fields and endpoint details: `pwa/docs/p3-workspace.md`; existing shared-items,
piles, collection-mapping, content-tray and api-v1 docs link that extension.

- Shared list/detail and newly written receipts add `organization:{state,pending}`
  and `workspaceRevision`. States distinguish none, mapped, ready, pile_capacity,
  member_capacity, suppressed pending, deliberately settled suppression and unknown.
  They derive from committed sources/mappings/provenance and P2 pending rules.
  Older receipts are conservatively unknown/null; replay is a commit-time snapshot,
  so current organization is refreshed from detail.
- Owner-scoped `GET /api/v1/piles/:id/items?limit=1..500` returns ordered ready
  members and coherent revisions in one D1 batch. Covers request at most three
  after intersection. Complete detail is bounded by retained-slot capacity.
- `GET /api/v1/piles/:id/members/:kind/:id/impact` exposes projected protection,
  Collection clearing and source workspace/pile guards. Membership POST optionally
  accepts workspaceRevision in its atomic claim and fingerprint. Legacy fingerprints
  remain valid. Pile-deletion impact adds only mappedCollection for disclosure.
- Both text PATCH surfaces accept organize.keepPinned and workspaceRevision. Safe
  pin and Collection mutation share one owner/CAS-checked UPDATE; false never unpins.
- Content reads add revision. Link name/URL PATCH requires a current revision and
  repeats HTTPS/no-credentials/length validation; pin-only compatibility remains.
  AFTER-trigger revision increments are represented in responses.

No schema, migration metadata, dependency or lockfile change. Migrations 0000–0012
remain byte-identical to base; no schema drift command was needed. P1/P2 cleanup,
provenance, retained slots, retry receipts, owner isolation and complete erasure
remain in the tested path. Release prerequisites in P2 erasure/reconciliation docs
remain mandatory for a separately authorized release; this work performs none.

## Validation and evidence

All eight required commands passed on the final implementation source from `pwa`:

| Command | Result | Evidence outside checkout |
| --- | --- | --- |
| `npm run typecheck` | pass | `../typecheck.log` |
| `npm run lint` | pass | `../lint.log` |
| `npm test` | 201 passed, zero failures/skips | `../tests.log` |
| `npm run build` | pass | `../build.log` |
| `npm run test:built-auth` | pass | `../built-auth.log` |
| `npm run test:built-clipboard` | pass | `../built-clipboard.log` |
| `npm run test:built-content` | pass | `../built-content.log` |
| `npm run test:built-shared-items` | pass | `../built-shared-items.log` |

Build completed before the four final built checks. `git diff --check` passed.
The built checks use temporary local bindings/synthetic accounts. New tests cover
organization independent of cleanup priority, both capacity limits/suppression,
atomic Collection change/removal guards, old receipts, generic links/edit CAS,
selection/retries and the UI's real MembershipBatch controller. The built shared
check adds four mixed sources, two independently authenticated sessions, quota/
reference preservation, owner denial, removal/Undo, links and pinned-pending state.

See `docs/catch-all-desk-p3-rendered-checklist.md` for observed Chrome flows and
reviewer rerun cases. Screenshots were captured inline in the implementation
conversation; no standalone screenshot paths are claimed. Additional final focus
and network observations are recorded in `../browser-final-results.json`.
Synthetic local fixtures live in `../render-fixtures`; their source is
`../seed-render-account.py`. Logs/fixtures and local auth cookies are outside the
review patch; do not redistribute local session-cookie files. No production
credentials/data were used.

The initial Vite dev server did not finish starting; rendered verification used
its built Worker with Wrangler `--local`, isolated `.wrangler/state`. The ignored
generated `dist/server/wrangler.json` had routes/services cleared for localhost-only
preview, leaving tracked production configuration unchanged. This avoids the
production host redirect during local auth. No published preview was created.
The owned local preview is stopped at handoff.

## Deliberate boundaries and remaining acceptance

Integrated P1/P2 behavior supersedes older speculative spec text: no pile-deletion
Undo, permanent exact-key suppression, retained inactive slots and capacity-pending
source saves. Legacy Collection remains available for individual pending resolution.
Backfill uses a single explicit batch per action, rather than an automatic loop.
Reorder uses explicit keyboard/touch controls; drag-and-drop is optional and absent.

Slot compaction/release, receipt pruning, unsuppression, limit increases, optional
P2 partial index/defensive capacity-409 cleanup, S1 search, tray/Take/Drawer, offline,
Trash and sharing are deferred. Future slot recovery must explicitly design order,
provenance and historical Undo receipts. Existing image conversion rejects originals
over 8 MiB as well as normalized PNGs over 8 MiB; P3 preserves that policy and offers
explicit original-as-Document recovery, without silently changing stores.

Physical iPhone/Android/PWA lifecycle, Safari/Firefox, assistive technology, real
camera/scanner/printing and external shop navigation were not verified. The four-
item browser scenario and automated independent-cookie sessions are distinct;
browser tabs were not claimed to have independent cookie jars. Captured-response
loss was tested in the browser; concurrency/cleanup/capacity permutations also rely
on real local D1/built Worker and controller tests. No phone-print-fix branch changes
are present in this integrated P2 base.

Next: independent Opus review of the **entire exact base-to-final-HEAD diff**, including
rendered flows, before considering integration. The saved review prompt provides
verification commands, risks and authority. No push, PR, merge, deployment, remote
migration/query/rehearsal, production backfill or physical print was performed.

## Instructions actually read

- `/Users/davis/.codex/AGENTS.md`; `/Users/davis/ai-workflow-kit/AGENTS.md`.
  No repository-specific AGENTS.md/CLAUDE.md was found.
- `/Users/davis/ai-workflow-kit/PROJECTS.md`, `SKILL-CATALOG.md`, and
  `prompts/DAILY-PROMPTS.md` sections 1, 4–6. Personal data boundary confirmed.
- Canonical roadmap P3/phase-1 acceptance and interaction-spec sections requested
  by the implementation prompt, read in `/Users/davis/Dictation Operative/docs`.
  No competing canonical copies were created.
- P2 external `p2-integration/integration-report.md`,
  `p2-rereview-acceptance/handoff.md` and `claude-rereview.txt`.
- Integrated shared-items, piles, collection-mapping, api-v1,
  account-erasure-reconciliation docs, source/tests, package scripts and CI.
- Sites skill `sites/1.1.7/skills/sites/SKILL.md` and
  `references/preview/local.md` under the OpenAI-curated-remote plugin cache.
  Used for local repo verification only; no registration/upload/publication.
- `/Users/davis/.codex/skills/workers-best-practices/SKILL.md` and runtime patterns;
  `/Users/davis/.codex/skills/wrangler/SKILL.md` for strictly local binding work.
  Official Cloudflare D1 batch documentation was checked through its docs tool.
- Browser tool documentation, local-development, screenshot, file-upload,
  viewport and CDP guidance for rendered local validation.
