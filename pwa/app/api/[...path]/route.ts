import { env } from 'cloudflare:workers';
import { getUser } from '@/app/auth';
import { checkOrigin } from '@/lib/server';
import { readBounded } from '@/lib/request';
import { handleAPI } from '@/lib/server';
async function handle(request: Request) {
  const user = await getUser();
  const accountRelay = /^\/api\/account-relay\/([a-f0-9]{64})\/(state|register|rename|revoke|settings|clipboard(?:\/[a-zA-Z0-9_-]{8,80})?)$/.exec(new URL(request.url).pathname);
  if (accountRelay) {
    if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
    try {
      checkOrigin(request);
      const payload = request.method === 'POST' ? await readBounded(request, 12 * 1024 * 1024 + 4096) : undefined;
      const response = await env.SYNC_ACCOUNTS.fetch(new Request(`https://account.internal/v1/accounts/${accountRelay[1]}/${accountRelay[2]}`, {
        method: request.method, headers: { 'X-DO-Owner': user.userId, 'Authorization': request.headers.get('Authorization') ?? '', 'Content-Type': 'application/json' }, body: payload,
      }));
      return new Response(response.body, response);
    } catch { return Response.json({ error: 'Account request failed.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } }); }
  }
  if (new URL(request.url).pathname === '/api/account') {
    if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
    if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405 });
    try {
      checkOrigin(request);
      const payload = request.method === 'POST' ? await readBounded(request, 2048) : new TextEncoder().encode('{}');
      const response = await env.SYNC_ACCOUNTS.fetch(new Request('https://account.internal/', {
        method: 'POST', headers: { 'X-DO-Owner': user.userId, 'Content-Type': 'application/json' }, body: payload,
      }));
      return new Response(response.body, response);
    } catch { return Response.json({ error: 'Account service unavailable. Please retry.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  }
  return handleAPI(request, {
    db: env.DB,
    images: env.IMAGES,
    owner: user?.userId ?? '',
    encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY ?? '',
  });
}
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

export const PUT = POST;
