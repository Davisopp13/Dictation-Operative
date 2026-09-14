import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
// Exercises the production bundle in workerd with isolated D1/R2 and synthetic
// credentials. The seed route exists only in this in-memory test wrapper.
const mf = new Miniflare({
  modulesRoot: 'dist/server',
  modules: [
    {
      type: 'ESModule',
      path: 'dist/server/test-entry.js',
      contents: `import app from './index.js'; export default {async fetch(request,env,ctx){if(new URL(request.url).pathname==='/__seed'){await env.IMAGES.put(request.headers.get('key'),request.body);return new Response('seeded');} return app.fetch(request,env,ctx);}}`,
    },
    ...[
      'index.js',
      ...readdirSync('dist/server', { recursive: true }).filter(
        (f) => f.endsWith('.js') && f !== 'index.js',
      ),
    ].map((f) => ({ type: 'ESModule', path: 'dist/server/' + f })),
  ],
  compatibilityDate: '2026-05-22',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  r2Buckets: ['IMAGES'],
  bindings: {
    BETTER_AUTH_URL: 'http://localhost',
    BETTER_AUTH_SECRET: 'local-test-only-secret-with-at-least-32-characters',
    CREDENTIAL_ENCRYPTION_KEY: '',
    SHARED_AI_DAILY_LIMIT: '50',
    SHARED_AI_GLOBAL_DAILY_LIMIT: '1000',
  },
});
try {
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    for (const sql of readFileSync('drizzle/' + f, 'utf8').split(
      '--> statement-breakpoint',
    ))
      if (sql.trim()) await db.prepare(sql.trim()).run();
  console.log('Local migrations ready');
  const sha =
    '73b8814378250efed01a99855f0d6cf390c9c1ef0c9be2d8ca2d8b2df7f7a5b3';
  const seed = await mf.dispatchFetch('http://localhost/__seed', {
    method: 'PUT',
    headers: {
      key: `releases/windows/0.2.0/${sha}/DO-HotkeyProbe-win-x64.zip`,
      'Content-Length': '49860578',
    },
    body: Readable.toWeb(
      createReadStream('../windows/dist/DO-HotkeyProbe-win-x64.zip'),
    ),
    duplex: 'half',
  });
  assert.equal(seed.status, 200, await seed.text());
  console.log('R2 package seeded');
  const signup = await mf.dispatchFetch(
    'http://localhost/api/auth/sign-up/email',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
      },
      body: JSON.stringify({
        username: 'localtester',
        name: 'Local Test',
        email: 'local@example.test',
        password: 'local-test-password-123',
      }),
    },
  );
  assert.equal(signup.status, 200, await signup.clone().text());
  const cookie = signup.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  await signup.text();
  for (let i = 0; i < 3; i++) {
    const r = await mf.dispatchFetch(
      'http://localhost/api/windows-downloads/x64',
      { headers: { Cookie: cookie } },
    );
    const hash = createHash('sha256');
    for await (const chunk of r.body) hash.update(chunk);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Content-Length'), '49860578');
    assert.equal(hash.digest('hex'), sha);
    console.log('Full authenticated download', i + 1, 'checksum passed');
  }
  const paths = ['library', 'images', 'windows-downloads/x64'];
  const responses = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      mf.dispatchFetch('http://localhost/api/' + paths[i % 3], {
        method: i % 3 === 2 ? 'HEAD' : 'GET',
        headers: i % 2 ? { Cookie: cookie } : {},
      }),
    ),
  );
  assert.deepEqual(
    responses.map((r) => r.status),
    Array.from({ length: 12 }, (_, i) => (i % 2 ? 200 : 401)),
  );
  await Promise.all(responses.map((r) => r.text()));
  console.log(
    'Concurrent requests correctly isolate signed-in and anonymous users',
  );
  const out = await mf.dispatchFetch('http://localhost/api/auth/sign-out', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'http://localhost',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(out.status, 200);
  await out.text();
  const revoked = await mf.dispatchFetch(
    'http://localhost/api/windows-downloads/x64',
    { headers: { Cookie: cookie } },
  );
  assert.equal(revoked.status, 401);
  await revoked.text();
  console.log('Revoked session cannot download');
} finally {
  await mf.dispose();
}
