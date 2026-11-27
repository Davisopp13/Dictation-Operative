import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = 'dist/server',
  origin = 'http://localhost';
const mf = new Miniflare({
  modulesRoot: root,
  modules: [
    'index.js',
    ...readdirSync(root, { recursive: true }).filter(
      (f) => f.endsWith('.js') && f !== 'index.js',
    ),
  ].map((file) => ({ type: 'ESModule', path: root + '/' + file })),
  compatibilityDate: '2026-05-22',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  r2Buckets: ['IMAGES'],
  bindings: {
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: 'synthetic-built-shared-secret-32-characters',
  },
});
try {
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
      '--> statement-breakpoint',
    ))
      if (sql.trim()) await db.prepare(sql.trim()).run();
  async function signup(username) {
    const response = await mf.dispatchFetch(
      origin + '/api/auth/sign-up/email',
      {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          email: `${username}@example.test`,
          name: username,
          password: 'synthetic-shared-password',
        }),
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const data = await response.json();
    return {
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
      owner: data.user.id,
    };
  }
  const alice = await signup('builtsharedalice'),
    bob = await signup('builtsharedbob');
  const request = (path, method = 'GET', body, cookie = alice.cookie) =>
    mf.dispatchFetch(origin + '/api/' + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const get = async (path, method = 'GET', body) => {
    const response = await request(path, method, body);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const create = async () => {
    const r = await request('v1/text', 'POST', {
      id: crypto.randomUUID(),
      content: 'Synthetic shared item',
    });
    assert.equal(r.status, 201);
    return r.json();
  };
  const kept = await create(),
    loose = await create();
  await db.prepare('UPDATE clips SET created_at=0').run();
  const createInput = { operationId: crypto.randomUUID(), name: 'Errands' };
  const createdResponse = await request('v1/piles', 'POST', createInput);
  assert.equal(
    createdResponse.status,
    201,
    await createdResponse.clone().text(),
  );
  const created = await createdResponse.json(),
    pileId = created.pile.id;
  const creationRetry = await get('v1/piles', 'POST', createInput);
  assert.equal(creationRetry.pile.id, pileId);
  assert.equal(creationRetry.replayed, true);
  const input = {
    operationId: crypto.randomUUID(),
    revision: 1,
    action: 'add',
    ref: { kind: 'text', id: kept.id },
  };
  const added = await get(`v1/piles/${pileId}/members`, 'POST', input);
  assert.equal(added.item.cleanup.reason, 'pile');
  assert.equal(
    (await request(`v1/piles/${pileId}/members`, 'GET', undefined, bob.cookie))
      .status,
    404,
  );
  assert.equal(
    (await request('v1/items/text/' + kept.id, 'GET', undefined, bob.cookie))
      .status,
    404,
  );
  assert.equal((await get('v1/piles')).piles.length, 1);
  assert.equal((await get(`v1/piles/${pileId}`)).pile.memberCount, 1);
  const renamed = await get(`v1/piles/${pileId}`, 'PATCH', {
    operationId: crypto.randomUUID(),
    revision: 2,
    name: 'Saturday errands',
    color: 'mint',
  });
  assert.equal(renamed.pile.revision, 3);
  const page = await get('v1/items?limit=1');
  assert.ok(page.nextCursor);
  await get('settings', 'POST', { action: 'clipboard-cleanup', enabled: true });
  await (
    await mf.getWorker()
  ).scheduled({ scheduledTime: Date.now(), cron: '0 8 * * *' });
  assert.equal((await request('v1/text/' + loose.id)).status, 404);
  assert.equal((await request('v1/text/' + kept.id)).status, 200);
  assert.equal(
    (await request('v1/items?cursor=' + page.nextCursor)).status,
    409,
  );
  assert.equal((await get(`v1/piles/${pileId}/members`)).members.length, 1);
  const replay = await get(`v1/piles/${pileId}/members`, 'POST', input);
  assert.equal(replay.replayed, true);
  const removed = await get(`v1/piles/${pileId}/members`, 'POST', {
    ...input,
    operationId: crypto.randomUUID(),
    revision: 3,
    action: 'removeAndPin',
  });
  assert.equal(removed.item.cleanup.reason, 'pinned');
  await (
    await mf.getWorker()
  ).scheduled({ scheduledTime: Date.now(), cron: '0 8 * * *' });
  assert.equal((await request('v1/text/' + kept.id)).status, 200);
  // Legacy source mutation still observes text CAS, and deletion clears retained Undo slots.
  assert.equal(
    (
      await request('clips/' + kept.id, 'PATCH', {
        action: 'edit',
        revision: 1,
        content: 'stale',
      })
    ).status,
    409,
  );
  const current = await get('clips/' + kept.id);
  assert.equal(
    (
      await request('clips/' + kept.id, 'DELETE', {
        revision: current.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM pile_members WHERE item_id=?')
        .bind(kept.id)
        .first()
    ).n,
    0,
  );
  const linkResponse = await request('content', 'POST', {
    kind: 'link',
    name: 'Synthetic Google shortcut',
    url: 'https://docs.google.com/document/d/synthetic/edit',
  });
  assert.equal(linkResponse.status, 201);
  const link = await linkResponse.json();
  const addLink = await get(`v1/piles/${pileId}/members`, 'POST', {
    operationId: crypto.randomUUID(),
    revision: (await get(`v1/piles/${pileId}/members`)).pile.revision,
    action: 'add',
    ref: { kind: 'document', id: link.id },
  });
  assert.equal(addLink.item.cleanup.reason, 'pile');
  assert.equal((await request('content/' + link.id, 'DELETE')).status, 200);
  assert.equal((await get(`v1/piles/${pileId}/members`)).members.length, 0);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const uploaded = await mf.dispatchFetch(origin + '/api/images', {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: alice.cookie,
      'Content-Type': 'image/png',
    },
    body: png,
  });
  assert.equal(uploaded.status, 201);
  const image = await uploaded.json();
  await get(`v1/piles/${pileId}/members`, 'POST', {
    operationId: crypto.randomUUID(),
    revision: (await get(`v1/piles/${pileId}/members`)).pile.revision,
    action: 'add',
    ref: { kind: 'image', id: image.id },
  });
  assert.equal((await request('images/' + image.id, 'DELETE')).status, 200);
  assert.equal((await get(`v1/piles/${pileId}/members`)).members.length, 0);
  // Mixed initial selection, confirmation invalidation, both deletion choices,
  // historical receipts, real bytes/quota preservation and complete erasure.
  const source = await create();
  const imageResponse = await mf.dispatchFetch(origin + '/api/images', {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: alice.cookie,
      'Content-Type': 'image/png',
    },
    body: png,
  });
  assert.equal(imageResponse.status, 201);
  const retainedImage = await imageResponse.json();
  const shortcutResponse = await request('v1/documents', 'POST', {
    kind: 'link',
    name: 'Shopping list',
    url: 'https://docs.google.com/spreadsheets/d/synthetic/edit',
  });
  assert.equal(shortcutResponse.status, 201);
  const shortcut = await shortcutResponse.json();
  const refs = [
    { kind: 'image', id: retainedImage.id },
    { kind: 'text', id: source.id },
    { kind: 'document', id: shortcut.id },
  ];
  const mixedInput = {
    operationId: crypto.randomUUID(),
    name: 'Mixed',
    members: refs,
  };
  const mixedResponse = await request('v1/piles', 'POST', mixedInput);
  assert.equal(mixedResponse.status, 201);
  const mixed = (await mixedResponse.json()).pile;
  assert.deepEqual(
    (await get(`v1/piles/${mixed.id}/members`)).members.map((m) => m.ref),
    refs,
  );
  const budgetBefore = await get('v1/documents');
  const impact = await get(`v1/piles/${mixed.id}/deletion-impact`);
  assert.equal(impact.exposed.length, 2);
  const deletion = {
    operationId: crypto.randomUUID(),
    revision: impact.pile.revision,
    impactToken: impact.impactToken,
    mode: 'pin',
  };
  // Another device changes cleanup settings without changing this pile's revision.
  await get('settings', 'POST', {
    action: 'clipboard-cleanup',
    enabled: false,
  });
  const stale = await request(`v1/piles/${mixed.id}`, 'DELETE', deletion);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'impact_stale');
  await get('settings', 'POST', { action: 'clipboard-cleanup', enabled: true });
  const fresh = await get(`v1/piles/${mixed.id}/deletion-impact`);
  const confirmed = {
    ...deletion,
    operationId: crypto.randomUUID(),
    impactToken: fresh.impactToken,
  };
  const deleted = await get(`v1/piles/${mixed.id}`, 'DELETE', confirmed);
  assert.equal(deleted.pinned.length, 2);
  assert.equal(
    (await get(`v1/piles/${mixed.id}`, 'DELETE', confirmed)).replayed,
    true,
  );
  assert.equal((await get('v1/piles', 'POST', mixedInput)).replayed, true);
  assert.equal((await request(`v1/piles/${mixed.id}`)).status, 404);
  assert.equal((await get('v1/documents')).usedBytes, budgetBefore.usedBytes);
  const bytes = await request('v1/images/' + retainedImage.id + '/file');
  assert.equal(bytes.status, 200);
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), png);
  await (
    await mf.getWorker()
  ).scheduled({ scheduledTime: Date.now(), cron: '0 8 * * *' });
  assert.equal((await request('v1/text/' + source.id)).status, 200);
  const exposed = await create();
  await db
    .prepare('UPDATE clips SET created_at=0 WHERE id=?')
    .bind(exposed.id)
    .run();
  const exposureResponse = await request('v1/piles', 'POST', {
    operationId: crypto.randomUUID(),
    name: 'Expose',
    members: [{ kind: 'text', id: exposed.id }],
  });
  assert.equal(exposureResponse.status, 201);
  const exposurePile = (await exposureResponse.json()).pile.id;
  const exposureImpact = await get(`v1/piles/${exposurePile}/deletion-impact`);
  const expose = {
    operationId: crypto.randomUUID(),
    revision: exposureImpact.pile.revision,
    impactToken: exposureImpact.impactToken,
    mode: 'expose',
  };
  assert.equal(
    (await request(`v1/piles/${exposurePile}`, 'DELETE', expose)).status,
    400,
  );
  await get(`v1/piles/${exposurePile}`, 'DELETE', {
    ...expose,
    acknowledgeExposure: true,
  });
  assert.equal((await request('v1/text/' + exposed.id)).status, 200);
  await (
    await mf.getWorker()
  ).scheduled({ scheduledTime: Date.now(), cron: '0 8 * * *' });
  assert.equal((await request('v1/items/text/' + exposed.id)).status, 410);
  const erased = await request('auth/account-deletion', 'POST', {
    confirmEmail: 'builtsharedalice@example.test',
  });
  assert.equal(erased.status, 200, await erased.clone().text());
  for (const table of [
    'piles',
    'pile_members',
    'pile_operations',
    'item_deletions',
    'workspace_revision',
    'clips',
    'clipboard_images',
    'content_items',
  ])
    assert.equal(
      (
        await db
          .prepare(`SELECT count(*) n FROM ${table} WHERE owner=?`)
          .bind(alice.owner)
          .first()
      ).n,
      0,
      table,
    );
  assert.equal((await request('v1/piles', 'POST', mixedInput)).status, 401);
  assert.equal(
    (await request('v1/piles', 'GET', undefined, bob.cookie)).status,
    200,
  );
  console.log(
    'Built shared items Worker passed: P1 lifecycle, mixed selection, stale impact, pin/expose deletion, source bytes/quota preservation, complete erasure, owner isolation, F2 retries/Undo and cleanup.',
  );
} finally {
  await mf.dispose();
}
