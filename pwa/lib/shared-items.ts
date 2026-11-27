import { AppError, id, object } from './domain';
import { contentPreview } from './content-model';
import { pageLimit } from './cursor';

export type ItemReference = { kind: 'text' | 'image' | 'document'; id: string };
export type CleanupStatus = {
  eligible: boolean;
  reason:
    | 'pinned'
    | 'pile'
    | 'tray'
    | 'document'
    | 'legacy'
    | 'history'
    | 'collection_pending'
    | null;
  clearsAt: number | null;
};
export class ItemError extends AppError {
  constructor(
    public code: string,
    message: string,
    status = 409,
  ) {
    super(message, status);
  }
}
export function itemReference(value: unknown): ItemReference {
  const input = object(value);
  if (
    typeof input.kind !== 'string' ||
    !['text', 'image', 'document'].includes(input.kind)
  )
    throw new AppError('Unknown item kind.');
  return { kind: input.kind as ItemReference['kind'], id: id(input.id) };
}
export const referenceKey = (ref: ItemReference) => `${ref.kind}:${ref.id}`;
export type ItemRow = {
  owner: string;
  kind: ItemReference['kind'];
  id: string;
  name: string;
  excerpt: string;
  contentLength: number;
  contentKind: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  url: string;
  filename: string;
  pinned: number;
  revision: number;
  createdAt: number;
  sortTime: number;
  clipboardItem: number;
  history: number;
  cleanupEnabled: number;
  collection: string;
  collectionSynced: number;
  collectionPile: string | null;
  collectionPending: number;
  piles: string;
};
// Keep sources in their existing stores; only ready documents are user items.
export const itemCTE = `WITH sources AS (
 SELECT owner,'text' AS kind,id,title AS name,substr(content,1,500) AS excerpt,length(content) AS contentLength,
 '' AS contentKind,'text/plain' AS mime,0 AS size,0 AS width,0 AS height,'' AS url,'' AS filename,
 pinned,revision,created_at AS createdAt,updated_at AS sortTime,clipboard_item AS clipboardItem,
 CASE WHEN json_array_length(segments)>1 THEN 1 ELSE 0 END AS history,collection,collection_synced AS collectionSynced FROM clips
 UNION ALL SELECT owner,'image',id,name,'',0,'','image/png',size,width,height,'','',pinned,item_revision,created_at,created_at,1,0,'',1 FROM clipboard_images
 UNION ALL SELECT owner,'document',id,name,'',0,kind,mime,size,0,0,url,filename,pinned,item_revision,created_at,created_at,0,0,'',1 FROM content_items WHERE state='ready'
), items AS (
 SELECT sources.*,CASE WHEN kind='text' AND collection<>'' AND collectionSynced=0 THEN 1 ELSE 0 END AS collectionPending,
 (SELECT pile_id FROM collection_mappings WHERE owner=sources.owner AND collection_key=sources.collection) AS collectionPile,COALESCE((SELECT clipboard_daily_cleanup FROM preferences WHERE owner=sources.owner),0) AS cleanupEnabled,
 (SELECT json_group_array(json_object('id',p.id,'name',p.name,'color',p.color)) FROM piles p
 WHERE p.owner=sources.owner AND EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=p.id AND m.owner=sources.owner AND m.kind=sources.kind AND m.item_id=sources.id AND m.active=1)) AS piles
 FROM sources
)`;
export const itemStatement = (
  db: D1Database,
  owner: string,
  ref: ItemReference,
) =>
  db
    .prepare(`${itemCTE} SELECT * FROM items WHERE owner=? AND kind=? AND id=?`)
    .bind(owner, ref.kind, ref.id);

/** Strictly older than 24h at 08:00 UTC, never at the exact 24h boundary. */
export function nextCleanup(createdAt: number, now: number) {
  const day = 86400000,
    hour = 8 * 3600000;
  const threshold = Math.max(createdAt + day, now);
  const candidate = Math.floor(threshold / day) * day + hour;
  return candidate > threshold ? candidate : candidate + day;
}
export type ProtectionRow = Pick<
  ItemRow,
  | 'kind'
  | 'id'
  | 'pinned'
  | 'revision'
  | 'piles'
  | 'clipboardItem'
  | 'history'
  | 'cleanupEnabled'
  | 'createdAt'
