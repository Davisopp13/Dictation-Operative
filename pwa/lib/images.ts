import { AppError, id, text } from './domain';
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

export type ClipboardImage = {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  createdAt: number;
};
const columns = 'id,name,size,width,height,created_at AS createdAt';
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

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
        `SELECT ${columns} FROM clipboard_images WHERE owner=? AND instr(lower(name),lower(?))>0 ORDER BY created_at DESC,id DESC LIMIT 41 OFFSET ?`,
      )
      .bind(s.owner, query, offset)
      .all<ClipboardImage>();
    return json({
      images: result.results.slice(0, 40),
      hasMore: result.results.length > 40,
    });
  }
  if (!s.images)
    throw new AppError(
      'Image storage is temporarily unavailable. Please retry.',
      503,
    );
  if (path === 'images' && request.method === 'POST') {
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
      url.searchParams.get('name') ?? 'Clipboard image',
      'Image name',
      120,
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const image: ClipboardImage = {
      id: crypto.randomUUID(),
      name,
      size: bytes.length,
      width: view.getUint32(16),
      height: view.getUint32(20),
      createdAt: Date.now(),
    };
    const key = `clipboard/${image.id}.png`;
    await s.images.put(key, bytes, {
      httpMetadata: { contentType: 'image/png' },
    });
    try {
      await s.db
        .prepare(
          'INSERT INTO clipboard_images (id,owner,name,object_key,size,width,height,created_at) VALUES (?,?,?,?,?,?,?,?)',
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
        )
        .run();
    } catch (e) {
      await s.images.delete(key);
      throw e;
    }
    return json(image, 201);
  }
  if (path.startsWith('images/')) {
    const imageId = id(path.slice(7));
    const image = await s.db
      .prepare(
        `SELECT ${columns},object_key AS objectKey FROM clipboard_images WHERE owner=? AND id=?`,
      )
      .bind(s.owner, imageId)
      .first<ClipboardImage & { objectKey: string }>();
    if (!image) throw new AppError('Image not found.', 404);
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
      // Delete bytes first so a failed object deletion remains retryable.
      await s.images.delete(image.objectKey);
      await s.db
        .prepare('DELETE FROM clipboard_images WHERE owner=? AND id=?')
        .bind(s.owner, imageId)
        .run();
      return json({ deleted: true });
    }
  }
  throw new AppError('Not found.', 404);
}
