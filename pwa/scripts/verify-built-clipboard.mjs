import { installTestReleaseFence } from './release-fence-fixture.mjs';
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

// Exercise the shipped scheduled handler with isolated storage and synthetic data.
const origin = 'http://localhost';
const mf = new Miniflare({
  modulesRoot: 'dist/server',
  modules: [
    'index.js',
    ...readdirSync('dist/server', { recursive: true }).filter(
      (file) => file.endsWith('.js') && file !== 'index.js',
    ),
  ].map((file) => ({ type: 'ESModule', path: 'dist/server/' + file })),
  compatibilityDate: '2026-05-22',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  r2Buckets: ['IMAGES'],
  bindings: { WORKSPACE_WRITE_FENCE: 'on', DEV_USER_EMAIL: 'built-clipboard@example.test' },
});
try {
  let db = await mf.getD1Database('DB');
  const bucket = await mf.getR2Bucket('IMAGES');
  for (const file of readdirSync('drizzle')
    .filter((file) => file.endsWith('.sql'))
    .sort())
    for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
      '--> statement-breakpoint',
    ))
      if (sql.trim()) await db.prepare(sql.trim()).run();
  db = await installTestReleaseFence(db);
  const request = (path, data) =>
    mf.dispatchFetch(origin + '/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Host: 'localhost',
        Origin: origin,
        'Content-Type': 'application/json',
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  assert.equal(
    (await (await request('settings')).json()).clipboardDailyCleanup,
    false,
  );
  const clips = [];
  for (const [clipboardItem, pinned] of [
    [true, false],
    [true, true],
    [false, false],
  ]) {
    const response = await request('clips', {
      id: crypto.randomUUID(),
      kind: 'note',
      content: 'Synthetic retention fixture',
      clipboardItem,
      pinned,
    });
    assert.equal(response.status, 201);
    clips.push(await response.json());
  }
  const now = Date.now();
  await db
    .prepare('UPDATE clips SET created_at=?')
    .bind(now - 86400001)
    .run();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const saved = await mf.dispatchFetch(origin + '/api/images', {
    method: 'POST',
    headers: { Host: 'localhost', Origin: origin, 'Content-Type': 'image/png' },
    body: png,
  });
  assert.equal(saved.status, 201);
  const image = await saved.json();
  await db
    .prepare('UPDATE clipboard_images SET created_at=? WHERE id=?')
    .bind(now - 86400001, image.id)
    .run();
  const worker = await mf.getWorker();
  await worker.scheduled({ scheduledTime: now, cron: '0 8 * * *' });
  assert.ok(
    await db
      .prepare('SELECT id FROM clips WHERE id=?')
      .bind(clips[0].id)
      .first(),
  );
  const optIn = await request('settings', {
    action: 'clipboard-cleanup',
    enabled: true,
  });
  assert.equal(optIn.status, 200);
  assert.equal((await optIn.json()).clipboardDailyCleanup, true);
  await worker.scheduled({ scheduledTime: now, cron: '0 8 * * *' });
  assert.equal(
    await db
      .prepare('SELECT id FROM clips WHERE id=?')
      .bind(clips[0].id)
      .first(),
    null,
  );
  for (const clip of clips.slice(1))
    assert.ok(
      await db.prepare('SELECT id FROM clips WHERE id=?').bind(clip.id).first(),
    );
  assert.equal(
    await db
      .prepare('SELECT id FROM clipboard_images WHERE id=?')
      .bind(image.id)
      .first(),
    null,
  );
  assert.equal(await bucket.get(`clipboard/${image.id}.png`), null);
  assert.equal((await request('library')).status, 200);
  console.log(
    'Built Worker passed: opt-in setting, real scheduled cleanup, pinned text/history protection and image file deletion.',
  );
} finally {
  await mf.dispose();
}
