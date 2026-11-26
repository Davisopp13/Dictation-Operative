# Account erasure reconciliation after a pre-F2 Worker window (B1)

This is a prepared maintenance procedure, not an executed production change.
It addresses Opus B1 and the B1-R1 tooling finding on
`a67d99ae418f5864aa159935f0b22ed14d2fcb90`.
No migration or runtime route is added by this fix. Production execution and any
maintenance window still require the project's separate release authorization.

## Why this is necessary

Migration 0009's source-delete triggers create `item_deletions`. The pinned
pre-F2 Worker `09675098986887be287b240d1b4e2449fa4e6f07` does not erase that table,
`piles` or `pile_operations` during account deletion. Thus an account deleted
**after 0009 but before the F2 Worker**, or during a rollback to that Worker,
leaves owner/item identifiers and timestamps; populated piles/receipts can also
leave private pile names. This happens even when no memberships exist. Only the
F2 account-deletion implementation erases the new data in its request transaction.
The old Worker is source-schema compatible, **not erasure compatible**.

Running reconciliation once immediately after rollback cannot cover later
account deletions by the old Worker. Keep account deletion unavailable for the
whole rollback interval, or do not use that rollback. Keep the existing scheduler
restriction too: after memberships exist, retain pile-aware cleanup or disable
cleanup for affected accounts before rollback.

## Verified identity rules; never sweep all unmatched owners

`lib/app-auth.ts::resolveWorkspaceOwner` returns the raw `auth_legacy_owner.owner`
when linked, otherwise raw `auth_user.id`. It does not prefix or hash the value.
The map's `user_id` references `auth_user.id`; `owner` is unique. The old deletion
batch removes that mapping before removing `auth_user`, so a post-deletion query
cannot reconstruct the pair.

`lib/identity.ts` also accepts signed Cloudflare Access identities whose owner is
JWT `sub` (email fallback), even without an application account or map; local
fixtures use `local_dev`. The checked-in production config omits Access, but that
is **not evidence about all deployed environments or historical workspaces**.
A `NOT EXISTS(auth_user.id=owner)` sweep would delete valid mapped/legacy data.
Do not use it. Do not identify deleted users from email or ID shape.

## Establish evidence before the window

1. Confirm the approved target database/configuration and actual migrations.
   The checked-in PWA binding is `DB`, database `do-voice-workspace`, ID
   `8b594b74-8055-4e7c-aec4-5406915b78da`; verify these against the intended
   environment rather than assuming the default is the target. Never copy
   production rows into the local synthetic test database.
2. Before applying 0009 or rolling back, pause account deletion, registration
   and account/legacy linking through the approved maintenance mechanism. Wait
   for in-flight account mutations to finish. This is an operator gate, not a
   new application feature supplied here. Keep that gate closed through the
   old-Worker interval. This prevents an account created or linked after the
   census from disappearing without owner evidence.
3. Capture `maintenance/account-owner-snapshot.sql` **in that same environment**.
   It returns `{accountId,owner}` for every application account, including its
   current legacy mapping. Preserve the result, target database ID, UTC capture
   time and exact Worker revisions in restricted release evidence. It contains
   private identifiers; do not commit it or attach it to a public review.
4. Deploy the F2 Worker, or finish the bounded rollback interval and return to an
   erasure-compatible Worker. Run reconciliation below before reopening account
   mutations. Also reconcile any deletion that raced with maintenance activation.
   Keep account deletion paused while an older Worker remains live; a cleanup
   pass is not a substitute for erasure support on subsequent requests.

Before this window, rehearse the **entire query-command sequence below** against
an approved throwaway/staging D1 seeded only with synthetic accounts and mapped
owners. Use that database's isolated configuration and a separate evidence
directory. Check the snapshot's row envelope, pass it directly to the generator,
check the pre-audit, apply, and verify zero eligible residual counts in the
re-audit while live/mapped/unlisted fixtures survive. Record the target, commands
and JSON outputs. This non-production query-API rehearsal is a release gate;
local Miniflare tests alone do not satisfy it. Remote rehearsal itself requires
separate authorization and has **not** been run for this fix.

## Query path and snapshot input (Wrangler 4.92.0)

