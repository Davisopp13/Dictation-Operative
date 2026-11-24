import { deleteQueuedImage } from './clipboard-cleanup';
import { AppError, id, object, text } from './domain';
import { readBounded } from './request';
import { IMAGE_LIMIT, validatePayload } from './sync/protocol';
import type { Services } from './server';

/** Only the object operations this feature needs; also supported by local R2. */
export interface ImageStore {
  put(
    key: string,
    bytes: Uint8Array<ArrayBuffer>,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
  get(
    key: string,
  ): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  delete(key: string): Promise<void>;
}

/** Storage budget for saved Clipboard images, per account. */
export const IMAGE_ACCOUNT_LIMIT = 2_000_000_000;
export const IMAGE_ITEM_LIMIT = 5000;

export type ClipboardImage = {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  createdAt: number;
  pinned: boolean;
};
export const imageColumns =
  'id,name,size,width,height,created_at AS createdAt,pinned';
const columns = imageColumns;
export type ImageRow = Omit<ClipboardImage, 'pinned'> & { pinned: number };
export const decodeImage = (row: ImageRow): ClipboardImage => ({
  id: row.id,
  name: row.name,
  size: row.size,
  width: row.width,
  height: row.height,
  createdAt: row.createdAt,
  pinned: !!row.pinned,
});
const decode = decodeImage;
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

/**
 * Saves one PNG. With `clientId` the call is an idempotent create: repeating
 * it returns the image saved the first time, and the bytes are not stored
 * again. Without it the server picks the identifier.
 */
export async function createImage(
  request: Request,
  s: Services,
  clientId?: string,
): Promise<{ image: ClipboardImage; created: boolean }> {
  if (!s.images)
    throw new AppError(
      'Image storage is temporarily unavailable. Please retry.',
      503,
    );
  const existing = async () => {
    const row = await s.db
      .prepare(`SELECT ${columns},owner FROM clipboard_images WHERE id=?`)
      .bind(clientId)
      .first<ImageRow & { owner: string }>();
    if (!row) return null;
    // Identifiers are global. Another account's identifier is never revealed.
    if (row.owner !== s.owner)
      throw new AppError('Choose a new identifier for this image.', 409);
    return decode(row);
  };
  if (clientId) {
    const saved = await existing();
    if (saved) return { image: saved, created: false };
  }
  if (request.headers.get('Content-Type') !== 'image/png')
    throw new AppError(
      'Upload a PNG image. JPEG and WebP are converted by the app.',
      415,
    );
  const bytes = await readBounded(request, IMAGE_LIMIT);
  try {
    validatePayload({ mime: 'image/png', bytes });
  } catch (e) {
    throw new AppError(e instanceof Error ? e.message : 'Invalid image.');
  }
  const name = text(
    new URL(request.url).searchParams.get('name') ?? 'Clipboard image',
    'Image name',
    120,
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const image: ClipboardImage = {
    id: clientId ?? crypto.randomUUID(),
    name,
    size: bytes.length,
    width: view.getUint32(16),
    height: view.getUint32(20),
    createdAt: Date.now(),
    pinned: false,
  };
  // A client-chosen identifier can be reused after its image is deleted, while
  // the old file may still be waiting in the deletion queue. A fresh object
  // key keeps that queued deletion from ever touching the new file.
  const key = `clipboard/${clientId ? crypto.randomUUID() : image.id}.png`;
  await s.images.put(key, bytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  let inserted: ImageRow | null;
  try {
    // The quota check and the insert are one statement, so parallel uploads
    // cannot pass the budget together.
    inserted = await s.db
      .prepare(
        `INSERT INTO clipboard_images (id,owner,name,object_key,size,width,height,created_at)
         SELECT ?,?,?,?,?,?,?,?
         WHERE (SELECT COALESCE(SUM(size),0) FROM clipboard_images WHERE owner=?) + ? <= ?
           AND (SELECT COUNT(*) FROM clipboard_images WHERE owner=?) < ?
         ON CONFLICT(id) DO NOTHING RETURNING ${columns}`,
      )
      .bind(
        image.id,
        s.owner,
        name,
        key,
        image.size,
        image.width,
        image.height,
        image.createdAt,
        s.owner,
        image.size,
        IMAGE_ACCOUNT_LIMIT,
        s.owner,
        IMAGE_ITEM_LIMIT,
      )
      .first<ImageRow>();
  } catch (e) {
    await s.images.delete(key);
    throw e;
  }
  if (inserted) return { image: decode(inserted), created: true };
  // Nothing was inserted: either a parallel request with the same identifier
  // won, or the account is over its budget. This request's file is unused.
  await s.images.delete(key);
  if (clientId) {
    const saved = await existing();
    if (saved) return { image: saved, created: false };
  }
  throw new AppError(
    'Clipboard images are full (2 GB or 5,000 images). Delete some images and try again.',
    409,
  );
}

export async function handleImages(
  request: Request,
  s: Services,
  path: string,
) {
  const url = new URL(request.url);
  if (path === 'images' && request.method === 'GET') {
    const query = text(url.searchParams.get('q') ?? '', 'Search', 200, true);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      throw new AppError('Invalid page.');
    const result = await s.db
      .prepare(
        `SELECT ${columns} FROM clipboard_images WHERE owner=? AND (?=0 OR pinned=1) AND instr(lower(name),lower(?))>0 ORDER BY created_at DESC,id DESC LIMIT 41 OFFSET ?`,
      )
      .bind(
        s.owner,
        url.searchParams.get('pinned') === 'true' ? 1 : 0,
        query,
        offset,
      )
      .all<ImageRow>();
    return json({
      images: result.results.slice(0, 40).map(decode),
      hasMore: result.results.length > 40,
    });
  }
  if (!s.images)
    throw new AppError(
      'Image storage is temporarily unavailable. Please retry.',
      503,
    );
  if (path === 'images' && request.method === 'POST')
    return json((await createImage(request, s)).image, 201);
  if (path.startsWith('images/')) {
    const imageId = id(path.slice(7));
    const image = await s.db
      .prepare(
        `SELECT ${columns},object_key AS objectKey FROM clipboard_images WHERE owner=? AND id=?`,
      )
      .bind(s.owner, imageId)
      .first<ImageRow & { objectKey: string }>();
    if (!image) throw new AppError('Image not found.', 404);
    if (request.method === 'PATCH') {
      let data: Record<string, unknown>;
      try {
        data = object(
          JSON.parse(
            new TextDecoder().decode(await readBounded(request, 1024)),
          ),
        );
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError('The request could not be read.');
      }
      if (typeof data.pinned !== 'boolean')
        throw new AppError('Choose whether to pin this image.');
      const updated = await s.db
        .prepare(
          `UPDATE clipboard_images SET pinned=? WHERE owner=? AND id=? RETURNING ${columns}`,
        )
        .bind(data.pinned ? 1 : 0, s.owner, imageId)
        .first<ImageRow>();
      if (!updated) throw new AppError('Image not found.', 404);
      return json(decode(updated));
    }
    if (request.method === 'GET') {
      const stored = await s.images.get(image.objectKey);
      if (!stored) throw new AppError('Image not found.', 404);
      return new Response(stored.body, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(stored.size),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="clipboard-image.png"; filename*=UTF-8''${encodeURIComponent(image.name.replace(/\.[^.]+$/, '') + '.png').replace(/'/g, '%27')}`,
        },
      });
    }
    if (request.method === 'DELETE') {
      // The trigger commits a durable object deletion record with this delete.
      await s.db
        .prepare('DELETE FROM clipboard_images WHERE owner=? AND id=?')
        .bind(s.owner, imageId)
        .run();
      try {
        await deleteQueuedImage(s.db, s.images, image.objectKey);
      } catch {
        // The item is deleted; a later daily run retries storage cleanup.
        console.error('Clipboard image file deletion queued for retry');
      }
      return json({ deleted: true });
    }
  }
  throw new AppError('Not found.', 404);
}
