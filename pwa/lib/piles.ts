import { AppError, id, object, revision } from './domain';
import { pageLimit } from './cursor';
import { PILE_LIMIT } from './pile-members';
import {
  itemCTE,
  itemReference,
  itemProtection,
  ItemError,
  missingItem,
  referenceKey,
  type ItemRow,
} from './shared-items';

export const INITIAL_SELECTION_LIMIT = 50;
const colors = ['blue', 'glow', 'sky', 'mint', 'sunny', 'paper'];
type PileRow = {
  id: string;
  name: string;
  color: string;
  revision: number;
  created_at: number | null;
  updated_at: number;
  memberCount: number;
};
const pileColumns = `p.id,p.name,p.color,p.revision,p.created_at,p.updated_at,
 (SELECT count(*) FROM pile_members m WHERE m.owner=p.owner AND m.pile_id=p.id AND m.active=1) AS memberCount`;
const summary = (p: PileRow) => ({
  id: p.id,
  name: p.name,
  color: p.color,
  revision: p.revision,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
  memberCount: p.memberCount,
});
const pileQuery = (db: D1Database, owner: string, pileId: string) =>
  db
    .prepare(`SELECT ${pileColumns} FROM piles p WHERE p.owner=? AND p.id=?`)
    .bind(owner, pileId);
const workspaceQuery = (db: D1Database, owner: string) =>
  db
    .prepare(
      'SELECT COALESCE((SELECT revision FROM workspace_revision WHERE owner=?),0) AS revision',
    )
    .bind(owner);
const gone = () =>
  new ItemError('pile_gone', 'This pile no longer exists.', 404);
const conflict = () =>
  new ItemError(
    'revision_conflict',
    'This pile changed elsewhere. Refresh it before trying again.',
  );
const staleImpact = () =>
  new ItemError(
    'impact_stale',
    'The workspace changed. Read the deletion impact and confirm again.',
  );
