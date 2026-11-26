/** Offline SQL generation only. Never infer deletion from an unmatched owner:
 * Access-only and local_dev identities can legitimately lack auth_user rows.
 * Input must be a verified pre-window account/owner snapshot (see runbook).
 */
export type OwnerSnapshot = { accountId: string; owner: string };
const cleanupTables = [
  'piles',
  'pile_members',
  'pile_operations',
  'item_deletions',
  'workspace_revision',
] as const;
const sourceTables = [
  'clips',
  'clipboard_images',
  'content_items',
  'preferences',
  'workspace_tools',
  'usage',
] as const;

export function reconciliationPlan(input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    throw new Error(
      'Supply 1–100 verified account/owner snapshot pairs per plan.',
    );
  const seen = new Set<string>();
  const pairs = input.map((row): OwnerSnapshot => {
    if (!row || typeof row !== 'object')
      throw new Error('Invalid snapshot pair.');
    const { accountId, owner } = row as Record<string, unknown>;
    for (const value of [accountId, owner])
      if (
        typeof value !== 'string' ||
        !value ||
        value.length > 512 ||
        Array.from(value).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new Error(
          'Snapshot identities must be nonempty strings without control characters (max 512).',
        );
    const pair = { accountId: accountId as string, owner: owner as string };
    if (seen.has(pair.owner))
      throw new Error(
        'Duplicate owner in snapshot; resolve its identity before reconciliation.',
      );
    seen.add(pair.owner);
    return pair;
  });
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const candidates = `WITH approved(account_id,owner) AS (VALUES ${pairs.map((p) => `(${quote(p.accountId)},${quote(p.owner)})`).join(',')}),
checked AS (SELECT approved.*,
 NOT EXISTS(SELECT 1 FROM auth_user u WHERE u.id=approved.account_id OR u.id=approved.owner)
 AND NOT EXISTS(SELECT 1 FROM auth_legacy_owner l JOIN auth_user u ON u.id=l.user_id WHERE l.owner=approved.owner)
 ${sourceTables.map((table) => `AND NOT EXISTS(SELECT 1 FROM ${table} s WHERE s.owner=approved.owner)`).join('\n ')}
 AND NOT EXISTS(SELECT 1 FROM shared_ai_usage s WHERE s.key='user:'||approved.owner)
 AS eligible FROM approved)`;
  const audit = `${candidates}
SELECT account_id AS accountId,owner,eligible,
 ${cleanupTables.map((table) => `(SELECT COUNT(*) FROM ${table} t WHERE t.owner=checked.owner) AS ${table}`).join(',\n ')}
FROM checked ORDER BY account_id;`;
  // Separate guarded statements make interruption safe to repeat. Pile deletion
  // triggers create workspace_revision rows; remove those LAST, never queues.
  const statements = cleanupTables.map(
    (table) => `${candidates}
DELETE FROM ${table} WHERE owner IN (SELECT owner FROM checked WHERE eligible=1);`,
  );
  return { audit, statements };
}