> & { collectionPending?: number };
export function itemProtection(row: ProtectionRow, now: number) {
  const piles = JSON.parse(row.piles) as {
    id: string;
    name: string;
    color: string;
  }[];
  const reason: CleanupStatus['reason'] = row.pinned
    ? 'pinned'
    : piles.length
      ? 'pile'
      : row.collectionPending
        ? 'collection_pending'
        : row.kind === 'document'
          ? 'document'
          : row.history
            ? 'history'
            : !row.clipboardItem
              ? 'legacy'
              : null;
  const eligible = !!row.cleanupEnabled && reason === null;
  return {
    ref: { kind: row.kind, id: row.id } as ItemReference,
    pinned: !!row.pinned,
    revision: row.revision,
    piles,
    cleanup: {
      eligible,
      reason,
      clearsAt: eligible ? nextCleanup(row.createdAt, now) : null,
    } satisfies CleanupStatus,
  };
}
export function sharedItem(row: ItemRow, now = Date.now()) {
  const preview =
    row.kind === 'document' && row.contentKind === 'file'
      ? contentPreview(row.mime)
      : null;
  return {
    ...itemProtection(row, now),
    name: row.name,
    displayKind:
      row.kind === 'text'
        ? 'note'
        : row.kind === 'image'
          ? 'image'
          : row.contentKind === 'link'
            ? 'google-link'
            : (preview ?? 'file'),
    contentKind: row.kind === 'document' ? row.contentKind : null,
    preview: {
      excerpt: row.excerpt,
      contentLength: row.contentLength,
      mime: row.mime,
      size: row.size,
      width: row.width,
      height: row.height,
      filename: row.filename,
      url: row.url,
      host: row.url ? new URL(row.url).hostname : null,
    },
    createdAt: row.createdAt,
    sortTime: row.sortTime,
    // T1 will resolve live pile and individual entries. No tray exists in F2.
    tray: { available: false as const, member: false as const },
    capabilities: {
      copy:
        row.kind === 'text'
          ? 'text'
          : row.kind === 'image'
            ? 'image-if-supported'
            : null,
      preview:
        row.kind === 'text'
          ? 'editor'
          : row.kind === 'image'
            ? 'image'
            : preview,
      open:
        row.kind === 'document' && row.contentKind === 'link'
          ? 'external'
          : null,
      print:
        row.kind === 'text' ||
        row.kind === 'image' ||
        preview === 'pdf' ||
        preview === 'image',
      download: row.kind !== 'document' || row.contentKind === 'file',
      play: preview === 'audio' || preview === 'video',
      sendToDevice: row.kind === 'text' || row.kind === 'image',
      share: false,
    },
  };
}
export type SharedItem = ReturnType<typeof sharedItem>;
export async function missingItem(
  db: D1Database,
  owner: string,
  ref: ItemReference,
): Promise<never> {
  const tombstone = await db
    .prepare(
      'SELECT reason FROM item_deletions WHERE owner=? AND kind=? AND item_id=?',
    )
    .bind(owner, ref.kind, ref.id)
    .first<{ reason: string }>();
  throw tombstone?.reason === 'cleared'
    ? new ItemError(
        'item_cleared',
        'This item was cleared by daily cleanup before it could be added.',
        410,
      )
    : new ItemError('item_gone', 'This item no longer exists.', 404);
}

type DeskCursor = {
  v: 1;
  owner: string;
  revision: number;
  time: number;
  kind: ItemReference['kind'];
  id: string;
};
function decode(value: string | null, owner: string): DeskCursor | null {
  if (!value) return null;
  try {
    if (value.length > 2000) throw Error();
    const c = JSON.parse(
      decodeURIComponent(atob(value.replace(/-/g, '+').replace(/_/g, '/'))),
    ) as DeskCursor;
    if (
      c.v !== 1 ||
      c.owner !== owner ||
      !Number.isSafeInteger(c.revision) ||
      c.revision < 0 ||
      !Number.isSafeInteger(c.time)
    )
      throw Error();
    itemReference(c);
    return c;
  } catch {
    throw new AppError('Invalid shared item cursor.');
  }
}
export async function listSharedItems(db: D1Database, owner: string, url: URL) {
  // Unified search is S1; reject ignored filters instead of implying broad search.
  for (const key of url.searchParams.keys())
    if (!['cursor', 'limit'].includes(key))
      throw new AppError('Unsupported shared item filter.');
  const limit = pageLimit(url.searchParams.get('limit')),
    cursor = decode(url.searchParams.get('cursor'), owner);
  const [revisionResult, rows] = await db.batch([
    db
      .prepare(
        'SELECT COALESCE((SELECT revision FROM workspace_revision WHERE owner=?),0) AS revision',
      )
      .bind(owner),
    db
      .prepare(
        `${itemCTE} SELECT * FROM items WHERE owner=? AND (?=0 OR (sortTime,kind,id)<(?,?,?)) ORDER BY sortTime DESC,kind DESC,id DESC LIMIT ?`,
      )
      .bind(
        owner,
        cursor ? 1 : 0,
        cursor?.time ?? 0,
        cursor?.kind ?? '',
        cursor?.id ?? '',
        limit + 1,
      ),
  ]);
  const revision = (revisionResult.results[0] as { revision: number }).revision;
  if (cursor && cursor.revision !== revision)
    throw new ItemError(
      'cursor_stale',
      'The workspace changed. Restart the shared item listing.',
    );
  const items = (rows.results as ItemRow[]).slice(0, limit),
    last = items.at(-1);
  const nextCursor =
    rows.results.length > limit && last
      ? btoa(
          encodeURIComponent(
            JSON.stringify({
              v: 1,
              owner,
              revision,
              time: last.sortTime,
              kind: last.kind,
              id: last.id,
            }),
          ),
        )
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
      : null;
  return { items: items.map((row) => sharedItem(row)), nextCursor, revision };
}
