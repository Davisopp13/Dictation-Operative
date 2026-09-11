import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { headers } from 'next/headers';
import { authReady, createAppAuth, resolveWorkspaceOwner } from '@/lib/app-auth';

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

type AuthEnv = {
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

function accessConfig(): { teamDomain: string; aud: string } | null {
  const e = env as AuthEnv;
  if (!e.ACCESS_TEAM_DOMAIN || !e.ACCESS_AUD) return null;
  return { teamDomain: teamOrigin(e.ACCESS_TEAM_DOMAIN), aud: e.ACCESS_AUD };
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
function devUser(requestHeaders: Headers): User | null {
  const email = (env as AuthEnv).DEV_USER_EMAIL;
  const host = requestHeaders.get('host') ?? '';
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!email || !isLocal || accessConfig()) return null;
  return { userId: 'local_dev', displayName: email, email, fullName: null };
}

export async function getUser(): Promise<User | null> {
  const requestHeaders = await headers();
  const config = accessConfig();
  const legacy = config ? await accessUser(requestHeaders, config) : null;
  if (authReady(env)) {
    const session = await createAppAuth(env).api.getSession({ headers: requestHeaders });
    if (session) {
      const userId = await resolveWorkspaceOwner(env.DB, session.user, legacy);
      return { userId, email: session.user.email, displayName: session.user.name, fullName: session.user.name };
    }
  }
  if (legacy) return legacy;
  if (config) return null;
  return devUser(requestHeaders);
}

/// Public account entry with a same-origin return destination.
export function signInPath(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function signOutPath(): string {
  return accessConfig() ? ACCESS_LOGOUT_PATH : '/login';
}

export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';

  let url: URL;
  try {
    url = new URL(value, 'https://app.local');
  } catch {
    return '/';
  }
  if (url.origin !== 'https://app.local') return '/';
  if (url.pathname.startsWith('/cdn-cgi/')) return '/';

  return `${url.pathname}${url.search}${url.hash}`;
}
