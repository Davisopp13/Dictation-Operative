import { AppError, id, object, revision } from './domain';
import {
  itemReference,
  itemStatement,
  ItemError,
  missingItem,
  referenceKey,
  itemProtection,
  itemCTE,
  type ItemReference,
  type ItemRow,
} from './shared-items';

export const PILE_MEMBER_LIMIT = 500; // Includes retained Undo slots, until P1 adds compaction.
export const PILE_LIMIT = 100;
type Pile = {
  id: string;
  owner: string;
  name: string;
  color: string;
  revision: number;
  updated_at: number;
};
type Member = {
  kind: ItemReference['kind'];
  item_id: string;
  position: number;
  active: number;
  last_operation: string;
};
type Receipt = { fingerprint: string; result: string };
const memberKey = (m: Member) => referenceKey({ kind: m.kind, id: m.item_id });
const pileStatement = (db: D1Database, owner: string, pileId: string) =>
  db.prepare('SELECT * FROM piles WHERE owner=? AND id=?').bind(owner, pileId);
const membersStatement = (db: D1Database, owner: string, pileId: string) =>
  db
    .prepare(
      'SELECT * FROM pile_members WHERE owner=? AND pile_id=? ORDER BY position,kind,item_id',
    )
    .bind(owner, pileId);

export async function readPileMembers(
  db: D1Database,
  owner: string,
  pileId: string,
) {
  const [p, m, r] = await db.batch([
    pileStatement(db, owner, pileId),
    membersStatement(db, owner, pileId),
    db
      .prepare('SELECT revision FROM workspace_revision WHERE owner=?')
      .bind(owner),
  ]);
  const pile = p.results[0] as Pile | undefined;
  if (!pile)
    throw new ItemError('pile_gone', 'This pile no longer exists.', 404);
  return {
    pile: {
      id: pile.id,
      name: pile.name,
      color: pile.color,
      revision: pile.revision,
      updatedAt: pile.updated_at,
    },
    members: (m.results as Member[])
      .filter((x) => x.active)
      .map((x) => ({
        ref: { kind: x.kind, id: x.item_id },
        position: x.position,
      })),
    revision: (r.results[0] as { revision: number } | undefined)?.revision ?? 0,
  };
}

