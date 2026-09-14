import { createRemoteJWKSet, jwtVerify } from 'jose';
import { authReady, getAppAuth, resolveWorkspaceOwner, type AuthConfig } from './app-auth';

export type User = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

/// Legacy beta identity. App sessions take precedence during the migration.
/// An Access header is accepted only after signature, issuer and audience checks.
const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
const ACCESS_LOGOUT_PATH = '/cdn-cgi/access/logout';

export type IdentityEnv = AuthConfig & {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_USER_EMAIL?: string;
};

let keySet: { teamDomain: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null =
  null;

/// The team's public signing keys, fetched once per isolate and refreshed by
/// jose when a token references an unknown key.
function accessKeys(teamDomain: string) {
  if (keySet?.teamDomain !== teamDomain) {
    keySet = {
      teamDomain,
      jwks: createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain)),
    };
  }
  return keySet.jwks;
}

/// "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/" →
/// "https://team.cloudflareaccess.com", which is also the JWT issuer.
function teamOrigin(value: string): string {
  const withScheme = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return new URL(withScheme).origin;
}

function accessConfig(env: IdentityEnv): { teamDomain: string; aud: string } | null {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  return { teamDomain: teamOrigin(env.ACCESS_TEAM_DOMAIN), aud: env.ACCESS_AUD };
}

async function accessUser(
  requestHeaders: Headers,
  config: { teamDomain: string; aud: string },
): Promise<User | null> {
  const token = requestHeaders.get(ACCESS_JWT_HEADER);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, accessKeys(config.teamDomain), {
      issuer: config.teamDomain,
      audience: config.aud,
    });
    const email = typeof payload.email === 'string' ? payload.email : null;
    // `sub` is Access's stable identifier for the person; it survives a
    // change of identity provider, which an email address may not.
    const userId = payload.sub || email;
    if (!email || !userId) return null;
    return { userId, displayName: email, email, fullName: null };
  } catch {
    // Expired, wrong audience, wrong issuer, bad signature: treat as signed out.
    return null;
  }
}

/// Local development has no Access in front of it. `DEV_USER_EMAIL` in the
/// ignored `.dev.vars` file stands in for a signed-in tester, and only when
/// the request really is to a local dev server.
function devUser(env: IdentityEnv, requestHeaders: Headers): User | null {
  const email = env.DEV_USER_EMAIL;
  const host = requestHeaders.get('host') ?? '';
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!email || !isLocal || accessConfig(env)) return null;
  return { userId: 'local_dev', displayName: email, email, fullName: null };
}

export async function resolveUser(env: IdentityEnv, requestHeaders: Headers): Promise<User | null> {
  const config = accessConfig(env);
  const legacy = config ? await accessUser(requestHeaders, config) : null;
  if (authReady(env)) {
    const session = await (await getAppAuth(env)).api.getSession({ headers: requestHeaders });
    if (session) {
      const userId = await resolveWorkspaceOwner(env.DB, session.user, legacy);
      return { userId, email: session.user.email, displayName: session.user.name, fullName: session.user.name };
    }
  }
  if (legacy) return legacy;
  if (config) return null;
  return devUser(env, requestHeaders);
}

export function logoutPath(env: IdentityEnv): string {
  return accessConfig(env) ? ACCESS_LOGOUT_PATH : '/login';
}
