import { handleContent, type ContentStore } from './content';
import { handleV1 } from './api-v1';
import { readBounded } from './request';
import { handleWindowsDownload } from './windows-download';
import { handleMacDownload } from './mac-download';
import { getTools, saveTools } from './workspace-tools';
import { handleImages, type ImageStore } from './images';
import { importClip, importedId } from './backup';
import {
  AppError,
  object,
  text,
  id,
  revision,
  newClip,
  changeClip,
} from './domain';
import {
  getClip,
  listClips,
  insertClip,
  saveClip,
  deleteClip,
  getPreferences,
} from './repository';
export type Services = {
  db: D1Database;
  images?: ImageStore;
  content?: ContentStore;
  owner: string;
  logoutPath?: string;
};
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
export function checkOrigin(request: Request) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (!origin || origin !== new URL(request.url).origin)
      throw new AppError('Please make this change from the app.', 403);
  }
}
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
async function settingsState(s: Services) {
  const p = await getPreferences(s.db, s.owner);
  return {
    clipboardDailyCleanup: !!p.clipboard_daily_cleanup,
    logoutPath: s.logoutPath ?? '/login',
  };
}
export async function handleAPI(
  request: Request,
  s: Services,
): Promise<Response> {
  try {
    checkOrigin(request);
    if (!s.owner) throw new AppError('Sign in to open your workspace.', 401);
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/api\//, '');
    const method = request.method;
    if (path.startsWith('v1/')) return await handleV1(request, s, path.slice(3));
    if (path === 'mac-downloads' || path.startsWith('mac-downloads/'))
      return await handleMacDownload(request, s, path);
    if (path.startsWith('windows-downloads/'))
      return await handleWindowsDownload(request, s, path);
    if (path === 'content' || path.startsWith('content/'))
      return await handleContent(request, s, path);
    if (path === 'images' || path.startsWith('images/'))
      return await handleImages(request, s, path);
    if (path === 'workspace-tools' && method === 'GET')
      return json(await getTools(s.db, s.owner));
    if (path === 'workspace-tools' && method === 'PUT')
      return json(await saveTools(s.db, s.owner, await body(request)));
    if (path === 'organization' && method === 'GET') {
      const collections = await s.db
        .prepare(
          "SELECT DISTINCT collection FROM clips WHERE owner=? AND collection != '' ORDER BY collection",
        )
        .bind(s.owner)
        .all<{ collection: string }>();
      const tags = await s.db
        .prepare(
          'SELECT DISTINCT value AS tag FROM clips, json_each(clips.tags) WHERE owner=? ORDER BY value',
        )
        .bind(s.owner)
        .all<{ tag: string }>();
      return json({
        collections: collections.results.map((r) => r.collection),
        tags: tags.results.map((r) => r.tag),
      });
    }
    if (path === 'settings' && method === 'GET') {
      return json(await settingsState(s));
    }
    if (path === 'settings' && method === 'POST') {
      const data = await body(request);
      if (data.action === 'clipboard-cleanup') {
        if (typeof data.enabled !== 'boolean')
          throw new AppError('Choose whether to enable daily Clipboard cleanup.');
        await s.db.prepare(
          'INSERT INTO preferences (owner,clipboard_daily_cleanup) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET clipboard_daily_cleanup=excluded.clipboard_daily_cleanup',
        ).bind(s.owner, data.enabled ? 1 : 0).run();
      } else throw new AppError('Unknown settings action.');
      return json(await settingsState(s));
    }
    if (path === 'library' && method === 'GET') {
      const query = text(url.searchParams.get('q') ?? '', 'Search', 200, true);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
        throw new AppError('Invalid page.');
      return json(
        await listClips(
          s.db,
          s.owner,
          query,
          url.searchParams.get('pinned') === 'true',
          offset,
          text(
            url.searchParams.get('collection') ?? '',
            'Collection',
            60,
            true,
          ),
          text(
            url.searchParams.get('tag') ?? '',
            'Tag',
            40,
            true,
          ).toLowerCase(),
        ),
      );
    }
    if (path === 'import' && method === 'POST') {
      const clip = importClip((await body(request, 1000000)).clip);
      const existing = await s.db
        .prepare('SELECT id FROM clips WHERE owner=? AND id=?')
        .bind(s.owner, clip.id)
        .first();
      if (existing) return json({ imported: false });
      clip.id = await importedId(s.owner, clip.id);
      const restored = await s.db
        .prepare('SELECT id FROM clips WHERE owner=? AND id=?')
        .bind(s.owner, clip.id)
        .first();
      if (restored) return json({ imported: false });
      await insertClip(s.db, s.owner, clip);
      return json({ imported: true });
    }
    if (path === 'clips' && method === 'POST') {
      const data = await body(request);
      if (data.clipboardItem !== undefined && typeof data.clipboardItem !== 'boolean')
        throw new AppError('Choose whether this is a Clipboard item.');
      return json(
        await insertClip(s.db, s.owner, newClip(data), data.clipboardItem === true),
        201,
      );
    }
    if (path.startsWith('clips/')) {
      const clipId = id(path.slice(6));
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
        const input = await body(request);
        await deleteClip(s.db, s.owner, clipId, revision(input.revision));
        return json({ deleted: true });
      }
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    console.error(
      'Workspace API failed',
      e instanceof Error ? e.name : 'UnknownError',
    );
    return json(
      { error: 'Something went wrong saving your workspace. Please retry.' },
      500,
    );
  }
}
