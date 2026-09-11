import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { createAppAuth, consumeAuthLimit, resolveWorkspaceOwner, authReady, googleReady } from '../lib/app-auth';
import { handleAPI, type Services } from '../lib/server';
import { limitSharedAI } from '../lib/shared-ai';
import { encryptCredential } from '../lib/crypto';

async function database() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}', compatibilityDate: '2026-05-22', d1Databases: ['DB'] });
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint')) {
      if (sql.trim()) await db.prepare(sql.trim()).run();
    }
  }
  return { mf, db };
}

void test('real password signup, username login, session revocation and ownership migration', async () => {
  const { mf, db } = await database();
  try {
    const config = { DB: db, BETTER_AUTH_URL: 'https://do.example', BETTER_AUTH_SECRET: 'synthetic-auth-secret-at-least-32-characters' };
    assert.equal(authReady({ DB: db }), false);
    assert.equal(googleReady(config), false);
    const auth = createAppAuth(config);
    const call = (path: string, body?: unknown, cookie = '', origin = 'https://do.example') => auth.handler(new Request(`https://do.example/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'cf-connecting-ip': '192.0.2.1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const signup = await call('sign-up/email', { username: 'tester', name: 'Test User', email: 'test@example.com', password: 'synthetic-password-1234' });
    assert.equal(signup.status, 200, await signup.clone().text());
    const cookie = signup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.match(signup.headers.get('set-cookie') ?? '', /HttpOnly/i);
    assert.match(signup.headers.get('set-cookie') ?? '', /Secure/i);
    const data = await signup.json() as { user: { id: string; email: string } };
    const stored = await db.prepare('SELECT password FROM auth_account WHERE user_id=?').bind(data.user.id).first<{ password: string }>();
    assert(stored?.password && !stored.password.includes('synthetic-password'));
    assert.equal((await call('get-session', undefined, cookie)).status, 200);
    const active = await (await call('get-session', undefined, cookie)).json() as { user: { id: string } };
    assert.equal(active.user.id, data.user.id);
    assert.equal(await resolveWorkspaceOwner(db, data.user, null), data.user.id);
    assert.equal(await resolveWorkspaceOwner(db, data.user, { userId: 'other-owner', email: 'other@example.com' }), data.user.id);
    assert.equal(await resolveWorkspaceOwner(db, data.user, { userId: 'original-access-owner', email: 'test@example.com' }), 'original-access-owner');
    assert.equal(await resolveWorkspaceOwner(db, data.user, null), 'original-access-owner');
    assert.equal((await call('sign-in/username', { username: 'tester', password: 'wrong-password' })).status, 401);
    assert.equal((await call('sign-in/username', { username: 'tester', password: 'synthetic-password-1234' }, '', 'https://evil.example')).status, 403);
    const signedIn = await call('sign-in/username', { username: 'TESTER', password: 'synthetic-password-1234' });
    assert.equal(signedIn.status, 200, await signedIn.clone().text());
    assert.equal((await call('sign-out', {}, cookie)).status, 200);
    assert.equal(await (await call('get-session', undefined, cookie)).json(), null);
    const google = createAppAuth({ ...config, GOOGLE_CLIENT_ID: 'synthetic-google-id', GOOGLE_CLIENT_SECRET: 'synthetic-google-secret' });
    const oauth = await google.handler(new Request('https://do.example/api/auth/sign-in/social', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://do.example', 'cf-connecting-ip': '192.0.2.3' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
    }));
    assert.equal(oauth.status, 200);
    const redirect = new URL((await oauth.json() as { url: string }).url);
    assert.equal(redirect.hostname, 'accounts.google.com');
    assert.equal(redirect.searchParams.get('redirect_uri'), 'https://do.example/api/auth/callback/google');
    assert.ok(redirect.searchParams.get('state'));
    assert.ok(redirect.searchParams.get('code_challenge'));
  } finally { await mf.dispose(); }
});

void test('distributed auth and shared AI limits cannot be bypassed with concurrent requests', async () => {
  const { mf, db } = await database();
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => consumeAuthLimit(db, 'same-client', { window: 60, max: 5 })));
    assert.equal(results.filter((r) => r.allowed).length, 5);
    const perUser = await Promise.allSettled(Array.from({ length: 20 }, () => limitSharedAI(db, 'alice', 5, 10)));
    assert.equal(perUser.filter((r) => r.status === 'fulfilled').length, 5);
    const global = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => limitSharedAI(db, `user-${i}`, 50, 10)));
    assert.equal(global.filter((r) => r.status === 'fulfilled').length, 5);
    await db.prepare('UPDATE shared_ai_usage SET day=day-1').run();
    await limitSharedAI(db, 'alice', 5, 10);
  } finally { await mf.dispose(); }
});

void test('included AI keeps the key server-side, requires consent and authentication, fixes the model and enforces quota', async () => {
  const { mf, db } = await database();
  try {
    let calls = 0;
    const services: Services = { db, owner: 'alice', encryptionKey: '', sharedGroqKey: 'gsk_synthetic_shared_server_secret', sharedDailyLimit: 2, sharedGlobalDailyLimit: 10, fetcher: async (_input, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer gsk_synthetic_shared_server_secret');
      assert.equal(JSON.parse(init?.body as string).model, 'openai/gpt-oss-120b');
      return Response.json({ choices: [{ message: { content: 'Clean text.' } }] });
    } };
    const call = (path: string, body?: unknown, overrides: Partial<Services> = {}) => handleAPI(new Request(`https://do.example/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'https://do.example', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }), { ...services, ...overrides });
    const settings = await (await call('settings')).text();
    assert(!settings.includes('gsk_'));
    assert.equal(JSON.parse(settings).connected, true);
    assert.equal(JSON.parse(settings).shared, true);
    assert.equal((await call('transform', { text: 'hello', kind: 'clean' })).status, 403);
    assert.equal((await call('transform', { text: 'hello', kind: 'clean' }, { owner: '' })).status, 401);
    await call('settings', { action: 'consent', consent: true });
    await db.prepare("UPDATE preferences SET model='arbitrary-expensive-model' WHERE owner='alice'").run();
    assert.equal((await call('transform', { text: 'hello', kind: 'clean' })).status, 200);
    assert.equal((await call('transform', { text: 'hello', kind: 'clean' })).status, 200);
    assert.equal((await call('transform', { text: 'hello', kind: 'clean' })).status, 429);
    assert.equal(calls, 2);
    const alice = await (await call('settings')).json() as { allowance: { remaining: number } };
    const bob = await (await call('settings', undefined, { owner: 'bob' })).json() as { allowance: { remaining: number } };
    assert.equal(alice.allowance.remaining, 0);
    assert.equal(bob.allowance.remaining, 2);
  } finally { await mf.dispose(); }
});

void test('an existing encrypted service credential can serve another account without exposing or deleting it', async () => {
  const { mf, db } = await database();
  try {
    const encryptionKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const encrypted = await encryptCredential('gsk_existing_service_key', encryptionKey, 'service-owner');
    await db.prepare('INSERT INTO preferences (owner,encrypted_key,consent) VALUES (?,?,1)').bind('service-owner', encrypted).run();
    await db.prepare('INSERT INTO preferences (owner,consent) VALUES (?,1)').bind('new-user').run();
    const s: Services = { db, owner: 'new-user', encryptionKey, sharedGroqOwner: 'service-owner', fetcher: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer gsk_existing_service_key');
      return Response.json({ choices: [{ message: { content: 'Ready.' } }] });
    } };
    const request = (path: string, body: unknown) => new Request('https://do.example/api/' + path, { method: 'POST', headers: { Origin: 'https://do.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await handleAPI(request('transform', { text: 'hello', kind: 'clean' }), s)).status, 200);
    assert.equal((await handleAPI(request('settings', { action: 'disconnect' }), { ...s, owner: 'service-owner' })).status, 409);
    assert.equal((await db.prepare('SELECT encrypted_key FROM preferences WHERE owner=?').bind('service-owner').first<{ encrypted_key: string }>())?.encrypted_key, encrypted);
  } finally { await mf.dispose(); }
});
