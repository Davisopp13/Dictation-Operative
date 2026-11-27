import { AppError, type Clip, type ClipSummary } from './domain';
import { liveAccountSQL, liveAccountArgs } from './collection-mapping';
import { page, type Cursor } from './cursor';
type Row = {
  id: string;
  owner: string;
  title: string;
  kind: Clip['kind'];
  content: string;
  original: string;
  context: string;
  segments: string;
  versions: string;
  collection: string;
  tags: string;
  pinned: number;
  revision: number;
  created_at: number;
  updated_at: number;
};
function decode(row: Row): Clip {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    content: row.content,
    original: row.original,
    context: row.context,
    segments: JSON.parse(row.segments),
    versions: JSON.parse(row.versions),
    collection: row.collection,
    tags: JSON.parse(row.tags),
    pinned: !!row.pinned,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function getClip(
  db: D1Database,
  owner: string,
  id: string,
): Promise<Clip> {
  const row = await db
    .prepare('SELECT * FROM clips WHERE owner = ? AND id = ?')
    .bind(owner, id)
    .first<Row>();
  if (!row) throw new AppError('Text not found.', 404);
  return decode(row);
}
export async function listClips(
  db: D1Database,
  owner: string,
  query: string,
  pinned: boolean,
  offset: number,
  collection = '',
  tag = '',
) {
  const pattern = '%' + query.replace(/[!%_]/g, '!$&') + '%';
  const { results } = await db
    .prepare(
      "SELECT id,title,kind,substr(content,1,500) AS content,collection,tags,pinned,revision,created_at,updated_at FROM clips WHERE owner = ? AND (? = 0 OR pinned = 1) AND (title LIKE ? ESCAPE '!' OR content LIKE ? ESCAPE '!' OR original LIKE ? ESCAPE '!') AND (? = '' OR collection = ?) AND (? = '' OR EXISTS (SELECT 1 FROM json_each(clips.tags) WHERE value = ?)) ORDER BY updated_at DESC, id DESC LIMIT 51 OFFSET ?",
    )
    .bind(
      owner,
      pinned ? 1 : 0,
      pattern,
      pattern,
      pattern,
      collection,
      collection,
      tag,
      tag,
      offset,
    )
    .all<Row>();
  const items: ClipSummary[] = results.slice(0, 50).map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    content: r.content,
    collection: r.collection,
    tags: JSON.parse(r.tags),
    pinned: !!r.pinned,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  return { items, hasMore: results.length > 50 };
}
/**
 * One /api/v1 page of saved text, newest change first. `contentLength` lets a
 * client tell when the 500-character preview is not the whole text.
 */
export async function listClipsPage(
  db: D1Database,
  owner: string,
  options: {
    query: string;
    pinned: boolean;
    collection: string;
    tag: string;
    cursor: Cursor | null;
    limit: number;
  },
) {
  const { query, pinned, collection, tag, cursor, limit } = options;
  const pattern = '%' + query.replace(/[!%_]/g, '!$&') + '%';
  const { results } = await db
    .prepare(
      "SELECT id,title,kind,substr(content,1,500) AS content,length(content) AS content_length,collection,tags,pinned,revision,created_at,updated_at FROM clips WHERE owner = ? AND (? = 0 OR pinned = 1) AND (title LIKE ? ESCAPE '!' OR content LIKE ? ESCAPE '!' OR original LIKE ? ESCAPE '!') AND (? = '' OR collection = ?) AND (? = '' OR EXISTS (SELECT 1 FROM json_each(clips.tags) WHERE value = ?)) AND (? = 0 OR updated_at < ? OR (updated_at = ? AND id < ?)) ORDER BY updated_at DESC, id DESC LIMIT ?",
    )
    .bind(
      owner,
      pinned ? 1 : 0,
      pattern,
      pattern,
      pattern,
      collection,
      collection,
      tag,
      tag,
      cursor ? 1 : 0,
      cursor?.time ?? 0,
      cursor?.time ?? 0,
      cursor?.id ?? '',
      limit + 1,
    )
    .all<Row & { content_length: number }>();
  const listed = page(results, limit, (r) => ({
    time: r.updated_at,
    id: r.id,
  }));
  return {
    items: listed.items.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      content: r.content,
      contentLength: r.content_length,
      collection: r.collection,
      tags: JSON.parse(r.tags) as string[],
      pinned: !!r.pinned,
      revision: r.revision,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    nextCursor: listed.nextCursor,
  };
}
/** Who owns an identifier, across all accounts. Identifiers are global. */
export async function clipOwner(db: D1Database, id: string) {
  const row = await db
    .prepare('SELECT owner FROM clips WHERE id=?')
    .bind(id)
    .first<{ owner: string }>();
  return row?.owner ?? null;
}
export async function insertClip(
  db: D1Database,
  owner: string,
  clip: Clip,
  clipboardItem = false,
  accountId?: string,
) {
  const insert = db
    .prepare(
      `INSERT INTO clips (id,owner,title,kind,content,original,context,segments,versions,collection,tags,pinned,revision,created_at,updated_at,clipboard_item,collection_synced) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1 WHERE ${liveAccountSQL} ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      clip.id,
      owner,
      clip.title,
      clip.kind,
      clip.content,
      clip.original,
      clip.context,
      JSON.stringify(clip.segments),
      JSON.stringify(clip.versions),
      clip.collection,
      JSON.stringify(clip.tags),
      clip.pinned ? 1 : 0,
      1,
      clip.createdAt,
      clip.updatedAt,
      clipboardItem ? 1 : 0,
      ...liveAccountArgs(owner, accountId),
    );
  await insert.run();
  return getClip(db, owner, clip.id);
}
export async function saveClip(
  db: D1Database,
  owner: string,
  clip: Clip,
  previousRevision: number,
  workspaceRevision?: unknown,
) {
  if (
    workspaceRevision !== undefined &&
    (!Number.isSafeInteger(workspaceRevision) || Number(workspaceRevision) < 0)
  )
    throw new AppError('Invalid workspace revision.');
  // RETURNING, not the reported change count: D1 counts trigger writes too.
  const update = db
    .prepare(
      'UPDATE clips SET collection_synced=CASE WHEN collection<>? THEN 1 ELSE collection_synced END,title=?,content=?,original=?,segments=?,versions=?,collection=?,tags=?,pinned=?,revision=?,updated_at=?,clipboard_item=CASE WHEN ? THEN 0 ELSE clipboard_item END WHERE owner=? AND id=? AND revision=? AND (? IS NULL OR COALESCE((SELECT revision FROM workspace_revision WHERE owner=?),0)=?) RETURNING id',
    )
    .bind(
      clip.collection,
      clip.title,
      clip.content,
      clip.original,
      JSON.stringify(clip.segments),
      JSON.stringify(clip.versions),
      clip.collection,
      JSON.stringify(clip.tags),
      clip.pinned ? 1 : 0,
      clip.revision,
      clip.updatedAt,
      clip.segments.length > 1 ? 1 : 0,
      owner,
      clip.id,
      previousRevision,
      workspaceRevision ?? null,
      owner,
      workspaceRevision ?? null,
    );
  const result = await update.all();
  if (result.results.length !== 1)
    throw new AppError(
      'This text changed elsewhere. Reopen it before saving; your unsaved text is still here.',
      409,
    );
  return clip;
}
export async function deleteClip(
  db: D1Database,
  owner: string,
  id: string,
  revision: number,
) {
  const [r] = await db.batch([
    db
      .prepare(
        'DELETE FROM clips WHERE owner=? AND id=? AND revision=? RETURNING id',
      )
      .bind(owner, id, revision),
  ]);
  if (r.results.length !== 1)
    throw new AppError(
      'This text changed elsewhere. Reopen it before deleting.',
      409,
    );
}
export async function getPreferences(db: D1Database, owner: string) {
  return (
    (await db
      .prepare(
        'SELECT encrypted_key,consent,model,clipboard_daily_cleanup FROM preferences WHERE owner=?',
      )
      .bind(owner)
      .first<{
        encrypted_key: string | null;
        consent: number;
        model: string;
        clipboard_daily_cleanup: number;
      }>()) ?? {
      encrypted_key: null,
      model: 'openai/gpt-oss-120b',
      consent: 0,
      clipboard_daily_cleanup: 0,
    }
  );
}
