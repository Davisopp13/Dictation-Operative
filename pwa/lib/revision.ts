/**
 * Each workspace has one revision counter. Any change to saved text, images,
 * or documents increases it, so a client can poll a single row and refetch
 * lists only when the number moves.
 *
 * SQL triggers cover images/documents (0007) and text/piles/settings (0009).
 * Existing text writers retain their explicit batch bump for compatibility.
 * The counter is an invalidation token, not an exact count of mutations.
 * Optimistic source writes use RETURNING; D1 change counts include triggers.
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
