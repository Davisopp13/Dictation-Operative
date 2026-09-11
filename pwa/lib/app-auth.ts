import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { username } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/auth-schema';

export type AuthConfig = {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  AUTH_ADDITIONAL_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export function authReady(e: AuthConfig) {
  return !!e.BETTER_AUTH_URL && (e.BETTER_AUTH_SECRET?.length ?? 0) >= 32;
}
export function googleReady(e: AuthConfig) {
  return authReady(e) && !!e.GOOGLE_CLIENT_ID && !!e.GOOGLE_CLIENT_SECRET;
}

export async function consumeAuthLimit(db: D1Database, key: string, rule: { window: number; max: number }) {
  const now = Date.now();
  const cutoff = now - rule.window * 1000;
  const row = await db.prepare(`INSERT INTO auth_throttle (key,count,started_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN started_at<=? THEN 1 ELSE MIN(count+1,?) END,
      started_at=CASE WHEN started_at<=? THEN excluded.started_at ELSE started_at END
    RETURNING count,started_at`).bind(key, now, cutoff, rule.max + 1, cutoff)
    .first<{ count: number; started_at: number }>();
  await db.prepare('DELETE FROM auth_throttle WHERE started_at<?').bind(now - 86400000).run();
  return {
    allowed: !!row && row.count <= rule.max,
    retryAfter: row && row.count <= rule.max ? null : Math.max(1, Math.ceil(((row?.started_at ?? now) + rule.window * 1000 - now) / 1000)),
  };
}

// Construct inside the request: D1 handles must not cross Worker requests.
export function createAppAuth(e: AuthConfig) {
  if (!authReady(e)) throw new Error('App sign-in is not configured.');
  const origin = new URL(e.BETTER_AUTH_URL!).origin;
  return betterAuth({
    appName: 'Dictation Operative',
    baseURL: origin,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(e.DB, { schema }), { provider: 'sqlite', schema, transaction: false }),
    trustedOrigins: [origin, ...(e.AUTH_ADDITIONAL_ORIGINS?.split(',').map((value) => new URL(value.trim()).origin) ?? [])],
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    // Do not merge an unverified password signup into a Google identity.
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    socialProviders: googleReady(e) ? {
      google: { clientId: e.GOOGLE_CLIENT_ID!, clientSecret: e.GOOGLE_CLIENT_SECRET!, prompt: 'select_account' },
    } : {},
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: origin.startsWith('https:'),
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    rateLimit: {
      enabled: true, window: 60, max: 60,
      customRules: {
        '/sign-up/email': { window: 3600, max: 5 },
        '/sign-in/username': { window: 60, max: 5 },
        '/sign-in/email': { window: 60, max: 5 },
      },
      customStorage: { consume: (key, rule) => consumeAuthLimit(e.DB, key, rule) },
    },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 30 })],
  });
}

export async function resolveWorkspaceOwner(db: D1Database, appUser: { id: string; email: string }, legacy: { userId: string; email: string } | null) {
  if (legacy && legacy.email.toLowerCase() === appUser.email.toLowerCase()) {
    await db.prepare('INSERT INTO auth_legacy_owner (user_id,owner) VALUES (?,?) ON CONFLICT DO NOTHING')
      .bind(appUser.id, legacy.userId).run();
  }
  const link = await db.prepare('SELECT owner FROM auth_legacy_owner WHERE user_id=?')
    .bind(appUser.id).first<{ owner: string }>();
  return link?.owner ?? appUser.id;
}
