import { AppError, id, object, text } from './domain';
import { readBounded } from './request';
import { decodeCursor, page, pageLimit } from './cursor';
import {
  CONTENT_FILE_LIMIT,
  CONTENT_ACCOUNT_LIMIT,
  CONTENT_ITEM_LIMIT,
  contentLink,
  contentInline,
  contentType,
  type ContentItem,
} from './content-model';

export type ContentStore = Pick<R2Bucket, 'put' | 'get' | 'head' | 'delete'>;
export type ContentServices = {
  db: D1Database;
  owner: string;
  content?: ContentStore;
};
const columns =
  'id,kind,name,filename,mime,size,url,pinned,created_at AS createdAt,state';

type Row = Omit<ContentItem, 'pinned'> & {
  pinned: number;
  object_key: string;
  state: string;
  expires_at: number;
};
export type ContentState = 'uploading' | 'writing' | 'ready';
/** The /api/v1 shape: the saved item plus where its upload stands. */
export type ContentItemState = ContentItem & { state: ContentState };
const decode = (r: Row): ContentItem => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  url: r.url,
  pinned: !!r.pinned,
  createdAt: r.createdAt,
});
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const usageSQL =
  '(SELECT COALESCE(SUM(size),0) FROM content_items WHERE owner=?) + (SELECT COALESCE(SUM(size),0) FROM content_deletion_queue WHERE owner=?)';
async function input(request: Request) {
  try {
    return object(
      JSON.parse(new TextDecoder().decode(await readBounded(request, 4096))),
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('The Content request could not be read.');
  }
}

/** A single byte range, clamped at EOF. Malformed/multiple/unsatisfiable ranges fail closed. */
export function contentRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]))
    throw new AppError('Invalid byte range.', 416);
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      throw new AppError('Invalid byte range.', 416);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= size ||
      end < start
    )
      throw new AppError('Invalid byte range.', 416);
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}

export async function deleteQueuedContent(
  db: D1Database,
  store: Pick<ContentStore, 'delete'>,
  key: string,
) {
  if (
    !(await db
      .prepare(
        'SELECT object_key FROM content_deletion_queue WHERE object_key=?',
      )
      .bind(key)
      .first())
  )
    return;
  await store.delete(key);
  await db
    .prepare('DELETE FROM content_deletion_queue WHERE object_key=?')
    .bind(key)
    .run();
}

/** Only abandoned uploads expire. Ready files and links never expire, including unpinned ones. */
export async function runContentCleanup(
  db: D1Database,
  store: Pick<ContentStore, 'delete'>,
  now = Date.now(),
) {
  await db
    .prepare("DELETE FROM content_items WHERE state<>'ready' AND expires_at<?")
    .bind(now)
    .run();
  // A cursor moves past keys that failed, so one stuck file cannot block the
  // rest of the queue. Failures stay queued for the next daily run.
  let cursor = '',
    failed = 0,
    drained = false;
  for (let page = 0; page < 50; page++) {
    const keys = await db
      .prepare(
        'SELECT object_key FROM content_deletion_queue WHERE object_key>? ORDER BY object_key LIMIT 100',
      )
      .bind(cursor)
      .all<{ object_key: string }>();
    for (const { object_key: key } of keys.results) {
      try {
        await deleteQueuedContent(db, store, key);
      } catch {
        failed++;
      }
      cursor = key;
    }
    if (keys.results.length < 100) {
      drained = true;
      break;
    }
  }
  if (failed || !drained)
    throw new Error('Content file deletion is queued for retry.');
}

/**
 * `v1` selects the /api/v1 contract on the same storage: responses carry the
 * upload `state`, a reservation may bring its own identifier and is then an
 * idempotent create, an item's state can be read, and repeating a finished
 * upload returns the saved item instead of an error.
 */
