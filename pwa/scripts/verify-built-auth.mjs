import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

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

  // Native sign-in on the real Worker runtime: token signing and verification
  // use Web Crypto there, which the Node test suite does not exercise.
  const resource = 'urn:catchall-desk:workspace-api';
  const redirect = 'com.example.catchall:/oauth';
  await db.batch([
    db.prepare(`INSERT INTO auth_oauth_client (id,client_id,name,redirect_uris,token_endpoint_auth_method,application_type,grant_types,response_types,require_pkce,disabled,dpop_bound_access_tokens,client_credentials_scopes,scopes,created_at,updated_at)
      VALUES ('built-client','built-native','Built check app',?,'none','native','["authorization_code","refresh_token"]','["code"]',1,0,0,'[]','["openid","email","offline_access","workspace"]',?,?)`).bind(JSON.stringify([redirect]), Date.now(), Date.now()),
    db.prepare("INSERT INTO auth_oauth_client_resource (id,client_id,resource_id,created_at) VALUES ('built-link','built-native',?,?)").bind(resource, Date.now()),
  ]);
  const verifier = randomBytes(32).toString('base64url');
  const authorize = await mf.dispatchFetch(origin + '/api/auth/oauth2/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: 'built-native', redirect_uri: redirect, scope: 'openid email offline_access workspace',
    state: 'built-state', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource,
  }), { headers: { Cookie: cookie }, redirect: 'manual' });
  // A browser navigation is answered with a 302. This harness can only send
  // script-style fetches, which get the same destination as JSON.
  assert.ok([200, 302].includes(authorize.status), (await authorize.clone().text()).slice(0, 300));
  const consentURL = new URL(authorize.status === 302 ? authorize.headers.get('Location') : (await authorize.json()).url, origin);
  assert.equal(consentURL.pathname, '/oauth/consent');
  const consentPage = await mf.dispatchFetch(consentURL, { headers: { Cookie: cookie } });
  assert.equal(consentPage.status, 200);
  assert.match(await consentPage.text(), /Allow Built check app\?/);
  const consent = await request('/api/auth/oauth2/consent', { accept: true, oauth_query: consentURL.search.slice(1) }, cookie);
  assert.equal(consent.status, 200, await consent.clone().text());
  const back = new URL((await consent.json()).url);
  const token = await mf.dispatchFetch(origin + '/api/auth/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code'), redirect_uri: redirect, client_id: 'built-native', code_verifier: verifier, resource }),
  });
  assert.equal(token.status, 200, await token.clone().text());
  const tokens = await token.json();
  const bearer = (path, init = {}) => mf.dispatchFetch(origin + path, { ...init, headers: { Authorization: 'Bearer ' + tokens.access_token, ...(init.headers ?? {}) } });
  const saved = await bearer('/api/v1/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), content: 'Saved by the built native check' }) });
  assert.equal(saved.status, 201, await saved.clone().text());
  const nativeText = await saved.json();
  const listed = await bearer('/api/v1/text');
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).items.length, 1);
  const nativePileRequest = {operationId:crypto.randomUUID(),name:'Native pile'};
  const nativePileResponse = await bearer('/api/v1/piles', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(nativePileRequest)});
  assert.equal(nativePileResponse.status,201,await nativePileResponse.clone().text());
  const nativePile=(await nativePileResponse.json()).pile;
  const nativeRead=await bearer('/api/v1/piles/'+nativePile.id);assert.equal(nativeRead.status,200);assert.equal((await nativeRead.json()).pile.name,'Native pile');
  const nativeImpactResponse=await bearer('/api/v1/piles/'+nativePile.id+'/deletion-impact');assert.equal(nativeImpactResponse.status,200);const nativeImpact=await nativeImpactResponse.json();
  const nativeDelete=await bearer('/api/v1/piles/'+nativePile.id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:crypto.randomUUID(),revision:nativePile.revision,impactToken:nativeImpact.impactToken,mode:'pin'})});assert.equal(nativeDelete.status,200,await nativeDelete.clone().text());
  // P2 uses the same real PKCE bearer and owner boundary, without Origin.
  await db.prepare("INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,clipboard_item,created_at,updated_at) SELECT 'native-legacy-p2',owner,'Legacy','note','body','body','[]','[]','Native collection',1,0,0 FROM clips WHERE id=?").bind(nativeText.id).run();
  const pendingResponse = await bearer('/api/v1/collection-backfill');
  assert.equal(pendingResponse.status,200); assert.equal(pendingResponse.headers.get('Cache-Control'),'no-store');
  assert.equal((await pendingResponse.json()).pending,1);
  const advanced = await bearer('/api/v1/collection-backfill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:1})});
  assert.equal(advanced.status,200,await advanced.clone().text());
  const state=await advanced.json(); assert.equal(state.processed,1); assert.equal(state.complete,true);
  const mapped=await bearer('/api/v1/items/text/native-legacy-p2'); assert.equal((await mapped.json()).cleanup.reason,'pile');
  const tampered = await mf.dispatchFetch(origin + '/api/v1/text', { headers: { Authorization: 'Bearer ' + tokens.access_token.slice(0, -3) + 'AAA' } });
  assert.equal(tampered.status, 401);
  await tampered.text();
  const refreshed = await mf.dispatchFetch(origin + '/api/auth/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: 'built-native', resource }),
  });
  assert.equal(refreshed.status, 200, await refreshed.clone().text());
  await refreshed.text();
  console.log('Built Worker passed: setup route, protected password creation, same-account alternate-host login and workspace access, native sign-in with PKCE, bearer access and refresh.');
} finally {
  await mf.dispose();
}
