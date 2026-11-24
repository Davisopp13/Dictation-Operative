import { AppError, type Clip, type ClipSummary } from './domain';
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
  if (!row) throw new AppError('Thought not found.', 404);
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
export async function insertClip(
  db: D1Database,
  owner: string,
  clip: Clip,
  clipboardItem = false,
) {
  await db
    .prepare(
      'INSERT INTO clips (id,owner,title,kind,content,original,context,segments,versions,collection,tags,pinned,revision,created_at,updated_at,clipboard_item) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
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
    )
    .run();
  return getClip(db, owner, clip.id);
}
export async function saveClip(
  db: D1Database,
  owner: string,
  clip: Clip,
  previousRevision: number,
) {
  const result = await db
    .prepare(
      'UPDATE clips SET title=?,content=?,original=?,segments=?,versions=?,collection=?,tags=?,pinned=?,revision=?,updated_at=?,clipboard_item=CASE WHEN ? THEN 0 ELSE clipboard_item END WHERE owner=? AND id=? AND revision=?',
    )
    .bind(
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
    )
    .run();
  if (result.meta.changes !== 1)
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
  const r = await db
    .prepare('DELETE FROM clips WHERE owner=? AND id=? AND revision=?')
    .bind(owner, id, revision)
    .run();
  if (r.meta.changes !== 1)
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
