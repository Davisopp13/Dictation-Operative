import {
  listPiles,
  readPile,
  createPile,
  updatePile,
  readPileDeletionImpact,
  deletePile,
} from './piles';
import {
  listSharedItems,
  itemReference,
  itemStatement,
  missingItem,
  sharedItem,
  type ItemRow,
} from './shared-items';
import { readPileMembers, writePileMember } from './pile-members';
import { handleContent } from './content';
import { decodeCursor, page, pageLimit } from './cursor';
import {
  AppError,
  changeClip,
  id,
  newClip,
  object,
  revision,
  text,
} from './domain';
import {
  createImage,
  decodeImage,
  handleImages,
  imageColumns,
  type ImageRow,
} from './images';
import {
  clipOwner,
  deleteClip,
  getClip,
  insertClip,
  listClipsPage,
  saveClip,
} from './repository';
import { readBounded } from './request';
import { readRevision } from './revision';
import type { Services } from './server';

/**
 * /api/v1: the stable contract for native clients, on the same storage,
 * ownership checks, quotas, and deletion queues as the browser API.
 *
 *   GET    revision
 *   GET    text                 POST   text
 *   GET    text/:id             PATCH  text/:id          DELETE text/:id
 *   GET    images
 *   GET    images/:id           PUT    images/:id        PATCH/DELETE images/:id
 *   GET    images/:id/file
 *   GET    documents            POST   documents
 *   GET    documents/:id        PATCH/DELETE documents/:id
 *   PUT    documents/:id/file   GET/HEAD documents/:id/file
 *
 * Lists are newest first and paginate with an opaque `cursor`; a response's
 * `nextCursor` is null on the last page. Every list carries the workspace
 * `revision` read before the list, so a client that stores it will always
 * notice a change that raced with the listing.
 *
 * Creates are idempotent on a client-chosen identifier: repeating one returns
 * what was saved the first time with status 200 instead of 201.
 */
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

