/**
 * Each workspace has one revision counter. Any change to saved text, images,
 * or documents increases it, so a client can poll a single row and refetch
 * lists only when the number moves.
 *
 * Images and documents are bumped by triggers (migration 0007). Saved text is
 * bumped here, in the same batch as the write, because its writes are
 * conditional on a row revision and D1 reports trigger writes in row counts.
 */
export function bumpRevision(db: D1Database, owner: string, now = Date.now()) {
  return db
    .prepare(
      'INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(?,1,?) ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at',
    )
    .bind(owner, now);
}

export type WorkspaceRevision = { revision: number; updatedAt: number };

/** A workspace that has never changed since the counter existed reads as 0. */
export async function readRevision(
  db: D1Database,
  owner: string,
): Promise<WorkspaceRevision> {
  const row = await db
    .prepare(
      'SELECT revision,updated_at AS updatedAt FROM workspace_revision WHERE owner=?',
    )
    .bind(owner)
    .first<WorkspaceRevision>();
  return row ?? { revision: 0, updatedAt: 0 };
}
