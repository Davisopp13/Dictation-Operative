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
  transformKind,
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
  limitUsage,
} from './repository';
import { encryptCredential, decryptCredential } from './crypto';
import { verifyCredential, transcribeAudio, transformText } from './provider';
import { limitSharedAI, positiveLimit, sharedAllowance } from './shared-ai';
export type Services = {
  db: D1Database;
  images?: ImageStore;
  owner: string;
  encryptionKey: string;
  fetcher?: typeof fetch;
  sharedGroqKey?: string;
  sharedGroqOwner?: string;
  sharedDailyLimit?: number;
  sharedGlobalDailyLimit?: number;
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
      throw new AppError('Please make this change from the DO app.', 403);
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
async function aiKey(s: Services) {
  const pref = await getPreferences(s.db, s.owner);
  if (!pref.consent)
    throw new AppError(
      'Allow cloud processing in Settings before using recording or AI.',
      403,
    );
  const sharedCredential = s.sharedGroqOwner && !s.sharedGroqKey
    ? (await getPreferences(s.db, s.sharedGroqOwner)).encrypted_key : null;
  if (s.sharedGroqOwner && !s.sharedGroqKey && !sharedCredential)
    throw new AppError('Included AI is temporarily unavailable. Please try again later.', 503);
  if (!s.sharedGroqKey && !sharedCredential && !pref.encrypted_key)
    throw new AppError(
      'Connect Groq in Settings to use recording and AI.',
      428,
    );
  await limitUsage(s.db, s.owner);
  if (s.sharedGroqKey || sharedCredential) {
    await limitSharedAI(s.db, s.owner, positiveLimit(s.sharedDailyLimit, 50), positiveLimit(s.sharedGlobalDailyLimit, 1000));
    return s.sharedGroqKey || decryptCredential(sharedCredential!, s.encryptionKey, s.sharedGroqOwner!);
  }
  return decryptCredential(pref.encrypted_key!, s.encryptionKey, s.owner);
}
async function settingsState(s: Services) {
  const p = await getPreferences(s.db, s.owner);
  const shared = !!s.sharedGroqKey || !!s.sharedGroqOwner;
  return {
    connected: shared || !!p.encrypted_key,
    shared,
    consent: !!p.consent,
    secureStorage: !!s.encryptionKey,
    model: shared ? 'openai/gpt-oss-120b' : p.model,
    allowance: shared ? await sharedAllowance(s.db, s.owner, positiveLimit(s.sharedDailyLimit, 50)) : null,
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
    if (path === 'mac-downloads' || path.startsWith('mac-downloads/'))
      return await handleMacDownload(request, s, path);
    if (path.startsWith('windows-downloads/'))
      return await handleWindowsDownload(request, s, path);
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
      if (data.action === 'connect') {
        const key = text(data.key, 'Groq key', 300);
        if (!/^gsk_[\w-]{15,}$/.test(key))
          throw new AppError('Enter a valid Groq API key.');
        const model = data.model === undefined ? (await getPreferences(s.db, s.owner)).model : text(data.model, 'Groq model', 120);
        if (!/^[a-zA-Z0-9/_.-]+$/.test(model)) throw new AppError('Enter a valid Groq model.');
        await limitUsage(s.db, s.owner);
        await verifyCredential(key, s.fetcher);
        const encrypted = await encryptCredential(
          key,
          s.encryptionKey,
          s.owner,
        );
        await s.db
          .prepare(
            'INSERT INTO preferences (owner,encrypted_key,consent,model) VALUES (?,?,0,?) ON CONFLICT(owner) DO UPDATE SET encrypted_key=excluded.encrypted_key,model=excluded.model',
          )
          .bind(s.owner, encrypted, model)
          .run();
      } else if (data.action === 'disconnect') {
        if (s.sharedGroqOwner === s.owner) throw new AppError('This connection supplies included AI. Change the service connection before disconnecting it.', 409);
        await s.db
          .prepare('UPDATE preferences SET encrypted_key=NULL WHERE owner=?')
          .bind(s.owner)
          .run();
      } else if (data.action === 'consent') {
        if (typeof data.consent !== 'boolean')
          throw new AppError('Choose whether to allow cloud processing.');
        await s.db
          .prepare(
            'INSERT INTO preferences (owner,consent) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET consent=excluded.consent',
          )
          .bind(s.owner, data.consent ? 1 : 0)
          .run();
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
      return json(
        await insertClip(s.db, s.owner, newClip(await body(request))),
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
    if (path === 'transform' && method === 'POST') {
      const data = await body(request),
        kind = transformKind(data.kind),
        source = text(data.text),
        context = text(data.context ?? '', 'Incoming message', 10000, true);
      const tools = await getTools(s.db, s.owner);
      const template = data.templateId
        ? tools.templates.find((t) => t.id === id(data.templateId))
        : undefined;
      if (data.templateId && !template)
        throw new AppError(
          'This template was removed. Choose another template.',
          404,
        );
      if (kind === 'reply' && !context)
        throw new AppError('Paste the incoming message first.');
      return json({
        text: await transformText(
          await aiKey(s),
          kind,
          source,
          context,
          s.fetcher,
          {
            vocabulary: tools.vocabulary,
            model: s.sharedGroqKey || s.sharedGroqOwner ? 'openai/gpt-oss-120b' : (await getPreferences(s.db, s.owner)).model,
            instructions: template?.instructions,
          },
        ),
      });
    }
    if (path === 'transcribe' && method === 'POST') {
      const key = await aiKey(s);
      const bytes = await readBounded(request, 21000000);
      let form: FormData;
      try {
        form = await new Response(bytes, {
          headers: {
            'Content-Type': request.headers.get('Content-Type') ?? '',
          },
        }).formData();
      } catch {
        throw new AppError('The recording could not be read.');
      }
      const file = form.get('audio');
      if (!(file instanceof File) || file.size < 100 || file.size > 20000000)
        throw new AppError(
          'Record between a second and five minutes (up to 20 MB).',
        );
      if (
        !/^(audio\/(webm|mp4|mpeg|ogg|wav|x-wav)|video\/(webm|mp4))(;|$)/.test(
          file.type,
        )
      )
        throw new AppError(
          'This audio format is not supported. Try Safari or Chrome.',
        );
      return json({
        text: await transcribeAudio(
          key,
          file,
          s.fetcher,
          (await getTools(s.db, s.owner)).vocabulary,
        ),
      });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    console.error(
      'DO API failed',
      e instanceof Error ? e.name : 'UnknownError',
    );
    return json(
      { error: 'Something went wrong saving your workspace. Please retry.' },
      500,
    );
  }
}