/** A bounded CAS batch. Receipt replay cannot undo a later member change. */
export async function writePileMember(
  db: D1Database,
  owner: string,
  pileId: string,
  input: unknown,
) {
  const data = object(input),
    ref = itemReference(data.ref),
    operationId = id(data.operationId),
    expected = revision(data.revision);
  if (
    !['add', 'remove', 'removeAndPin', 'move', 'restore'].includes(
      String(data.action),
    )
  )
    throw new AppError('Unknown membership action.');
  const action = data.action as
    | 'add'
    | 'remove'
    | 'removeAndPin'
    | 'move'
    | 'restore';
  const before =
    data.before === undefined || data.before === null
      ? null
      : itemReference(data.before);
  if (before && action !== 'move')
    throw new AppError('Only a move accepts a before reference.');
  const undo = action === 'restore' ? id(data.undoOperationId) : null;
  const fingerprint = JSON.stringify({
    pileId,
    ref,
    expected,
    action,
    before,
    undo,
  });
  const receiptStatement = db
    .prepare(
      'SELECT fingerprint,result FROM pile_operations WHERE owner=? AND operation_id=?',
    )
    .bind(owner, operationId);
  const [p, m, i, o] = await db.batch([
    pileStatement(db, owner, pileId),
    membersStatement(db, owner, pileId),
    itemStatement(db, owner, ref),
    receiptStatement,
  ]);
  const old = o.results[0] as Receipt | undefined;
  if (old) {
    if (old.fingerprint !== fingerprint)
      throw new ItemError(
        'operation_conflict',
        'This operation identifier was already used for another change.',
      );
    const saved = JSON.parse(old.result);
    return {
      ...saved,
      item: itemProtection(saved.item, saved.committedAt),
      replayed: true,
    };
  }
  const pile = p.results[0] as Pile | undefined,
    source = i.results[0] as ItemRow | undefined;
  if (!pile)
    throw new ItemError('pile_gone', 'This pile no longer exists.', 404);
  if (!source) return missingItem(db, owner, ref);
  if (pile.revision !== expected)
    throw new ItemError(
      'revision_conflict',
      'This pile changed elsewhere. Refresh it before trying again.',
    );
  const members = m.results as Member[],
    key = referenceKey(ref),
    member = members.find((x) => memberKey(x) === key);
  const order = members.map(memberKey);
  let changed = false;
  if (action === 'add') {
    if (!member && members.length >= PILE_MEMBER_LIMIT)
      throw new ItemError(
        'limit_reached',
        'This pile has reached its member limit.',
      );
    if (!member?.active) {
      const at = order.indexOf(key);
      if (at >= 0) order.splice(at, 1);
      order.push(key);
      changed = true;
    }
  } else if (action === 'restore') {
    if (!member || member.active || member.last_operation !== undo)
      throw new ItemError(
        'revision_conflict',
        'This removal can no longer be undone.',
      );
    const removed = await db
      .prepare(
        'SELECT result FROM pile_operations WHERE owner=? AND operation_id=? AND pile_id=?',
      )
      .bind(owner, undo, pileId)
      .first<{ result: string }>();
    if (
      !removed ||
      !['remove', 'removeAndPin'].includes(JSON.parse(removed.result).action)
    )
      throw new ItemError(
        'revision_conflict',
        'This removal can no longer be undone.',
      );
    changed = true;
  } else if (action === 'move') {
    if (!member?.active)
      throw new ItemError(
        'membership_gone',
        'The item is no longer in this pile.',
        404,
      );
    const target = before
      ? members.find((x) => memberKey(x) === referenceKey(before) && x.active)
      : null;
    if (before && !target)
      throw new ItemError(
        'membership_gone',
        'The destination is no longer in this pile.',
        404,
      );
    if (!before || referenceKey(before) !== key) {
      order.splice(order.indexOf(key), 1);
      order.splice(
        target ? order.indexOf(memberKey(target)) : order.length,
        0,
        key,
      );
    }
    changed = order.some((k, index) => k !== memberKey(members[index]));
  } else
    changed = !!member?.active || (action === 'removeAndPin' && !source.pinned);
  const now = Date.now(),
    nextRevision = expected + (changed ? 1 : 0);
  // The token and receipt predicates make concurrent identical requests execute once.
  const guard = `EXISTS(SELECT 1 FROM piles WHERE owner=? AND id=? AND revision=? AND write_token=?) AND NOT EXISTS(SELECT 1 FROM pile_operations WHERE owner=? AND operation_id=?)`;
  const args = [owner, pileId, nextRevision, operationId, owner, operationId];
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE piles SET revision=?,updated_at=CASE WHEN ? THEN ? ELSE updated_at END,write_token=? WHERE owner=? AND id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM pile_operations WHERE owner=? AND operation_id=?) AND EXISTS(SELECT 1 FROM ${ref.kind === 'text' ? 'clips' : ref.kind === 'image' ? 'clipboard_images' : 'content_items'} WHERE owner=? AND id=? ${ref.kind === 'document' ? "AND state='ready'" : ''} AND (?=0 OR ${ref.kind === 'text' ? 'revision' : 'item_revision'}=?)) RETURNING id`,
      )
      .bind(
        nextRevision,
        changed ? 1 : 0,
        now,
        operationId,
        owner,
        pileId,
        expected,
        owner,
        operationId,
        owner,
        ref.id,
        action === 'removeAndPin' ? 1 : 0,
        source.revision,
      ),
  ];
  if (changed) {
    if (action === 'add' || action === 'restore')
      statements.push(
        db
          .prepare(
            `INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation) SELECT ?,?,?,?,?,1,? WHERE ${guard} ON CONFLICT(pile_id,kind,item_id) DO UPDATE SET active=1,last_operation=excluded.last_operation`,
          )
          .bind(
            pileId,
            owner,
            ref.kind,
            ref.id,
            order.indexOf(key),
            operationId,
            ...args,
          ),
      );
    if (action === 'remove' || action === 'removeAndPin')
      statements.push(
        db
          .prepare(
            `UPDATE pile_members SET active=0,last_operation=? WHERE owner=? AND pile_id=? AND kind=? AND item_id=? AND active=1 AND ${guard}`,
          )
          .bind(operationId, owner, pileId, ref.kind, ref.id, ...args),
      );
    if (action === 'move')
      statements.push(
        db
          .prepare(
            `UPDATE pile_members SET last_operation=? WHERE owner=? AND pile_id=? AND kind=? AND item_id=? AND ${guard}`,
          )
          .bind(operationId, owner, pileId, ref.kind, ref.id, ...args),
      );
    if (action === 'add' || action === 'move')
      statements.push(
        db
          .prepare(
            `UPDATE pile_members SET position=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=pile_members.kind||':'||pile_members.item_id) WHERE owner=? AND pile_id=? AND ${guard}`,
          )
          .bind(JSON.stringify(order), owner, pileId, ...args),
      );
    if (action === 'removeAndPin') {
      const table =
        ref.kind === 'text'
          ? 'clips'
          : ref.kind === 'image'
            ? 'clipboard_images'
            : 'content_items';
      statements.push(
        db
          .prepare(
            `UPDATE ${table} SET pinned=1${ref.kind === 'text' ? ',revision=revision+1,updated_at=' + now : ''} WHERE owner=? AND id=? AND pinned=0 AND ${guard}`,
          )
          .bind(owner, ref.id, ...args),
      );
    }
  }
  // Store the outcome and cleanup snapshot inside the same transaction. Subsequent
  // replays return that historical result (not a new assertion of current state).
  const resultBase = JSON.stringify({
    operationId,
    action,
    ref,
    changed,
    pileRevision: nextRevision,
    committedAt: now,
    replayed: false,
  });
  statements.push(
    db
      .prepare(
        `INSERT INTO pile_operations(owner,operation_id,pile_id,fingerprint,result) SELECT ?,?,?,?,json_set(?, '$.item',json((${itemStatementSQL()}))) WHERE ${guard}`,
      )
      .bind(
        owner,
        operationId,
        pileId,
        fingerprint,
        resultBase,
        owner,
        ref.kind,
        ref.id,
        ...args,
      ),
  );
  statements.push(receiptStatement);
  let result: D1Result[];
  try {
    result = await db.batch(statements);
  } catch (error) {
    if (String(error).includes('item_gone')) return missingItem(db, owner, ref);
    if (String(error).includes('pile_gone'))
      throw new ItemError('pile_gone', 'This pile no longer exists.', 404);
    throw error;
  }
  const receipt = result.at(-1)!.results[0] as Receipt | undefined;
  if (!receipt) {
    if (!(await itemStatement(db, owner, ref).first()))
      return missingItem(db, owner, ref);
    if (!(await pileStatement(db, owner, pileId).first()))
      throw new ItemError('pile_gone', 'This pile no longer exists.', 404);
    throw new ItemError(
      'revision_conflict',
      'This pile changed elsewhere. Refresh it before trying again.',
    );
  }
  if (receipt.fingerprint !== fingerprint)
    throw new ItemError(
      'operation_conflict',
      'This operation identifier was already used for another change.',
    );
  const saved = JSON.parse(receipt.result);
  // Convert the stored database snapshot to the public typed view, fixing time to
  // commit time so duplicate retries return exactly the same cleanup schedule.
  return {
    ...saved,
    item: itemProtection(saved.item, saved.committedAt),
    replayed: result[0].results.length === 0,
  };
}

function itemStatementSQL() {
  return `${itemCTE} SELECT json_object('owner',owner,'kind',kind,'id',id,'pinned',pinned,'revision',revision,'createdAt',createdAt,'sortTime',sortTime,'clipboardItem',clipboardItem,'history',history,'cleanupEnabled',cleanupEnabled,'piles',piles) FROM items WHERE owner=? AND kind=? AND id=?`;
}