function name(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.includes('\0') ||
    Array.from(value.trim()).length > 60
  )
    throw new AppError(
      'Pile names must contain 1–60 characters after trimming.',
    );
  return value.trim();
}
function color(value: unknown) {
  if (typeof value !== 'string' || !colors.includes(value))
    throw new AppError('Unknown pile color.');
  return value;
}
function fields(data: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(data).some((key) => !allowed.includes(key)))
    throw new AppError('Unsupported pile field.');
}
const encode = (value: unknown) =>
  btoa(encodeURIComponent(JSON.stringify(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
function decode(value: unknown): Record<string, unknown> {
  try {
    if (typeof value !== 'string' || !value || value.length > 2000)
      throw Error();
    return object(
      JSON.parse(
        decodeURIComponent(atob(value.replace(/-/g, '+').replace(/_/g, '/'))),
      ),
    );
  } catch {
    throw new AppError('Invalid pile cursor or impact token.');
  }
}
function counter(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new AppError('Invalid workspace revision.');
  return Number(value);
}

export async function listPiles(db: D1Database, owner: string, url: URL) {
  for (const key of url.searchParams.keys())
    if (!['limit', 'cursor'].includes(key))
      throw new AppError('Unsupported pile filter.');
  const limit = pageLimit(url.searchParams.get('limit'));
  const cursor = url.searchParams.has('cursor')
    ? decode(url.searchParams.get('cursor'))
    : null;
  if (
    cursor &&
    (cursor.v !== 1 ||
      cursor.type !== 'piles' ||
      cursor.owner !== owner ||
      !Number.isSafeInteger(cursor.time))
  )
    throw new AppError('Invalid pile cursor.');
  if (cursor) {
    counter(cursor.revision);
    id(cursor.id);
  }
  const [r, rows] = await db.batch([
    workspaceQuery(db, owner),
    db
      .prepare(
        `SELECT ${pileColumns} FROM piles p WHERE p.owner=? AND (?=0 OR (p.updated_at,p.id)<(?,?)) ORDER BY p.updated_at DESC,p.id DESC LIMIT ?`,
      )
      .bind(
        owner,
        cursor ? 1 : 0,
        cursor?.time ?? 0,
        cursor?.id ?? '',
        limit + 1,
      ),
  ]);
  const current = (r.results[0] as { revision: number }).revision;
  if (cursor && cursor.revision !== current)
    throw new ItemError(
      'cursor_stale',
      'The workspace changed. Restart the pile listing.',
    );
  const rowsPage = (rows.results as PileRow[]).slice(0, limit),
    last = rowsPage.at(-1);
  return {
    piles: rowsPage.map(summary),
    revision: current,
    nextCursor:
      rows.results.length > limit && last
        ? encode({
            v: 1,
            type: 'piles',
            owner,
            revision: current,
            time: last.updated_at,
            id: last.id,
          })
        : null,
  };
}
export async function readPile(db: D1Database, owner: string, pileId: string) {
  const [p, r] = await db.batch([
    pileQuery(db, owner, pileId),
    workspaceQuery(db, owner),
  ]);
  if (!p.results[0]) throw gone();
  return {
    pile: summary(p.results[0] as PileRow),
    revision: (r.results[0] as { revision: number }).revision,
  };
}

// Reuse F2's account-wide operation namespace and lifetime. These receipts have
// no FK to piles, so deletion and historical creation replay never recreate data.
type Receipt = { fingerprint: string; result: string };
type Outcome = {
  operationId: string;
  action: string;
  changed: boolean;
  committedAt: number;
  replayed: boolean;
  pile?: ReturnType<typeof summary>;
  pileId?: string;
  deleted?: boolean;
  pinned?: { kind: string; id: string }[];
};
const receiptQuery = (db: D1Database, owner: string, operationId: string) =>
  db
    .prepare(
      'SELECT fingerprint,result FROM pile_operations WHERE owner=? AND operation_id=?',
    )
    .bind(owner, operationId);
function replay(
  receipt: Receipt,
  fingerprint: string,
  replayed: boolean,
): Outcome {
  if (receipt.fingerprint !== fingerprint)
    throw new ItemError(
      'operation_conflict',
      'This operation identifier was already used for another change.',
    );
  return { ...JSON.parse(receipt.result), replayed };
}
const claimGuard =
  'EXISTS(SELECT 1 FROM piles WHERE owner=? AND id=? AND write_token=?)';

export async function createPile(
  db: D1Database,
  owner: string,
  input: unknown,
  accountId?: string,
) {
  const data = object(input);
  fields(data, ['operationId', 'name', 'color', 'members']);
  const operationId = id(data.operationId),
    pileName = name(data.name),
    pileColor = color(data.color === undefined ? 'blue' : data.color);
  const selection = data.members === undefined ? [] : data.members;
  if (!Array.isArray(selection) || selection.length > INITIAL_SELECTION_LIMIT)
    throw new AppError(
      `Initial selections may contain at most ${INITIAL_SELECTION_LIMIT} items.`,
    );
  const members = selection.map(itemReference);
  if (new Set(members.map(referenceKey)).size !== members.length)
    throw new AppError('Initial selection contains duplicate references.');
  const fingerprint = JSON.stringify({
    action: 'createPile',
    name: pileName,
    color: pileColor,
    members,
  });
  const receipt = receiptQuery(db, owner, operationId),
    old = await receipt.first<Receipt>();
  if (old) return replay(old, fingerprint, true);
  const pileId = crypto.randomUUID(),
    attempt = crypto.randomUUID(),
    now = Date.now();
  const result: Outcome = {
    operationId,
    action: 'createPile',
    changed: true,
    committedAt: now,
    replayed: false,
    pile: {
      id: pileId,
      name: pileName,
      color: pileColor,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      memberCount: members.length,
    },
  };
  let batch: D1Result[];
  try {
    batch = await db.batch([
      db
        .prepare(
          `INSERT INTO piles(id,owner,name,color,revision,created_at,updated_at,write_token) SELECT ?,?,?,?,1,?,?,? WHERE (? IS NULL OR EXISTS(SELECT 1 FROM auth_user u WHERE u.id=? AND COALESCE((SELECT owner FROM auth_legacy_owner WHERE user_id=u.id),u.id)=?)) AND (SELECT count(*) FROM piles WHERE owner=?)<? AND NOT EXISTS(SELECT 1 FROM pile_operations WHERE owner=? AND operation_id=?) RETURNING id`,
        )
        .bind(
          pileId,
          owner,
          pileName,
          pileColor,
          now,
          now,
          attempt,
          accountId ?? null,
          accountId ?? null,
          owner,
          owner,
          PILE_LIMIT,
          owner,
          operationId,
        ),
      // Each row passes the existing F2 source/owner/ready guard. Any failure
      // rolls back the pile AND every earlier member in this batch.
      db
        .prepare(
          `INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation) SELECT ?,?,json_extract(value,'$.kind'),json_extract(value,'$.id'),CAST(key AS INTEGER),1,? FROM json_each(?) WHERE ${claimGuard} ORDER BY CAST(key AS INTEGER)`,
        )
        .bind(
          pileId,
          owner,
          operationId,
          JSON.stringify(members),
          owner,
          pileId,
          attempt,
        ),
      db
        .prepare(
          `INSERT INTO pile_operations(owner,operation_id,pile_id,fingerprint,result) SELECT ?,?,?,?,? WHERE ${claimGuard}`,
        )
        .bind(
          owner,
          operationId,
          pileId,
          fingerprint,
          JSON.stringify(result),
          owner,
          pileId,
          attempt,
        ),
      receipt,
    ]);
  } catch (error) {
    if (!String(error).includes('item_gone')) throw error;
    const found = await db
      .prepare(
        `${itemCTE} SELECT kind,id FROM items WHERE owner=? AND EXISTS(SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.kind')=items.kind AND json_extract(j.value,'$.id')=items.id)`,
      )
      .bind(owner, JSON.stringify(members))
      .all<{ kind: 'text' | 'image' | 'document'; id: string }>();
    const keys = new Set(found.results.map(referenceKey)),
      missing = members.find((ref) => !keys.has(referenceKey(ref)));
    if (missing) return missingItem(db, owner, missing);
    throw new ItemError(
      'selection_changed',
      'The selection changed while saving. Refresh and try again.',
    );
  }
  const saved = batch.at(-1)!.results[0] as Receipt | undefined;
  if (
    !saved &&
    accountId &&
    !(await db
      .prepare(
        'SELECT 1 FROM auth_user u WHERE u.id=? AND COALESCE((SELECT owner FROM auth_legacy_owner WHERE user_id=u.id),u.id)=?',
      )
      .bind(accountId, owner)
      .first())
  )
    throw new AppError('This sign-in has expired. Sign in again.', 401);
  if (!saved)
    throw new ItemError(
      'limit_reached',
      `An account may have at most ${PILE_LIMIT} piles.`,
    );
  return replay(saved, fingerprint, batch[0].results.length === 0);
}

export async function updatePile(
  db: D1Database,
  owner: string,
  pileId: string,
  input: unknown,
) {
  const data = object(input);
  fields(data, ['operationId', 'revision', 'name', 'color']);
  const operationId = id(data.operationId),
    expected = revision(data.revision);
  if (data.name === undefined && data.color === undefined)
    throw new AppError('Supply a name or color.');
  const pileName = data.name === undefined ? null : name(data.name),
    pileColor = data.color === undefined ? null : color(data.color);
  const fingerprint = JSON.stringify({
    action: 'updatePile',
    pileId,
    expected,
    name: pileName,
    color: pileColor,
  });
  const receipt = receiptQuery(db, owner, operationId);
  const [p, o] = await db.batch([pileQuery(db, owner, pileId), receipt]);
  if (o.results[0]) return replay(o.results[0] as Receipt, fingerprint, true);
  const pile = p.results[0] as PileRow | undefined;
  if (!pile) throw gone();
  if (pile.revision !== expected) throw conflict();
  const nextName = pileName ?? pile.name,
    nextColor = pileColor ?? pile.color;
  const changed = nextName !== pile.name || nextColor !== pile.color,
    now = Date.now(),
    attempt = crypto.randomUUID();
  const result: Outcome = {
    operationId,
    action: 'updatePile',
    changed,
    committedAt: now,
    replayed: false,
    pile: {
      ...summary(pile),
      name: nextName,
      color: nextColor,
      revision: expected + Number(changed),
      updatedAt: changed ? now : pile.updated_at,
    },
  };
  const batch = await db.batch([
    db
      .prepare(
        `UPDATE piles SET name=?,color=?,revision=?,updated_at=?,write_token=? WHERE owner=? AND id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM pile_operations WHERE owner=? AND operation_id=?) RETURNING id`,
      )
      .bind(
        nextName,
        nextColor,
        result.pile!.revision,
        result.pile!.updatedAt,
        attempt,
        owner,
        pileId,
        expected,
        owner,
        operationId,
      ),
    db
      .prepare(
        `INSERT INTO pile_operations(owner,operation_id,pile_id,fingerprint,result) SELECT ?,?,?,?,? WHERE ${claimGuard}`,
      )
      .bind(
        owner,
        operationId,
        pileId,
        fingerprint,
        JSON.stringify(result),
        owner,
        pileId,
        attempt,
      ),
    receipt,
  ]);
  const saved = batch.at(-1)!.results[0] as Receipt | undefined;
  if (saved) return replay(saved, fingerprint, batch[0].results.length === 0);
  if (!(await pileQuery(db, owner, pileId).first())) throw gone();
  throw conflict();
}

async function impactSnapshot(db: D1Database, owner: string, pileId: string) {
  const [p, r, items] = await db.batch([
    pileQuery(db, owner, pileId),
    workspaceQuery(db, owner),
    db
      .prepare(
        `${itemCTE} SELECT items.* FROM items JOIN pile_members m ON m.owner=items.owner AND m.kind=items.kind AND m.item_id=items.id WHERE m.owner=? AND m.pile_id=? AND m.active=1 ORDER BY m.position,m.kind,m.item_id`,
      )
      .bind(owner, pileId),
  ]);
  if (!p.results[0]) throw gone();
  const pile = summary(p.results[0] as PileRow),
    current = (r.results[0] as { revision: number }).revision,
    asOf = Date.now();
  const exposed = (items.results as ItemRow[]).flatMap((row) => {
    const remaining = (JSON.parse(row.piles) as { id: string }[]).filter(
      (p) => p.id !== pileId,
    );
    const protection = itemProtection(
      { ...row, piles: JSON.stringify(remaining) },
      asOf,
    );
    return protection.cleanup.eligible
      ? [
          {
            ref: protection.ref,
            name: row.name,
            createdAt: row.createdAt,
            eligibleAfter: row.createdAt + 86400000,
            clearsAt: protection.cleanup.clearsAt!,
          },
        ]
      : [];
  });
  return {
    pile,
    revision: current,
    asOf,
    memberCount: pile.memberCount,
    exposed,
    impactToken: encode({
      v: 1,
      type: 'pile-delete',
      owner,
      pileId,
      pileRevision: pile.revision,
      revision: current,
    }),
    defaultMode: 'pin' as const,
  };
}
export const readPileDeletionImpact = impactSnapshot;

export async function deletePile(
  db: D1Database,
  owner: string,
  pileId: string,
  input: unknown,
) {
  const data = object(input);
  fields(data, [
    'operationId',
    'revision',
    'impactToken',
    'mode',
    'acknowledgeExposure',
  ]);
  const operationId = id(data.operationId),
    expected = revision(data.revision);
  if (data.mode !== 'pin' && data.mode !== 'expose')
    throw new AppError('Choose pin or expose.');
  if (
    data.acknowledgeExposure !== undefined &&
    typeof data.acknowledgeExposure !== 'boolean'
  )
    throw new AppError('Invalid exposure acknowledgment.');
  if (data.mode === 'expose' && data.acknowledgeExposure !== true)
    throw new AppError('Explicitly acknowledge cleanup exposure.');
  const token = decode(data.impactToken);
  if (
    token.v !== 1 ||
    token.type !== 'pile-delete' ||
    token.owner !== owner ||
    token.pileId !== pileId ||
    token.pileRevision !== expected
  )
    throw new AppError('Invalid deletion impact token.');
  const impactRevision = counter(token.revision);
  const fingerprint = JSON.stringify({
    action: 'deletePile',
    pileId,
    expected,
    impactToken: data.impactToken,
    mode: data.mode,
    acknowledgeExposure: data.acknowledgeExposure === true,
  });
  const receipt = receiptQuery(db, owner, operationId),
    old = await receipt.first<Receipt>();
  if (old) return replay(old, fingerprint, true);
  let impact: Awaited<ReturnType<typeof impactSnapshot>>;
  try {
    impact = await impactSnapshot(db, owner, pileId);
    if (impact.revision !== impactRevision || impact.pile.revision !== expected)
      throw staleImpact();
  } catch (error) {
    // An identical concurrent request may have committed after our receipt read.
    const concurrent = await receipt.first<Receipt>();
    if (concurrent) return replay(concurrent, fingerprint, true);
    throw error;
  }
  const attempt = crypto.randomUUID(),
    now = Date.now(),
    pinned = data.mode === 'pin' ? impact.exposed.map((item) => item.ref) : [];
  const result: Outcome = {
    operationId,
    action: 'deletePile',
    changed: true,
    committedAt: now,
    replayed: false,
    pileId,
    deleted: true,
    pinned,
  };
  const batch = await db.batch([
    // Check the entire protection snapshot at the serialization point, before
    // pinning can change workspace revision. The token then guards every step.
    db
      .prepare(
        `UPDATE piles SET write_token=? WHERE owner=? AND id=? AND revision=? AND COALESCE((SELECT revision FROM workspace_revision WHERE owner=?),0)=? AND NOT EXISTS(SELECT 1 FROM pile_operations WHERE owner=? AND operation_id=?) RETURNING id`,
      )
      .bind(
        attempt,
        owner,
        pileId,
        expected,
        owner,
        impactRevision,
        owner,
        operationId,
      ),
    ...(['text', 'image'] as const).map((kind) =>
      db
        .prepare(
          `UPDATE ${kind === 'text' ? 'clips' : 'clipboard_images'} SET pinned=1${kind === 'text' ? ',revision=revision+1,updated_at=?' : ''} WHERE owner=? AND pinned=0 AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?) WHERE json_extract(value,'$.kind')=?) AND ${claimGuard}`,
        )
        .bind(
          ...(kind === 'text' ? [now] : []),
          owner,
          JSON.stringify(pinned),
          kind,
          owner,
          pileId,
          attempt,
        ),
    ),
    db
      .prepare(
        `INSERT INTO pile_operations(owner,operation_id,pile_id,fingerprint,result) SELECT ?,?,?,?,? WHERE ${claimGuard}`,
      )
      .bind(
        owner,
        operationId,
        pileId,
        fingerprint,
        JSON.stringify(result),
        owner,
        pileId,
        attempt,
      ),
    db
      .prepare('DELETE FROM piles WHERE owner=? AND id=? AND write_token=?')
      .bind(owner, pileId, attempt),
    receipt,
  ]);
  const saved = batch.at(-1)!.results[0] as Receipt | undefined;
  if (saved) return replay(saved, fingerprint, batch[0].results.length === 0);
  if (!(await pileQuery(db, owner, pileId).first())) throw gone();
  throw staleImpact();
}
