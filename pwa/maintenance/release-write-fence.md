# Release write fence

The 0008 → 0012 production upgrade needs old writers to remain unable to commit
when P3 opens. Cloudflare deployment success does not establish that earlier
invocations have drained. This fence provides a storage barrier, including for
older version URLs, rather than assuming elapsed time proves completion.

`WORKSPACE_WRITE_FENCE=on` wraps D1 in the HTTP, framework auth (via `withEnv`) and
scheduled paths. SELECT reads retain native D1 behavior. Each current mutation or
batch executes in one D1 batch transaction: open `active=0` only when `mode=open`,
execute the original statements, restore `active=1`. Failure rolls everything
back. Other transactions cannot write in the temporary opening. Old Workers do
not use that adapter and their writes remain rejected after public traffic reopens.

The control row is `p3_release_maintenance(id=1,active,mode)`. BEFORE INSERT/UPDATE/
DELETE triggers cover every application table, including auth, sources, metadata,
preferences and byte-deletion queues. Missing control rows fail closed. Internal
Cloudflare/SQLite tables and the migration ledger are excluded. This is a small
operator schema extension, not a numbered product migration. Keep it and the
config flag after release; removing it or disabling the adapter is **not** a safe
rollback. Future deployments must retain it until a separately verified replacement
covers older invocations/versions. Do not manually leave `active=0` on a serving DB.

Preparation uses only schema definitions (not account rows):

1. Query `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE
   'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name` through Wrangler's remote
   **query** path and preserve its JSON envelope.
2. `node maintenance/prepare-release-fence.mjs schema.json install.sql` prepares
   inactive control/guards and refuses unknown definitions/overwrite. Execute each
   reviewed statement; verify exact definitions before activation. Repeating the
   generator on fresh schema prepares only missing guards.
3. After the temporary maintenance Worker blocks public requests/scheduling,
   atomically `UPDATE p3_release_maintenance SET mode='closed',active=1 WHERE id=1`.
   Verify the row and all guards. This is the D1 ordering barrier for earlier
   requests; any later old-code database mutation aborts, including old erasure
   batches before their R2 work. Already committed durable byte-deletion intents
   remain valid; do not delete or recreate their queue entries.
4. Capture the authoritative owner census and preserved-table counts; apply exact
   0009–0012 under the barrier. Generate/install missing guards on the five new
   tables before activating P3. Verify complete definitions and all source counts.
5. Reconcile using the six-table erasure runbook. Under a successfully closed gate
   no captured account can disappear; any unexpected eligible/residual identity
   requires investigation. Never relax the gate merely to force a delete through.
6. Deploy the fenced build. Verify routes/bindings, schema, public maintenance and
   closed mutation behavior. Reopen with one `UPDATE ... SET mode='open',active=1
   WHERE id=1`; execute scoped synthetic smoke, re-audit and verify `active=1`.
   Closing again uses `mode='closed',active=1`; traffic may remain readable but
   all mutations are refused. Forward repair is the default.

The adapter intentionally rejects `exec`, dumps and write `raw({columnNames:true})`.
Current Drizzle write RETURNING fields are unique named columns; its normal raw
rows are reconstructed in field order. SELECT raw encoding remains native. New
callers needing duplicate/numeric RETURNING aliases must extend and test that
contract first. No raw handle is exposed to application callers. Local development
can override `WORKSPACE_WRITE_FENCE=off` in an ignored `.dev.vars` when using only
synthetic local bindings; production configuration defaults on.

Tests cover late prepared old writes, closed/open gates, rollback after a failed
batch, concurrent old/new writes and session operations. All four built Worker
checks install the fence and run with it enabled, including actual auth/PKCE,
upload, deletion, scheduler, provenance, pending state, Undo and erasure flows.
The fixture adapter is used only to seed synthetic data; HTTP handlers use the
built runtime adapter. This does not establish physical-device acceptance or an
independent security review.

Sources: [D1 atomic batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
[deployment in-flight requests](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/#in-flight-requests),
[withEnv](https://developers.cloudflare.com/workers/runtime-apis/bindings/#overriding-env-values).
