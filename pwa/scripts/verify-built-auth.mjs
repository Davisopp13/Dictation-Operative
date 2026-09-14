import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

// Run the shipped Worker against isolated storage; no production users or secrets.
const origin = 'http://localhost';
const alternate = 'http://alternate.localhost';
const mf = new Miniflare({
  modulesRoot: 'dist/server',
  modules: [
    'index.js',
    ...readdirSync('dist/server', { recursive: true }).filter((file) => file.endsWith('.js') && file !== 'index.js'),
  ].map((file) => ({ type: 'ESModule', path: 'dist/server/' + file })),
  compatibilityDate: '2026-05-22',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  r2Buckets: ['IMAGES'],
  bindings: {
    BETTER_AUTH_URL: origin,
    AUTH_ADDITIONAL_ORIGINS: alternate,
    BETTER_AUTH_SECRET: 'synthetic-built-auth-secret-at-least-32-characters',
  },
});

try {
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('drizzle').filter((file) => file.endsWith('.sql')).sort())
    for (const sql of readFileSync('drizzle/' + file, 'utf8').split('--> statement-breakpoint'))
      if (sql.trim()) await db.prepare(sql.trim()).run();
  const request = (path, body, cookie = '', host = origin) => mf.dispatchFetch(host + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, Origin: host, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const page = await request('/account/sign-in');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Account sign-in/);
  const loginPage = await request('/login', undefined, '', alternate);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /Email or username/);
  const anonymous = await request('/api/auth/password-setup', { newPassword: 'synthetic-new-password' });
  assert.equal(anonymous.status, 401);
  await anonymous.text();
  const signup = await request('/api/auth/sign-up/email', {
    email: 'built-auth@example.test', username: 'builtfixture', name: 'Synthetic Google User', password: 'synthetic-initial-password',
  });
  assert.equal(signup.status, 200, await signup.clone().text());
  const { user } = await signup.json();
  const cookie = signup.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  await db.prepare("UPDATE auth_account SET provider_id='google', account_id='synthetic-google-subject', password=NULL WHERE user_id=?").bind(user.id).run();
  await db.prepare('UPDATE auth_user SET username=NULL, display_username=NULL, email_verified=1 WHERE id=?').bind(user.id).run();
  const status = await request('/api/auth/password-setup', undefined, cookie);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).hasPassword, false);
  const added = await request('/api/auth/password-setup', { newPassword: 'synthetic-new-password' }, cookie);
  assert.equal(added.status, 200, await added.clone().text());
  await added.text();
  const login = await request('/api/auth/sign-in/email', { email: user.email, password: 'synthetic-new-password' }, '', alternate);
  assert.equal(login.status, 200, await login.clone().text());
  assert.equal((await login.json()).user.id, user.id);
  assert.equal(login.headers.get('Location'), null);
  const alternateCookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const ready = await request('/api/auth/password-setup', undefined, alternateCookie, alternate);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { email: user.email, hasPassword: true, googleConnected: true, needsReauthentication: false });
  const workspace = await request('/api/library', undefined, alternateCookie, alternate);
  assert.equal(workspace.status, 200, await workspace.clone().text());
  await workspace.text();
  console.log('Built Worker passed: setup route, protected password creation, same-account alternate-host login and workspace access.');
} finally {
  await mf.dispose();
}
