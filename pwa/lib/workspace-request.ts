import { resolveUser, logoutPath } from './identity';
import { checkOrigin, handleAPI } from './server';
import { readBounded } from './request';
import { bearerToken, resolveBearerUser } from './bearer';
export async function handleWorkspaceRequest(request: Request, env: Cloudflare.Env) {
  const pathname = new URL(request.url).pathname;
  // Native clients call /api/v1 with a bearer access token. A request that
  // presents one is judged on that token alone: an invalid token is refused
  // even if the request also carries a valid session cookie, and a bearer
  // token is not accepted anywhere outside /api/v1.
  const token = pathname.startsWith('/api/v1/') ? bearerToken(request.headers) : null;
  if (token !== null) {
    const bearer = await resolveBearerUser(env, token);
    if (!bearer)
      return Response.json(
        { error: 'This sign-in has expired. Sign in again.' },
        {
          status: 401,
          headers: {
            'Cache-Control': 'no-store',
            'WWW-Authenticate': 'Bearer error="invalid_token"',
          },
        },
      );
    return handleAPI(request, {
      db: env.DB,
      images: env.IMAGES,
      content: env.IMAGES,
      owner: bearer.userId,
      via: 'bearer',
    });
  }
  const user = await resolveUser(env, request.headers);
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
    content: env.IMAGES,
    owner: user?.userId ?? '',
    logoutPath: logoutPath(env),
  });
}
