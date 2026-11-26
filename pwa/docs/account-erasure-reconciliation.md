# Account erasure reconciliation after a pre-F2 Worker window (B1)

This is a prepared maintenance procedure, not an executed production change.
It addresses Opus B1 on `b8ebea2f0d55b1f3db952c854e43114514c2545e`.
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

A read-only command shape, after target authorization, from the PWA directory:

```sh
npx wrangler d1 execute DB --config wrangler.jsonc --remote --file maintenance/account-owner-snapshot.sql --json
```

Wrangler returns result envelopes. Extract their `results` arrays into a plain
JSON array; verify the pairs against the captured result. Use at most 100 pairs
per plan, split a larger census into disjoint batches and account for every pair.
Snapshot pairs for still-live accounts may remain in the input: SQL guards protect
them. Do not substitute today's census for a missing pre-window census.

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

The offline generator contacts no service and cannot execute SQL. Put the verified
plain snapshot array in a restricted file outside the repository, for example:

```json
[{"accountId":"deleted-application-id","owner":"mapped-legacy-owner"}]
```

From `pwa/`, supply the verified file and a new output prefix:

```sh
node --import tsx scripts/prepare-erasure-reconciliation.ts /secure/release/verified-snapshot.json /secure/release/erasure-plan
```

It writes mode-0600 `erasure-plan.audit.sql` and `erasure-plan.apply.sql`, refusing
to overwrite existing files. Review the actual pairs and generated SQL before
approval. The generator quotes raw identifiers as SQL string literals and rejects
control characters, duplicate owners and oversized batches. It does not prove the
snapshot's provenance; that is the evidence requirement above.

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

After the concrete plan is approved, execute the audit read, the apply file and
then the exact same audit again against the **same verified target**:

```sh
npx wrangler d1 execute DB --config wrangler.jsonc --remote --file /secure/release/erasure-plan.audit.sql --json
npx wrangler d1 execute DB --config wrangler.jsonc --remote --file /secure/release/erasure-plan.apply.sql --json
npx wrangler d1 execute DB --config wrangler.jsonc --remote --file /secure/release/erasure-plan.audit.sql --json
```

These are future operator commands, not authorization to execute them now. Replace
config/environment flags consistently if the approved target differs. The flags
were checked against installed Wrangler 4.92.0 help and the
[official D1 command reference](https://developers.cloudflare.com/workers/wrangler/commands/d1/).
Keep the maintenance gate closed while audit/apply/verify runs so no new claim or
identity mapping invalidates the reviewed evidence.

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
incomplete erasure with remaining sources, and both byte-deletion queues. No
production reconciliation has been executed.