export async function handleContent(
  request: Request,
  s: ContentServices,
  path: string,
  v1 = false,
) {
  const url = new URL(request.url);
  const shape = (r: Row): ContentItem | ContentItemState =>
    v1 ? { ...decode(r), state: r.state as ContentState } : decode(r);
  if (path === 'content' && request.method === 'GET') {
    const q = text(url.searchParams.get('q') ?? '', 'Search', 200, true);
    const pinnedOnly = url.searchParams.get('pinned') === 'true' ? 1 : 0;
    const filter = `owner=? AND state='ready' AND (?=0 OR pinned=1) AND instr(lower(name || ' ' || filename),lower(?))>0`;
    let listing: Record<string, unknown>;
    if (v1) {
      const limit = pageLimit(url.searchParams.get('limit'), 40);
      const cursor = decodeCursor(url.searchParams.get('cursor'));
      const result = await s.db
        .prepare(
          `SELECT ${columns} FROM content_items WHERE ${filter} AND (?=0 OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .bind(
          s.owner,
          pinnedOnly,
          q,
          cursor ? 1 : 0,
          cursor?.time ?? 0,
          cursor?.time ?? 0,
          cursor?.id ?? '',
          limit + 1,
        )
        .all<Row>();
      const listed = page(result.results, limit, (r) => ({
        time: r.createdAt,
        id: r.id,
      }));
      listing = { items: listed.items.map(shape), nextCursor: listed.nextCursor };
    } else {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > CONTENT_ITEM_LIMIT
      )
        throw new AppError('Invalid page.');
      const result = await s.db
        .prepare(
          `SELECT ${columns} FROM content_items WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT 41 OFFSET ?`,
        )
        .bind(s.owner, pinnedOnly, q, offset)
        .all<Row>();
      listing = {
        items: result.results.slice(0, 40).map(decode),
        hasMore: result.results.length > 40,
      };
    }
    const usage = await s.db
      .prepare(
        `SELECT ${usageSQL} AS usedBytes, ((SELECT COALESCE(SUM(size),0) FROM content_deletion_queue WHERE owner=?) + (SELECT COALESCE(SUM(size),0) FROM content_items WHERE owner=? AND state<>'ready')) AS pendingBytes, (SELECT COUNT(*) FROM content_items WHERE owner=?) AS itemCount`,
      )
      .bind(s.owner, s.owner, s.owner, s.owner, s.owner)
      .first();
    return json({
      ...listing,
      ...usage,
      fileLimit: CONTENT_FILE_LIMIT,
      accountLimit: CONTENT_ACCOUNT_LIMIT,
      itemLimit: CONTENT_ITEM_LIMIT,
    });
  }
  if (!s.content)
    throw new AppError('Content storage is temporarily unavailable.', 503);
  const store = s.content;
  if (path === 'content' && request.method === 'POST') {
    const data = await input(request);
    if (!['file', 'link'].includes(String(data.kind)))
      throw new AppError('Choose file or link.');
    const kind = String(data.kind),
      name = text(data.name, 'Title', 120);
    let link = '',
      filename = '',
      mime = 'application/octet-stream',
      size = 0;
    if (kind === 'link') {
      try {
        link = contentLink(text(data.url, 'Link', 2048));
      } catch (e) {
        throw new AppError(e instanceof Error ? e.message : 'Invalid link.');
      }
    } else {
      filename = text(data.filename, 'Filename', 180)
        .split('')
        .map((char) =>
          char.charCodeAt(0) < 32 ||
          char.charCodeAt(0) === 127 ||
          char === '/' ||
          char === '\\'
            ? '_'
            : char,
        )
        .join('')
        .toWellFormed();
      size = Number(data.size);
      if (!Number.isSafeInteger(size) || size <= 0 || size > CONTENT_FILE_LIMIT)
        throw new AppError('Files must be between 1 byte and 50 MB.', 413);
      // A short list of media types keep their type; all else is opaque bytes.
      mime = contentType(data.mime, filename);
    }
    const clientId = v1 && data.id !== undefined ? id(data.id) : undefined;
    const existing = async () => {
      const found = await s.db
        .prepare(
          `SELECT ${columns},object_key,expires_at,owner FROM content_items WHERE id=?`,
        )
        .bind(clientId)
        .first<Row & { owner: string }>();
      if (!found) return null;
      // Identifiers are global. Another account's identifier is never revealed.
      if (found.owner !== s.owner)
        throw new AppError('Choose a new identifier for this item.', 409);
      return json(shape(found));
    };
    if (clientId) {
      const saved = await existing();
      if (saved) return saved;
    }
    // A client-chosen identifier can be reused after a failed upload, while
    // the old file may still be waiting in the deletion queue. A fresh object
    // key keeps that queued deletion from ever touching the new file.
    const itemId = clientId ?? crypto.randomUUID(),
      key =
        kind === 'file'
          ? `content/${clientId ? crypto.randomUUID() : itemId}`
          : '',
      now = Date.now();
    // Reservation and quota checks are one atomic SQLite statement. Pending deletions count
    // until their bytes are gone, so parallel uploads/deletes cannot bypass the storage cap.
    const inserted = await s.db
      .prepare(`INSERT INTO content_items(id,owner,kind,name,filename,mime,size,url,object_key,created_at,state,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${usageSQL} + ? <= ? AND (SELECT COUNT(*) FROM content_items WHERE owner=?) < ? ON CONFLICT(id) DO NOTHING RETURNING ${columns}`)
      .bind(
        itemId,
        s.owner,
        kind,
        name,
        filename,
        mime,
        size,
        link,
        key,
        now,
        kind === 'file' ? 'uploading' : 'ready',
        kind === 'file' ? now + 3600000 : 0,
        s.owner,
        s.owner,
        size,
        CONTENT_ACCOUNT_LIMIT,
        s.owner,
        CONTENT_ITEM_LIMIT,
      )
      .first<Row>();
    if (!inserted) {
      // A parallel request with the same identifier may have won.
      if (clientId) {
        const saved = await existing();
        if (saved) return saved;
      }
      throw new AppError(
        'Content is full (2 GB or 500 items). Delete items and wait for pending file cleanup before retrying.',
        409,
      );
    }
    return json(shape(inserted), 201);
  }
  const match = /^content\/([^/]+)(\/file)?$/.exec(path);
  if (!match) throw new AppError('Not found.', 404);
  const itemId = id(match[1]);
  const row = await s.db
    .prepare(
      `SELECT ${columns},object_key,state,expires_at FROM content_items WHERE owner=? AND id=?`,
    )
    .bind(s.owner, itemId)
    .first<Row>();
  if (!row) throw new AppError('Content not found.', 404);
  if (v1 && !match[2] && request.method === 'GET') return json(shape(row));
  if (match[2] && request.method === 'PUT') {
    // A client that lost the response to a finished upload may send it again.
    if (v1 && row.kind === 'file' && row.state === 'ready')
      return json(shape(row));
    if (
      row.kind !== 'file' ||
      row.state !== 'uploading' ||
      row.expires_at <= Date.now()
    )
      throw new AppError('Start this upload again.', 409);
    if (
      !request.body ||
      Number(request.headers.get('Content-Length')) !== row.size ||
      request.headers.get('Content-Type') !== 'application/octet-stream'
    )
      throw new AppError(
        'Upload the exact reserved file size as binary data.',
        400,
      );
    // The claim, the publish and the failure cleanup all name the object key
    // read above. A client-chosen identifier can be deleted and reserved again
    // at any moment; that replacement has a different key, and this request
    // must never claim it, mark it ready, or delete it on the strength of
    // bytes written for the reservation it replaced.
    const claimed = await s.db
      .prepare(
        "UPDATE content_items SET state='writing' WHERE owner=? AND id=? AND object_key=? AND state='uploading' RETURNING id",
      )
      .bind(s.owner, itemId, row.object_key)
      .first();
    if (!claimed)
      throw new AppError(
        'This upload is already in progress or was restarted. Check its status before retrying.',
        409,
      );
    const abort = new AbortController();
    const timer = setTimeout(
      () => abort.abort('Upload timed out'),
      10 * 60 * 1000,
    );
    try {
      // FixedLengthStream both enforces exact length and preserves R2's known-length
      // requirement. No request.arrayBuffer(), no entire video resident in Worker memory.
      const fixed = new FixedLengthStream(row.size);
      const piping = request.body.pipeTo(fixed.writable, {
        signal: abort.signal,
      });
      const writing = store
        .put(row.object_key, fixed.readable, {
          httpMetadata: { contentType: row.mime },
          onlyIf: { etagDoesNotMatch: '*' },
        })
        .then(
          (stored) => {
            if (!stored) abort.abort();
            return stored;
          },
          (error) => {
            abort.abort();
            throw error;
          },
        );
      const outcomes = await Promise.allSettled([piping, writing]);
      if (
        outcomes.some((o) => o.status === 'rejected') ||
        outcomes[1].status !== 'fulfilled' ||
        !outcomes[1].value ||
        outcomes[1].value.size !== row.size
      )
        throw new Error('Incomplete upload');
      const ready = await s.db
        .prepare(
          `UPDATE content_items SET state='ready',expires_at=0 WHERE owner=? AND id=? AND object_key=? AND state='writing' RETURNING ${columns}`,
        )
        .bind(s.owner, itemId, row.object_key)
        .first<Row>();
      if (!ready) throw new Error('Upload reservation disappeared');
      return json(shape(ready));
    } catch {
      await s.db
        .prepare(
          'DELETE FROM content_items WHERE owner=? AND id=? AND object_key=?',
        )
        .bind(s.owner, itemId, row.object_key)
        .run();
      try {
        await deleteQueuedContent(s.db, store, row.object_key);
      } catch {
        /* durable daily retry */
      }
      throw new AppError(
        'Upload did not finish. Select the file again to retry.',
        400,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  if (match[2] && ['GET', 'HEAD'].includes(request.method)) {
    if (row.kind !== 'file' || row.state !== 'ready')
      throw new AppError('File is not available.', 404);
    const metadata = await store.head(row.object_key);
    if (!metadata || metadata.size !== row.size)
      throw new AppError('File is unavailable. Please retry.', 503);
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': row.mime,
      ETag: metadata.httpEtag,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    const filename = encodeURIComponent(row.filename).replace(/'/g, '%27');
    headers.set(
      'Content-Disposition',
      `${!url.searchParams.has('download') && contentInline(row.mime) ? 'inline' : 'attachment'}; filename="content-file"; filename*=UTF-8''${filename}`,
    );
    let range: { offset: number; length: number } | undefined;
    // If-Range mismatch returns the whole representation, as required by HTTP.
    const raw = request.headers.get('Range');
    if (
      request.method === 'GET' &&
      raw &&
      (!request.headers.has('If-Range') ||
        request.headers.get('If-Range') === metadata.httpEtag)
    ) {
      try {
        range = contentRange(raw, row.size);
      } catch {
        headers.set('Content-Range', `bytes */${row.size}`);
        return new Response(null, { status: 416, headers });
      }
    }
    headers.set('Content-Length', String(range?.length ?? row.size));
    if (range)
      headers.set(
        'Content-Range',
        `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size}`,
      );
    if (request.method === 'HEAD') return new Response(null, { headers });
    const stored = await store.get(
      row.object_key,
      range ? { range } : undefined,
    );
    if (!stored || !('body' in stored))
      throw new AppError('File is unavailable.', 503);
    return new Response(stored.body, { status: range ? 206 : 200, headers });
  }
  if (!match[2] && request.method === 'PATCH' && row.state === 'ready') {
    const data = await input(request);
    if (typeof data.pinned !== 'boolean')
      throw new AppError('Choose whether to pin this item.');
    const updated = await s.db
      .prepare(
        `UPDATE content_items SET pinned=? WHERE owner=? AND id=? AND state='ready' RETURNING ${columns}`,
      )
      .bind(data.pinned ? 1 : 0, s.owner, itemId)
      .first<Row>();
    if (!updated) throw new AppError('Content not found.', 404);
    return json(shape(updated));
  }
  if (!match[2] && request.method === 'DELETE') {
    // Do not allow deletion to race a live R2 write. Abandoned writes expire after
    // an hour, longer than the enforced ten-minute streaming deadline.
    const deleted = await s.db
      .prepare(
        "DELETE FROM content_items WHERE owner=? AND id=? AND state<>'writing' RETURNING id",
      )
      .bind(s.owner, itemId)
      .first();
    if (!deleted)
      throw new AppError('Upload is in progress. Please retry shortly.', 409);
    let pending = false;
    if (row.object_key) {
      try {
        await deleteQueuedContent(s.db, store, row.object_key);
      } catch {
        pending = true;
      }
    }
    return json({ deleted: true, cleanupPending: pending });
  }
  throw new AppError('Not found.', 404);
}
