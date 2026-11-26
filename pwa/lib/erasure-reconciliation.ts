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

// D1 documents 100,000 bytes per SQL statement. Leave 10% headroom and
// conservatively cap the entire --command file at the same limit as well.
// https://developers.cloudflare.com/d1/platform/limits/
export const RECONCILIATION_SQL_BYTE_LIMIT = 90_000;
const preamble =
  '-- Generated from a verified pre-window account/owner snapshot.\n-- Follow docs/account-erasure-reconciliation.md; generating SQL does not authorize execution.\n';
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const importColumns = [
  'Total queries executed',
  'Rows read',
  'Rows written',
  'Database size (MB)',
];

/** Accept one successful Wrangler query statement or the original plain pairs. */
export function parseOwnerSnapshot(input: unknown): OwnerSnapshot[] {
  if (!Array.isArray(input))
    throw new Error(
      'Supply plain snapshot pairs or one Wrangler query result envelope.',
    );
  const summaryRow = (value: unknown) =>
    record(value) && importColumns.some((key) => Object.hasOwn(value, key));
  if (
    input.some(
      (entry) =>
        summaryRow(entry) ||
        (record(entry) &&
          Array.isArray(entry.results) &&
          entry.results.some(summaryRow)),
    )
  )
    throw new Error(
      'Wrangler import summary is not a snapshot. Rerun the census with --command rather than --file.',
    );
  let rows: unknown[] = input;
  if (
    input.some(
      (entry) =>
        record(entry) &&
        ['results', 'success', 'meta', 'finalBookmark'].some((key) =>
          Object.hasOwn(entry, key),
        ),
    )
  ) {
    if (input.length !== 1)
      throw new Error(
        'The snapshot query must return exactly one statement envelope.',
      );
    const entry = input[0];
    if (
      !record(entry) ||
      Object.keys(entry).length !== 3 ||
      !Object.hasOwn(entry, 'results') ||
      !Object.hasOwn(entry, 'success') ||
      !Object.hasOwn(entry, 'meta') ||
      !Array.isArray(entry.results) ||
      !record(entry.meta)
    )
      throw new Error(
        'Expected one query envelope containing only results, success and meta.',
      );
    if (entry.success !== true)
      throw new Error(
        'The snapshot query did not succeed; rerun it before generating a plan.',
      );
    rows = entry.results;
  }
  if (!rows.length || rows.length > 100)
    throw new Error(
      'Supply 1–100 verified account/owner snapshot pairs per plan.',
    );
  const seen = new Set<string>();
  const pairs = rows.map((row): OwnerSnapshot => {
    if (
      !record(row) ||
      Object.keys(row).length !== 2 ||
      !Object.hasOwn(row, 'accountId') ||
      !Object.hasOwn(row, 'owner')
    )
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
  return pairs;
}

export function reconciliationPlan(input: unknown) {
  const pairs = parseOwnerSnapshot(input);
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
  for (const [index, statement] of [audit, ...statements].entries())
    assertSqlSize(statement, `SQL statement ${index + 1}`);
  const auditFile = preamble + audit + '\n';
  const applyFile = preamble + statements.join('\n\n') + '\n';
  assertSqlSize(auditFile, 'Audit output file');
  assertSqlSize(applyFile, 'Apply output file');
  return { audit, statements, auditFile, applyFile };
}

function assertSqlSize(sql: string, label: string) {
  if (new TextEncoder().encode(sql).byteLength >= RECONCILIATION_SQL_BYTE_LIMIT)
    throw new Error(
      `${label} reaches the conservative ${RECONCILIATION_SQL_BYTE_LIMIT}-byte SQL limit. Split the verified census into smaller disjoint batches.`,
    );
}