async function body(request: Request, max = 120000) {
  try {
    return object(
      JSON.parse(new TextDecoder().decode(await readBounded(request, max))),
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('The request could not be read.');
  }
}

export async function handleV1(
  request: Request,
  s: Services,
  path: string,
): Promise<Response> {
  const url = new URL(request.url),
    method = request.method,
    param = (name: string) => url.searchParams.get(name);

  if (path === 'items' && method === 'GET')
    return json(await listSharedItems(s.db, s.owner, url));
  const shared = /^items\/(text|image|document)\/([^/]+)$/.exec(path);
  if (shared && method === 'GET') {
    const ref = itemReference({ kind: shared[1], id: shared[2] });
    const row = await itemStatement(s.db, s.owner, ref).first<ItemRow>();
    if (!row) return missingItem(s.db, s.owner, ref);
    return json(sharedItem(row));
  }
  if (path === 'piles') {
    if (method === 'GET') return json(await listPiles(s.db, s.owner, url));
    if (method === 'POST') {
      const result = await createPile(
        s.db,
        s.owner,
        await body(request, 12000),
        s.accountId,
      );
      return json(result, result.replayed ? 200 : 201);
    }
  }
  const pile = /^piles\/([^/]+)$/.exec(path);
  if (pile) {
    const pileId = id(pile[1]);
    if (method === 'GET') return json(await readPile(s.db, s.owner, pileId));
    if (method === 'PATCH')
      return json(
        await updatePile(s.db, s.owner, pileId, await body(request, 12000)),
      );
    if (method === 'DELETE')
      return json(
        await deletePile(s.db, s.owner, pileId, await body(request, 12000)),
      );
  }
  const impact = /^piles\/([^/]+)\/deletion-impact$/.exec(path);
  if (impact && method === 'GET')
    return json(await readPileDeletionImpact(s.db, s.owner, id(impact[1])));
  const members = /^piles\/([^/]+)\/members$/.exec(path);
  if (members) {
    const pileId = id(members[1]);
    if (method === 'GET')
      return json(await readPileMembers(s.db, s.owner, pileId));
    if (method === 'POST')
      return json(
        await writePileMember(
          s.db,
          s.owner,
          pileId,
          await body(request, 12000),
        ),
      );
  }

  if (path === 'revision' && method === 'GET')
    return json({
      ...(await readRevision(s.db, s.owner)),
      serverTime: Date.now(),
    });

  if (path === 'text' && method === 'GET') {
    const { revision: current } = await readRevision(s.db, s.owner);
    return json({
      ...(await listClipsPage(s.db, s.owner, {
        query: text(param('q') ?? '', 'Search', 200, true),
        pinned: param('pinned') === 'true',
        collection: text(param('collection') ?? '', 'Collection', 60, true),
        tag: text(param('tag') ?? '', 'Tag', 40, true).toLowerCase(),
        cursor: decodeCursor(param('cursor')),
        limit: pageLimit(param('limit')),
      })),
      revision: current,
    });
  }
  if (path === 'text' && method === 'POST') {
    const data = await body(request);
    if (
      data.clipboardItem !== undefined &&
      typeof data.clipboardItem !== 'boolean'
    )
      throw new AppError('Choose whether this is a Clipboard item.');
    const clip = newClip(data);
    const owner = await clipOwner(s.db, clip.id);
    if (owner === s.owner) return json(await getClip(s.db, s.owner, clip.id));
    // Identifiers are global. Another account's identifier is never revealed.
    if (owner !== null)
      throw new AppError('Choose a new identifier for this text.', 409);
    // Text saved by a client is a Clipboard item unless it says otherwise.
    return json(
      await insertClip(s.db, s.owner, clip, data.clipboardItem !== false),
      201,
    );
  }
  if (path.startsWith('text/')) {
    const clipId = id(path.slice(5));
    if (method === 'GET') return json(await getClip(s.db, s.owner, clipId));
    if (method === 'PATCH') {
      const input = await body(request),
        clip = await getClip(s.db, s.owner, clipId);
      const updated = changeClip(clip, input);
      return json(
        updated === clip
          ? clip
          : await saveClip(s.db, s.owner, updated, clip.revision),
      );
    }
    if (method === 'DELETE') {
      // Not every HTTP client can send a body with DELETE.
      const given = param('revision');
      await deleteClip(
        s.db,
        s.owner,
        clipId,
        revision(
          given === null ? (await body(request)).revision : Number(given),
        ),
      );
      return json({ deleted: true });
    }
  }

  if (path === 'images' && method === 'GET') {
    const { revision: current } = await readRevision(s.db, s.owner);
    const limit = pageLimit(param('limit'), 40),
      cursor = decodeCursor(param('cursor'));
    const result = await s.db
      .prepare(
        `SELECT ${imageColumns} FROM clipboard_images WHERE owner=? AND (?=0 OR pinned=1) AND instr(lower(name),lower(?))>0 AND (?=0 OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .bind(
        s.owner,
        param('pinned') === 'true' ? 1 : 0,
        text(param('q') ?? '', 'Search', 200, true),
        cursor ? 1 : 0,
        cursor?.time ?? 0,
        cursor?.time ?? 0,
        cursor?.id ?? '',
        limit + 1,
      )
      .all<ImageRow>();
    const listed = page(result.results, limit, (row) => ({
      time: row.createdAt,
      id: row.id,
    }));
    return json({
      items: listed.items.map(decodeImage),
      nextCursor: listed.nextCursor,
      revision: current,
    });
  }
  const image = /^images\/([^/]+)(\/file)?$/.exec(path);
  if (image) {
    const imageId = id(image[1]);
    if (image[2]) {
      if (method !== 'GET') throw new AppError('Not found.', 404);
      return handleImages(request, s, `images/${imageId}`);
    }
    if (method === 'PUT') {
      const saved = await createImage(request, s, imageId);
      return json(saved.image, saved.created ? 201 : 200);
    }
    if (method === 'GET') {
      const row = await s.db
        .prepare(
          `SELECT ${imageColumns} FROM clipboard_images WHERE owner=? AND id=?`,
        )
        .bind(s.owner, imageId)
        .first<ImageRow>();
      if (!row) throw new AppError('Image not found.', 404);
      return json(decodeImage(row));
    }
    if (method === 'PATCH' || method === 'DELETE')
      return handleImages(request, s, `images/${imageId}`);
  }

  if (path === 'documents' || path.startsWith('documents/')) {
    const rest = path.slice('documents'.length);
    if (path === 'documents' && method === 'GET') {
      const { revision: current } = await readRevision(s.db, s.owner);
      const listed = await handleContent(request, s, 'content', true);
      return json({ ...(await listed.json<object>()), revision: current });
    }
    return handleContent(request, s, 'content' + rest, true);
  }

  throw new AppError('Not found.', 404);
}
