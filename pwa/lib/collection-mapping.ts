import { AppError, object } from './domain';

/** Shared account guard for source creation and backfill authenticated before erasure. */
export const liveAccountSQL = `(? IS NULL OR EXISTS(SELECT 1 FROM auth_user u WHERE u.id=? AND COALESCE((SELECT owner FROM auth_legacy_owner WHERE user_id=u.id),u.id)=?))`;
export const liveAccountArgs = (owner: string, accountId?: string) => [
  accountId ?? null,
  accountId ?? null,
  owner,
];

const statusSQL = `SELECT
 (SELECT count(*) FROM collection_backfill_pending WHERE owner=?) AS pending,
 (SELECT count(*) FROM collection_backfill_pending WHERE owner=? AND state='ready') AS ready,
 (SELECT count(*) FROM collection_backfill_pending WHERE owner=? AND state='pile_capacity') AS pileCapacity,
 (SELECT count(*) FROM collection_backfill_pending WHERE owner=? AND state='member_capacity') AS memberCapacity,
 (SELECT count(*) FROM collection_backfill_pending WHERE owner=? AND state='suppressed') AS suppressedPending,
 (SELECT count(*) FROM collection_mappings WHERE owner=? AND pile_id IS NOT NULL) AS mappedKeys,
 (SELECT count(*) FROM collection_mappings WHERE owner=? AND pile_id IS NULL) AS suppressedKeys,
 (SELECT count(*) FROM pile_members WHERE owner=? AND collection_key IS NOT NULL) AS mappedMembers,
 COALESCE((SELECT revision FROM workspace_revision WHERE owner=?),0) AS revision`;
type Status = {
  pending: number;
  ready: number;
  pileCapacity: number;
  memberCapacity: number;
  suppressedPending: number;
  mappedKeys: number;
  suppressedKeys: number;
  mappedMembers: number;
  revision: number;
};
const statusStatement = (db: D1Database, owner: string) =>
  db.prepare(statusSQL).bind(...Array(9).fill(owner));
function status(row: Status) {
  return {
    ...row,
    complete: row.pending === 0,
    status:
      row.pending === 0 ? 'complete' : row.ready ? 'incomplete' : 'blocked',
  };
}
export async function inspectCollectionBackfill(db: D1Database, owner: string) {
  return status((await statusStatement(db, owner).first<Status>())!);
}

/** Each UPDATE selects a CURRENT row inside this one bounded transaction.
 * No stale read or moving cursor; interruption commits the whole batch or none.
 * Repeating a POST resumes the remaining work, not a historical progress receipt.
 */
export async function advanceCollectionBackfill(
  db: D1Database,
  owner: string,
  input: unknown,
  accountId?: string,
) {
  const data = object(input),
    limit = data.limit === undefined ? 25 : data.limit;
  if (
    Object.keys(data).some((key) => key !== 'limit') ||
    !Number.isSafeInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 50
  )
    throw new AppError('Use a backfill limit from 1 to 50.');
  const batch = await db.batch([
    db
      .prepare(`SELECT ${liveAccountSQL} AS live`)
      .bind(...liveAccountArgs(owner, accountId)),
    ...Array.from({ length: Number(limit) }, () =>
      db
        .prepare(
          `UPDATE clips SET collection_synced=1 WHERE owner=? AND id=(SELECT id FROM collection_backfill_pending WHERE owner=? AND state='ready' ORDER BY id COLLATE BINARY LIMIT 1) AND ${liveAccountSQL} RETURNING id`,
        )
        .bind(owner, owner, ...liveAccountArgs(owner, accountId)),
    ),
    statusStatement(db, owner),
  ]);
  if (!(batch[0].results[0] as { live: number }).live)
    throw new AppError('This sign-in has expired. Sign in again.', 401);
  return {
    ...status(batch.at(-1)!.results[0] as Status),
    processed: batch.slice(1, -1).reduce((n, r) => n + r.results.length, 0),
  };
}
