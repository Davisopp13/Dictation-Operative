import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { getAppAuth, resolveWorkspaceOwner } from '../lib/app-auth';
import { handlePasswordSetup } from '../lib/password-setup';

void test('Google users add a password to the same account and sign in on the alternate host', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}', compatibilityDate: '2026-05-22', d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB');
    for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter((file) => file.endsWith('.sql')).sort()) {
      for (const sql of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint')) {
        if (sql.trim()) await db.prepare(sql.trim()).run();
      }
    }
    const origin = 'https://do.example';
    const alternate = 'https://alternate.example';
    const config = { DB: db, BETTER_AUTH_URL: origin, AUTH_ADDITIONAL_ORIGINS: alternate, BETTER_AUTH_SECRET: 'synthetic-secret-for-password-setup-at-least-32-characters' };
    const auth = await getAppAuth(config);
    const call = (path: string, body: unknown, cookie = '', host = origin) => auth.handler(new Request(`${host}/api/auth/${path}`, {
      method: 'POST', headers: { Origin: host, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    const signup = await call('sign-up/email', { email: 'google-user@example.com', username: 'fixture', name: 'Google User', password: 'synthetic-initial-password' });
    assert.equal(signup.status, 200);
    const { user } = await signup.json() as { user: { id: string; email: string } };
    const cookie = signup.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    // Seed the persisted state of a verified Google-only account. Google itself
    // is external; session validation, password hashing and subsequent login are real.
    await db.prepare("UPDATE auth_account SET provider_id='google', account_id='synthetic-google-subject', password=NULL WHERE user_id=?").bind(user.id).run();
    await db.prepare('UPDATE auth_user SET username=NULL, display_username=NULL, email_verified=1 WHERE id=?').bind(user.id).run();
    await db.prepare('INSERT INTO auth_legacy_owner (user_id,owner) VALUES (?,?)').bind(user.id, 'existing-workspace').run();
    await db.prepare("INSERT INTO preferences (owner,consent,model) VALUES ('existing-workspace',1,'saved-model')").run();
    const request = (body?: unknown, sessionCookie = cookie, requestOrigin: string | null = origin, host = origin) => new Request(`${host}/api/auth/password-setup`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/json', ...(requestOrigin ? { Origin: requestOrigin } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const password = 'synthetic-second-sign-in-password';
    const payload = { newPassword: password, userId: 'not-the-session-user', email: 'not-this-account@example.com' };
    assert.equal((await handlePasswordSetup(request(undefined, ''), config)).status, 401);
    assert.equal((await handlePasswordSetup(request(payload, ''), config)).status, 401);
    assert.equal((await handlePasswordSetup(request(payload, cookie, null), config)).status, 403);
    assert.equal((await handlePasswordSetup(request(payload, cookie, 'https://evil.example'), config)).status, 403);
    assert.equal((await handlePasswordSetup(request(payload, cookie, 'https://evil.example', 'https://evil.example'), config)).status, 403);
    const status = await handlePasswordSetup(request(), config);
    assert.equal(status.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await status.json(), { email: user.email, hasPassword: false, googleConnected: true, needsReauthentication: false });

    await db.prepare('UPDATE auth_session SET created_at=? WHERE user_id=?').bind(Date.now() - 11 * 60 * 1000, user.id).run();
    const stale = await handlePasswordSetup(request(payload), config);
    assert.equal(stale.status, 403);
    assert.equal((await stale.json() as { code: string }).code, 'REAUTHENTICATION_REQUIRED');
    await db.prepare('UPDATE auth_session SET created_at=? WHERE user_id=?').bind(Date.now(), user.id).run();
    assert.equal((await handlePasswordSetup(request({ newPassword: 'too-short' }), config)).status, 400);
    assert.equal((await handlePasswordSetup(request({ newPassword: 'x'.repeat(129) }), config)).status, 400);

    // A double click cannot replace the first password or create duplicate credentials.
    const attempts = await Promise.all([handlePasswordSetup(request(payload), config), handlePasswordSetup(request(payload), config)]);
    assert.equal(attempts.filter((response) => response.status === 200).length, 1);
    assert(attempts.every((response) => [200, 400, 409].includes(response.status)));
    const accounts = await db.prepare('SELECT provider_id,password FROM auth_account WHERE user_id=? ORDER BY provider_id').bind(user.id).all<{ provider_id: string; password: string | null }>();
    assert.deepEqual(accounts.results.map((account) => account.provider_id), ['credential', 'google']);
    assert(accounts.results[0].password && accounts.results[0].password !== password);
    assert.equal(accounts.results[1].password, null);
    const ready = await handlePasswordSetup(request(), config);
    assert.equal((await ready.json() as { hasPassword: boolean }).hasPassword, true);

    await db.prepare('DELETE FROM auth_throttle').run();
    assert.equal((await handlePasswordSetup(request({ newPassword: 'another-synthetic-password' }), config)).status, 409);
    assert.equal((await call('sign-in/email', { email: user.email, password: 'wrong-password' }, '', alternate)).status, 401);
    const login = await call('sign-in/email', { email: user.email, password }, '', alternate);
    assert.equal(login.status, 200, await login.clone().text());
    assert.equal(login.headers.get('Location'), null);
    const signedIn = await login.json() as { user: { id: string; email: string } };
    assert.equal(signedIn.user.id, user.id);
    assert.equal(await resolveWorkspaceOwner(db, signedIn.user, null), 'existing-workspace');
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM auth_user').first<{ count: number }>())?.count, 1);
    assert.equal((await db.prepare("SELECT model FROM preferences WHERE owner='existing-workspace'").first<{ model: string }>())?.model, 'saved-model');
    const alternateCookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const alternateStatus = await handlePasswordSetup(request(undefined, alternateCookie, alternate, alternate), config);
    assert.equal(alternateStatus.status, 200);
    assert.equal((await alternateStatus.json() as { googleConnected: boolean }).googleConnected, true);
    for (let i = 0; i < 4; i++) await handlePasswordSetup(request(payload), config);
    assert.equal((await handlePasswordSetup(request(payload), config)).status, 429);
    await call('sign-out', {}, cookie);
    assert.equal((await handlePasswordSetup(request(payload), config)).status, 401);
  } finally { await mf.dispose(); }
});