Use **`--command`, never `--file`, for this procedure**. In pinned Wrangler 4.92.0,
`executeRemotely` in `node_modules/wrangler/wrangler-dist/cli.js` sends `--file`
through the import API: it returns only a summary row (such as "Total queries
executed"), discards SELECT rows, and warns of database unavailability during
import. `--command` sends SQL to the query API and returns per-statement results.
The apply uses the query path too, avoiding that import behavior. Use the
`--command="$(cat ...)"` equals form shown below: these SQL files start with `--`
comments, which pinned Wrangler can interpret as options when supplied as a
separate `--command` argument.

A census query returns exactly one statement entry, in this shape:

```json
[
  {
    "results": [{"accountId":"application-id","owner":"mapped-legacy-owner"}],
    "success": true,
    "meta": {"duration":0.4,"rows_read":2,"rows_written":0}
  }
]
```

Actual `meta` may contain additional fields. Save the whole JSON envelope and
pass it **directly** to the generator; no manual extraction or jq is needed. The
generator requires exactly one entry with only `results`, `success`, `meta`, a
true success value, an object `meta`, and rows with exactly `accountId` and `owner`.
It also continues to accept the original plain array of those pairs. Import
summaries get a specific error directing the operator to rerun with `--command`
rather than `--file`; do not strip the summary envelope to bypass the check.

Use at most 100 pairs per plan. For a larger captured census, preserve the raw
envelope and derive disjoint plain-pair batches offline, recording their coverage
against the original capture. A size failure may require smaller batches even
below 100 pairs. Live pairs can stay: SQL guards protect them. An empty census
has no plan to apply; retain the empty query result as evidence. Do not substitute
today's census for a missing pre-window census.

**Already elapsed window without evidence:** recover the exact account/owner
pairs from an approved pre-window database backup or authoritative deletion audit
that includes both values. The current `account_deleted` log does not record
either identifier. Never infer missing mappings from remaining F2 rows. Unknown
Access-only, unclaimed or otherwise unresolved owners stay untouched and remain
an explicitly unresolved erasure investigation. Do not declare the reconciliation
complete until all known deletion events in the old-Worker interval are accounted
for; if evidence cannot be recovered, that is a release/rollback limitation to
report, not permission to broaden the predicate.

## Generate, review, execute and verify

The offline generator contacts no service and cannot execute SQL. It writes
mode-0600 audit/apply files with `wx` (refusing overwrite). All validation and size
checks finish before either file is created. Review the actual pairs and generated
SQL before apply approval. Validation covers nonempty strings of at most 512
characters, control characters, duplicate owners, strict row/envelope shape and
byte size. SQL string literals still double quotes. It does not prove snapshot
provenance; that remains the evidence requirement above.

[D1 documents a 100,000-byte SQL statement limit](https://developers.cloudflare.com/d1/platform/limits/).
The generator conservatively requires **every emitted statement and each complete
output file to be smaller than 90,000 UTF-8 bytes**, including comments, separators
and trailing newline. This is an additional file cap, not a claim that D1's batch
limit applies to the combined file. A 100-pair census with typical UUID-sized
identifiers produces roughly 10 KB per statement and 50 KB for the apply; 100
maximum-length pairs can exceed the cap and are rejected. Multibyte UTF-8 and
quote doubling count toward the limit. Split into smaller disjoint verified
batches on failure; never truncate identifiers or weaken the SQL guards.

For each listed pair, the SQL requires all of these at **each statement**:

- Neither the original `accountId` nor the raw `owner` is a current `auth_user.id`.
- No live application account maps to the owner through `auth_legacy_owner`.
- No remaining text, image, document/reservation, preferences, workspace tools,
  usage or account AI-usage row belongs to that owner. Leftover ordinary workspace
  data means erasure was incomplete for another reason; investigate it separately.

The audit reports the guard result and counts in all five maintenance tables.
`eligible=1` means eligible **within the verified census**, not a general orphan
classification. Unlisted owners are never inspected or deleted by the plan.
An eligible row with all counts zero is already reconciled. A protected row with
nonzero counts is not an error when its account is alive. Investigate protected
rows for supposedly deleted accounts; do not remove the guards to force them.

Run this exact sequence from `pwa/`. These are **future authorized operator
commands**, not actions performed by this fix. First set both paths to the
approved **non-production rehearsal** config/evidence directory. The config must
contain only that target's DB binding. After successful rehearsal and separate
production authorization, use a new evidence directory and the independently
verified production config. Do not mix targets between steps. The evidence
directory must already exist with restricted access; `umask` also protects the
JSON output files.

```sh
umask 077
reconciliation_config=/secure/rehearsal/wrangler.jsonc
reconciliation_evidence=/secure/rehearsal/evidence

# 1. Census: exactly one query result envelope with accountId/owner rows.
npx wrangler d1 execute DB --config "$reconciliation_config" --remote --json --command="$(cat maintenance/account-owner-snapshot.sql)" > "$reconciliation_evidence/snapshot.json"

# 2. Offline generation: consume that envelope directly; no database contact.
node --import tsx scripts/prepare-erasure-reconciliation.ts "$reconciliation_evidence/snapshot.json" "$reconciliation_evidence/erasure-plan"

# 3. Audit before apply: one envelope, each row has eligibility and five counts.
npx wrangler d1 execute DB --config "$reconciliation_config" --remote --json --command="$(cat "$reconciliation_evidence/erasure-plan.audit.sql")" > "$reconciliation_evidence/audit-before.json"

# 4. Apply only after reviewing/approving the concrete SQL and pre-audit.
npx wrangler d1 execute DB --config "$reconciliation_config" --remote --json --command="$(cat "$reconciliation_evidence/erasure-plan.apply.sql")" > "$reconciliation_evidence/apply.json"

# 5. Re-audit: every eligible row must have zero in all five residual columns.
npx wrangler d1 execute DB --config "$reconciliation_config" --remote --json --command="$(cat "$reconciliation_evidence/erasure-plan.audit.sql")" > "$reconciliation_evidence/audit-after.json"
```

Check each command's exit status and JSON before continuing. Both audit envelopes
must have `success: true` and readable `results` containing `accountId`, `owner`,
`eligible`, `piles`, `pile_members`, `pile_operations`, `item_deletions`, and
`workspace_revision`. Apply returns **five** statement entries with success and
per-statement `meta` (including rows written on the remote query API); DELETE
statements need not return rows. Empty audit results, an import summary, a wrong
statement count or any unsuccessful statement are failures, not proof of erasure.
Keep every output as evidence. Do not proceed blindly if a command fails.

The query API does **not** make a multi-statement `--command` atomic. After any
interruption or partial failure, rerun the **whole apply in its original order**
with a new evidence output filename, then re-audit. Do not infer completion from
rows-written counts. Safety comes from the accepted per-statement guards and
idempotency, not all-file transaction semantics. Keep the maintenance gate closed
through audit/apply/verify so identity mappings cannot change beneath the plan.
The flags were checked against installed Wrangler 4.92.0 help/source and the
[official D1 command reference](https://developers.cloudflare.com/workers/wrangler/commands/d1/).

The apply sequence deletes piles, remaining member slots, receipts, tombstones,
then workspace revisions **last**. Deleting a pile triggers a new workspace
revision, so omitting the last delete would still leave account data. It does not
delete authentication rows, sources, preferences, or either durable byte-deletion
queue. Those queues must remain available for the scheduler to finish R2 erasure.
Do not infer physical-byte deletion from an empty metadata audit.

Each statement is independently guarded and idempotent. Even if execution stops
after pile deletion, rerunning the full file clears the trigger-created revision
and the remaining F2 metadata. Do not rely on all-file atomicity or change the
order. Repeat the audit until eligible rows have zero in all five columns, and
check that live/mapped/unclaimed owners remain intact. Retain counts, target and
completion evidence with the release record. Then reopen account mutations only
on the erasure-compatible Worker. Securely remove temporary identity-bearing plan
files according to the release evidence retention policy.

## Local regression evidence

`tests/erasure-reconciliation.test.ts` captures a pre-0009 account census, upgrades
to 0009, and reproduces the exact ordered pre-F2 account-deletion database batch.
It confirms direct and mapped deleted owners retain tombstones, pile names and
receipts before reconciliation. It exercises the generated SQL itself, including
an interruption after pile deletion and a full retry, verifies no revision remains,
and preserves live/mapped accounts, unclaimed Access fixtures, `local_dev`, an
incomplete erasure with remaining sources, and both byte-deletion queues. B1-R1
adds strict envelope/import-summary rejection and UTF-8 statement/file size tests,
including 100 maximum-length pairs. The local Wrangler `--local --command` smoke
captures a census, feeds its JSON directly to the generator, audits/applies/
re-audits and retries in temporary synthetic-only state outside the repository.
It uses a temporary config with a fake database ID, not production bindings.

That local command path runs Miniflare, and Wrangler reduces its `meta` to duration;
it neither executes the remote query API nor verifies remote rows-written metadata
or partial-failure semantics. The remote shape/routing was checked against the
pinned Wrangler source. The authorized non-production remote rehearsal above is
still required before a release. No remote D1, migration, deployment, production
maintenance or account pause was performed for this fix.
