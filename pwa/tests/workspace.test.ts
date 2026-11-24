import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { handleAPI } from '../lib/server';
import { newClip, changeClip, type Clip } from '../lib/domain';
import { importClip, parseBackup } from '../lib/backup';
const source = () =>
  newClip(
    {
      id: crypto.randomUUID(),
      content: 'First idea: 100% done_soon!',
      kind: 'note',
    },
    1000,
  );

void test('originals survive edits, append, atomic title edits, restore and segment exclusion', () => {
  const original = source();
  const cleaned = changeClip(
    original,
    { revision: 1, action: 'edit', content: 'First idea.' },
    2000,
  );
  const appended = changeClip(
    cleaned,
    {
      revision: 2,
      action: 'append',
      content: 'Second idea.',
      segmentId: 'segment-12345',
    },
    3000,
  );
  assert.equal(appended.original, original.content + '\n\nSecond idea.');
  assert.equal(appended.segments.length, 2);
  assert.equal(appended.content, 'First idea.\n\nSecond idea.');
  assert.equal(original.versions.length, 1);
  const retried = changeClip(appended, {
    revision: 2,
    action: 'append',
    content: 'Second idea.',
    segmentId: 'segment-12345',
  });
  assert.equal(retried, appended);
  assert.throws(
    () =>
      changeClip(appended, {
        revision: 3,
        action: 'append',
        content: 'Different words',
        segmentId: 'segment-12345',
      }),
    /different/,
  );
  const edited = changeClip(
    appended,
    { revision: 3, action: 'edit', title: 'Named thought', content: 'Edited.' },
    4000,
  );
  assert.equal(edited.title, 'Named thought');
  assert.equal(edited.versions.length, 4);
  const restored = changeClip(
    edited,
    { revision: 4, action: 'restore-original' },
    5000,
  );
  assert.equal(restored.content, appended.original);
  assert.equal(restored.versions.length, 5);
  const excluded = changeClip(
    restored,
    { revision: 5, action: 'without-segment', segmentId: 'segment-12345' },
    6000,
  );
  assert.equal(excluded.content, original.original);
  assert.equal(excluded.segments.length, 2);
  assert.throws(
    () =>
      changeClip(excluded, { revision: 1, action: 'edit', content: 'Stale' }),
    /another tab/,
  );
});
void test('empty, oversized and invalid drafts are rejected before storage', () => {
  assert.throws(() => newClip({ id: crypto.randomUUID(), content: ' ' }));
  assert.throws(() => newClip({ id: 'bad', content: 'Text' }));
  assert.throws(() =>
    newClip({ id: crypto.randomUUID(), content: 'x'.repeat(20001) }),
  );
});
void test('the retired AI rewrite action is rejected while its saved versions stay readable', () => {
  const original = source();
  assert.throws(
    () =>
      changeClip(original, {
        revision: 1,
        action: 'transform',
        content: 'Rewritten.',
        versionKind: 'rewritten',
      }),
    /Unknown edit action/,
  );
  // A clip that was cleaned or rewritten before AI was retired.
  const historical: Clip = {
    ...original,
    content: 'Rewritten.',
    revision: 3,
    versions: [
      ...original.versions,
      { id: 'version-cleaned', kind: 'cleaned', text: 'Cleaned.', createdAt: 2000 },
      { id: 'version-rewritten', kind: 'rewritten', text: 'Rewritten.', createdAt: 3000 },
    ],
  };
  assert.deepEqual(importClip(historical).versions, historical.versions);
  const restored = changeClip(historical, {
    revision: 3,
    action: 'restore',
    versionId: 'version-cleaned',
  });
  assert.equal(restored.content, 'Cleaned.');
  assert.equal(restored.versions.length, 4);
});
void test('backup roundtrip preserves versions and rejects inconsistent or malicious input', () => {
  const original = source();
  const edited = changeClip(original, {
    revision: 1,
    action: 'edit',
    content: 'Changed',
  });
  const imported = parseBackup(
    JSON.parse(JSON.stringify({ app: 'DO', version: 1, clips: [edited] })),
  )[0];
  assert.equal(imported.content, 'Changed');
  assert.deepEqual(imported.versions, edited.versions);
  assert.throws(
    () => importClip({ ...edited, original: 'Not the source' }),
    /agree/,
  );
  assert.throws(() => importClip({ ...edited, segments: [] }), /invalid/);
  assert.throws(() => parseBackup({ app: 'Other', version: 1, clips: [] }));
});
void test('authenticated API integration against real D1 SQLite', async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const file of readdirSync(new URL('../drizzle/', import.meta.url))
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const migration = readFileSync(
        new URL('../drizzle/' + file, import.meta.url),
        'utf8',
      );
      for (const sql of migration.split('--> statement-breakpoint'))
        if (sql.trim()) await db.prepare(sql.trim()).run();
    }
    const call = async (
      path: string,
      method = 'GET',
      data?: unknown,
      owner = 'alice',
      origin = 'https://do.test',
    ) =>
      handleAPI(
        new Request('https://do.test/api/' + path, {
          method,
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
        }),
        { db, owner },
      );
    let clip: Clip;
    await t.test('requires auth and same-origin writes', async () => {
      assert.equal((await call('library', 'GET', undefined, '')).status, 401);
      assert.equal(
        (
          await call(
            'clips',
            'POST',
            { id: crypto.randomUUID(), content: 'x' },
            'alice',
            'https://evil.test',
          )
        ).status,
        403,
      );
    });
    await t.test('creates one item when a request is retried', async () => {
      const input = {
        id: crypto.randomUUID(),
        content: 'First idea: 100% done_soon!',
        kind: 'note',
      };
      const r = await call('clips', 'POST', input);
      assert.equal(r.status, 201);
      clip = (await r.json()) as Clip;
      await call('clips', 'POST', input);
      const library = (await (await call('library')).json()) as {
        items: Clip[];
      };
      assert.equal(library.items.length, 1);
      assert.equal(clip.versions.length, 1);
    });
    await t.test(
      'isolates read, write, delete, collision and search by owner',
      async () => {
        assert.equal(
          (await call('clips/' + clip.id, 'GET', undefined, 'bob')).status,
          404,
        );
        assert.equal(
          (
            await call(
              'clips/' + clip.id,
              'PATCH',
              { action: 'edit', revision: 1, content: 'Overwrite' },
              'bob',
            )
          ).status,
          404,
        );
        assert.equal(
          (await call('clips/' + clip.id, 'DELETE', { revision: 1 }, 'bob'))
            .status,
          409,
        );
        assert.equal(
          (
            await call(
              'clips',
              'POST',
              { id: clip.id, content: 'Collision', kind: 'note' },
              'bob',
            )
          ).status,
          404,
        );
        const other = (await (
          await call('library', 'GET', undefined, 'bob')
        ).json()) as { items: Clip[] };
        assert.equal(other.items.length, 0);
      },
    );
    await t.test('search treats wildcard characters literally', async () => {
      for (const query of ['100%', 'done_', '!']) {
        const r = await call('library?q=' + encodeURIComponent(query));
        assert.equal(r.status, 200);
        assert.equal(((await r.json()) as { items: Clip[] }).items.length, 1);
      }
      const r = await call('library?q=missing%25');
      assert.equal(((await r.json()) as { items: Clip[] }).items.length, 0);
    });
    await t.test(
      'atomic revision protection preserves the winning edit',
      async () => {
        const attempts = await Promise.all([
          call('clips/' + clip.id, 'PATCH', {
            action: 'edit',
            content: 'First winner',
            title: 'Renamed',
            revision: 1,
          }),
          call('clips/' + clip.id, 'PATCH', {
            action: 'edit',
            content: 'Second winner',
            revision: 1,
          }),
        ]);
        assert.deepEqual(
          attempts.map((r) => r.status).sort((a, b) => a - b),
          [200, 409],
        );
        clip = (await (await call('clips/' + clip.id)).json()) as Clip;
        assert.equal(clip.revision, 2);
        assert.equal(clip.versions.length, 2);
        assert.equal(clip.original, 'First idea: 100% done_soon!');
      },
    );
    await t.test(
      'append retry is idempotent even after losing its response',
      async () => {
        const input = {
          action: 'append',
          content: 'Another thought',
          segmentId: 'recording-123456',
          revision: clip.revision,
        };
        const first = await call('clips/' + clip.id, 'PATCH', input);
        assert.equal(first.status, 200);
        const again = await call('clips/' + clip.id, 'PATCH', input);
        assert.equal(again.status, 200);
        clip = (await again.json()) as Clip;
        assert.equal(clip.segments.length, 2);
        assert.equal(clip.revision, 3);
      },
    );
    await t.test(
      'text saved directly to Clipboard is shared by account, retry-safe, and deletable from another session',
      async () => {
        const input = {
          id: crypto.randomUUID(),
          content: 'Shared from Windows',
          pinned: true,
        };
        const first = await call('clips', 'POST', input, 'shared-account');
        assert.equal(first.status, 201);
        const saved = (await first.json()) as Clip;
        assert.equal(saved.pinned, true);
        await call('clips', 'POST', input, 'shared-account');
        const onMac = (await (
          await call('library?pinned=true', 'GET', undefined, 'shared-account')
        ).json()) as { items: Clip[] };
        assert.equal(onMac.items.length, 1);
        assert.equal(onMac.items[0].content, input.content);
        const other = (await (
          await call(
            'library?pinned=true',
            'GET',
            undefined,
            'different-account',
          )
        ).json()) as { items: Clip[] };
        assert.equal(other.items.length, 0);
        assert.equal(
          (
            await call(
              'clips/' + saved.id,
              'DELETE',
              { revision: saved.revision },
              'shared-account',
            )
          ).status,
          200,
        );
        const after = (await (
          await call('library?pinned=true', 'GET', undefined, 'shared-account')
        ).json()) as { items: Clip[] };
        assert.equal(after.items.length, 0);
      },
    );
    await t.test('clipboard pins are durable and filterable', async () => {
      const r = await call('clips/' + clip.id, 'PATCH', {
        action: 'pin',
        pinned: true,
        revision: clip.revision,
      });
      assert.equal(r.status, 200);
      clip = (await r.json()) as Clip;
      assert.equal(
        (
          (await (await call('library?pinned=true')).json()) as {
            items: Clip[];
          }
        ).items.length,
        1,
      );
    });
    await t.test(
      'retired dictation and AI routes are gone and leave stored credentials untouched',
      async () => {
        // A row written while Groq was connected and cloud processing allowed.
        await db
          .prepare(
            "INSERT INTO preferences (owner,encrypted_key,consent,model) VALUES ('alice','legacy-ciphertext',1,'legacy/model')",
          )
          .run();
        for (const [path, body] of [
          ['transform', { kind: 'clean', text: 'text' }],
          ['transcribe', {}],
        ] as const)
          assert.equal((await call(path, 'POST', body)).status, 404);
        for (const action of ['connect', 'disconnect', 'consent'])
          assert.equal(
            (
              await call('settings', 'POST', {
                action,
                key: 'gsk_synthetic_test_key_not_real',
                consent: false,
              })
            ).status,
            400,
          );
        const changed = await call('settings', 'POST', {
          action: 'clipboard-cleanup',
          enabled: true,
        });
        assert.equal(changed.status, 200);
        assert.deepEqual(await changed.json(), {
          clipboardDailyCleanup: true,
          logoutPath: '/login',
        });
        assert.deepEqual(await (await call('settings')).json(), {
          clipboardDailyCleanup: true,
          logoutPath: '/login',
        });
        assert.deepEqual(
          await db
            .prepare(
              'SELECT encrypted_key,consent,model FROM preferences WHERE owner=?',
            )
            .bind('alice')
            .first(),
          { encrypted_key: 'legacy-ciphertext', consent: 1, model: 'legacy/model' },
        );
        await call('settings', 'POST', {
          action: 'clipboard-cleanup',
          enabled: false,
        });
        assert.equal((await call('clips/' + clip.id)).status, 200);
      },
    );
    await t.test(
      'imports preserve versions, skip existing data and can be retried',
      async () => {
        const own = await call('import', 'POST', { clip });
        assert.deepEqual(await own.json(), { imported: false });
        const imported = await call('import', 'POST', { clip }, 'bob');
        assert.deepEqual(await imported.json(), { imported: true });
        const retry = await call('import', 'POST', { clip }, 'bob');
        assert.deepEqual(await retry.json(), { imported: false });
        const library = (await (
          await call('library', 'GET', undefined, 'bob')
        ).json()) as { items: Clip[] };
        const restored = (await (
          await call('clips/' + library.items[0].id, 'GET', undefined, 'bob')
        ).json()) as Clip;
        assert.deepEqual(restored.versions, clip.versions);
        assert(restored.pinned);
      },
    );
    await t.test(
      'deletion removes the record and all embedded versions',
      async () => {
        assert.equal(
          (await call('clips/' + clip.id, 'DELETE', { revision: 1 })).status,
          409,
        );
        assert.equal(
          (
            await call('clips/' + clip.id, 'DELETE', {
              revision: clip.revision,
            })
          ).status,
          200,
        );
        assert.equal((await call('clips/' + clip.id)).status, 404);
      },
    );
  } finally {
    await mf.dispose();
  }
});

