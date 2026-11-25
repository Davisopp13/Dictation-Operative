import { verifyJwsAccessToken } from 'better-auth/oauth2';
import {
  authReady,
  getAppAuth,
  resolveWorkspaceOwner,
  type AuthConfig,
} from './app-auth';
import type { User } from './identity';
import { WORKSPACE_RESOURCE, WORKSPACE_SCOPE } from './oauth';

/** The bearer token of a request, or null when it carries none. */
export function bearerToken(headers: Headers): string | null {
  const match = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(
    headers.get('Authorization') ?? '',
  );
  return match ? match[1] : null;
}

/**
 * Resolves a native client's access token to its workspace, or null when the
 * token must not be accepted. The token must be signed by this server, be
 * unexpired, be issued for the workspace API, carry the workspace scope, and
 * belong to a user who still exists. The result is the same workspace owner a
 * browser session for that user resolves to.
 *
 * Cookies are never consulted here.
 */
export async function resolveBearerUser(
  config: AuthConfig,
  token: string,
): Promise<User | null> {
  if (!authReady(config)) return null;
  const auth = await getAppAuth(config);
  let subject: string;
  try {
    const payload = await verifyJwsAccessToken(token, {
      // The signing keys are read from the database, never over HTTP.
      jwksFetch: () => auth.api.getJwks(),
      jwksCacheKey: auth,
      verifyOptions: {
        issuer: (await auth.$context).baseURL,
        audience: WORKSPACE_RESOURCE,
        typ: 'at+jwt',
        requiredClaims: ['sub', 'exp', 'azp'],
      },
    });
    const scopes =
      typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
    if (!scopes.includes(WORKSPACE_SCOPE) || typeof payload.sub !== 'string')
      return null;
    subject = payload.sub;
  } catch {
    // Bad signature, wrong issuer or audience, expired, or not a token.
    return null;
  }
  // A signed token outlives its user until it expires. This lookup is what
  // makes account deletion take effect at once.
  const user = await config.DB.prepare(
    'SELECT id,email,name FROM auth_user WHERE id=?',
  )
    .bind(subject)
    .first<{ id: string; email: string; name: string }>();
  if (!user) return null;
  return {
    userId: await resolveWorkspaceOwner(config.DB, user, null),
    email: user.email,
    displayName: user.name,
    fullName: user.name,
  };
}
