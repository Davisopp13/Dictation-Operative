import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { handleAPI } from '../lib/server';
import { contentLink, contentProvider } from '../lib/content-model';
import { itemProtection, type SharedItem } from '../lib/shared-items';
import {
  Intent,
  MembershipBatch,
  selectionRange,
  organizationMessage,
} from '../lib/desk-client';
import {
  deskNotice,
  dismissDeskNotice,
  saveStartPage,
} from '../lib/workspace-navigation';

void test('generic bookmarks validate schemes/credentials and recognize only real Google paths', () => {
  for (const url of [
    'https://shop.example.test/item?q=one',
    'https://docs.google.com.evil.test/document/d/x',
    'https://example.test/spreadsheets/d/a',
    'https://docs.google.com/document',
    'https://docs.google.com:444/document/d/a',
  ]) {
    assert.equal(contentLink(url), new URL(url).href);
    assert.equal(contentProvider(url), 'Link');
  }
  assert.equal(
    contentProvider('https://docs.google.com/document/d/a/edit'),
    'Google Docs',
  );
  assert.equal(
    contentProvider('https://docs.google.com/spreadsheets/d/a'),
    'Google Sheets',
  );
  for (const url of [
    'http://shop.example.test',
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://user:pass@example.test',
    'https://user@example.test',
    'not a url',
    'https://example.test/' + 'a'.repeat(2048),
  ])
    assert.throws(() => contentLink(url));
});
void test('selection preserves explicit order and range union; missing organization remains unknown', () => {
  assert.deepEqual(
    selectionRange(['a', 'b', 'c', 'd'], ['d'], 'b', 'c', true),
    ['d', 'b', 'c'],
  );
  assert.deepEqual(selectionRange(['a', 'b'], ['a'], 'a', 'a', false), []);
  assert.equal(
    organizationMessage(),
    'Saved; organization status unavailable.',
  );
  const old = itemProtection(
    {
      kind: 'text',
      id: 'old',
      revision: 1,
      pinned: 1,
      piles: '[]',
      clipboardItem: 1,
      history: 0,
      cleanupEnabled: 1,
      createdAt: 0,
    },
    0,
  );
  assert.deepEqual(old.organization, { state: 'unknown', pending: null });
});
void test('uncertain mutation retries send identical operation IDs and payloads', async () => {
  const original = globalThis.fetch,
    bodies: string[] = [];
  globalThis.fetch = async (_url, init) => {
    assert.equal(typeof init?.body, 'string');
    bodies.push(init?.body as string);
    if (bodies.length === 1) throw new Error('lost response');
    return Response.json({ ok: true });
  };
  try {
    const intent = new Intent('v1/piles/p/members', 'POST', {
      ref: { kind: 'text', id: 'one' },
      revision: 3,
      action: 'add',
    });
    await assert.rejects(intent.send());
    await intent.send();
    assert.equal(bodies[0], bodies[1]);
    assert.ok(JSON.parse(bodies[0]).operationId);
  } finally {
    globalThis.fetch = original;
  }
});
void test('Desk notice is account/device local and respects explicit legacy choices', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  } as unknown as Storage;
  const browser = {
    localStorage: storage,
    sessionStorage: storage,
    performance: {} as Performance,
  };
  assert.equal(deskNotice('a', browser), true);
  dismissDeskNotice('a', browser);
  assert.equal(deskNotice('a', browser), false);
  assert.equal(deskNotice('b', browser), true);
  saveStartPage('b', 'clipboard', browser);
  assert.equal(deskNotice('b', browser), false);
});

void test('P3 projections, removal previews, atomic organization and bookmark edits on real D1', async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
    r2Buckets: ['IMAGES'],
  });
  try {
    const db = await mf.getD1Database('DB');
    const content = (await mf.getR2Bucket('IMAGES')) as unknown as R2Bucket;
    for (const file of readdirSync('drizzle')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
        '--> statement-breakpoint',
      ))
        if (sql.trim()) await db.prepare(sql).run();
    const call = (
      owner: string,
      path: string,
      method = 'GET',
      data?: unknown,
    ) =>
      handleAPI(
        new Request('https://local.test/api/' + path, {
          method,
          headers: {
            Origin: 'https://local.test',
            'Content-Type': 'application/json',
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        }),
        { db, owner, content },
      );
    const ok = async <T = Record<string, unknown>>(
      owner: string,
      path: string,
      method = 'GET',
      data?: unknown,
    ): Promise<T> => {
      const r = await call(owner, path, method, data);
      assert.ok(r.ok, await r.clone().text());
      return r.json() as Promise<T>;
    };
    const create = async (owner: string, collection = '') =>
      ok<{ id: string; revision: number }>(owner, 'v1/text', 'POST', {
        id: crypto.randomUUID(),
        content: 'Saturday errands',
        collection,
        clipboardItem: true,
      });
    const item = (owner: string, id: string) =>
      ok<SharedItem>(owner, 'v1/items/text/' + id);
    const pile = async (owner: string, name = 'Errands') =>
      (
        await ok<{ pile: { id: string; revision: number } }>(
          owner,
          'v1/piles',
          'POST',
          { operationId: crypto.randomUUID(), name, color: 'mint' },
        )
      ).pile;
    await t.test(
      'pinned and manually piled pending texts retain independent capacity status',
      async () => {
        const owner = 'capacity',
          manual = await pile(owner);
        await db
          .prepare(
            `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<99) INSERT INTO piles(id,owner,name,updated_at) SELECT 'cap-'||x,?,'Empty',0 FROM n`,
          )
          .bind(owner)
          .run();
        const saved = await create(owner, 'Unmapped key');
        let state = await item(owner, saved.id);
        assert.deepEqual(state.organization, {
          state: 'pile_capacity',
          pending: true,
        });
        await ok(owner, 'v1/text/' + saved.id, 'PATCH', {
          action: 'pin',
          revision: saved.revision,
          pinned: true,
        });
        state = await item(owner, saved.id);
        assert.equal(state.cleanup.reason, 'pinned');
        assert.equal(state.organization.pending, true);
        const added = await ok<{ item: SharedItem }>(
          owner,
          `v1/piles/${manual.id}/members`,
          'POST',
          {
            operationId: crypto.randomUUID(),
            revision: manual.revision,
            ref: state.ref,
            action: 'add',
          },
        );
        assert.equal(added.item.organization.state, 'pile_capacity');
        assert.equal(added.item.organization.pending, true);
        const listing = await ok<{ items: SharedItem[] }>(
          owner,
          `v1/piles/${manual.id}/items`,
        );
        assert.equal(listing.items.length, 1);
        assert.equal(listing.items[0].organization.state, 'pile_capacity');
        assert.equal(
          (await call('other', `v1/piles/${manual.id}/items`)).status,
          404,
        );
        assert.equal(
          (
            await call(
              'other',
              `v1/piles/${manual.id}/members/text/${saved.id}/impact`,
            )
          ).status,
          404,
        );
        const fresh = await item(owner, saved.id);
        await ok(owner, 'v1/text/' + saved.id, 'PATCH', {
          action: 'organize',
          revision: fresh.revision,
          collection: '',
          keepPinned: true,
          workspaceRevision: fresh.workspaceRevision,
        });
        state = await item(owner, saved.id);
        assert.equal(state.organization.state, 'none');
        assert.equal(state.pinned, true);
        assert.equal(state.piles.length, 1);
      },
    );
    await t.test(
      'ready, committed, retained slot block and suppressed pending/settled states derive from current storage',
      async () => {
        const owner = 'states';
        const saved = await create(owner, 'Mapped');
        let state = await item(owner, saved.id);
        assert.equal(state.organization.state, 'mapped');
        const mapped = state.piles[0].id;
        await db
          .prepare(
            `INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,collection_synced,clipboard_item,created_at,updated_at) VALUES('legacy-ready',?,'Legacy','note','body','body','[]','[]','Later',0,1,0,0)`,
          )
          .bind(owner)
          .run();
        assert.equal(
          (await item(owner, 'legacy-ready')).organization.state,
          'ready',
        );
        await db
          .prepare(
            `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<499) INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,collection_synced,clipboard_item,created_at,updated_at) SELECT 'retained-'||x,?,'Retained','note','body','body','[]','[]','',1,1,0,0 FROM n`,
          )
          .bind(owner)
          .run();
        await db
          .prepare(
            `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<499) INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation,manual) SELECT ?,?,'text','retained-'||x,x,0,'synthetic',0 FROM n`,
          )
          .bind(mapped, owner)
          .run();
        const pending = await create(owner, 'Mapped');
        assert.equal(
          (await item(owner, pending.id)).organization.state,
          'member_capacity',
        );
        const impact = await ok<{
          pile: { revision: number };
          impactToken: string;
          mappedCollection: boolean;
        }>(owner, `v1/piles/${mapped}/deletion-impact`);
        assert.equal(impact.mappedCollection, true);
        await ok(owner, `v1/piles/${mapped}`, 'DELETE', {
          operationId: crypto.randomUUID(),
          revision: impact.pile.revision,
          impactToken: impact.impactToken,
          mode: 'pin',
        });
        state = await item(owner, pending.id);
        assert.deepEqual(state.organization, {
          state: 'suppressed',
          pending: true,
        });
        const settled = await create(owner, 'Mapped');
        assert.deepEqual((await item(owner, settled.id)).organization, {
          state: 'suppressed_settled',
          pending: false,
        });
      },
    );
    await t.test(
      'fresh removal preview guards cleanup exposure, atomic pin, receipt replay and Undo',
      async () => {
        const owner = 'remove';
        await db
          .prepare(
            'INSERT INTO preferences(owner,clipboard_daily_cleanup) VALUES(?,1)',
          )
          .bind(owner)
          .run();
        const saved = await create(owner, 'Exact key'),
          state = await item(owner, saved.id),
          p = state.piles[0];
        type Impact = {
          revision: number;
          workspaceRevision: number;
          clearsCollection: boolean;
          after: SharedItem;
        };
        const preview = await ok<Impact>(
          owner,
          `v1/piles/${p.id}/members/text/${saved.id}/impact`,
        );
        assert.equal(preview.clearsCollection, true);
        assert.equal(preview.after.cleanup.eligible, true);
        await create(owner);
        const request = {
          operationId: crypto.randomUUID(),
          ref: state.ref,
          revision: preview.revision,
          workspaceRevision: preview.workspaceRevision,
          action: 'removeAndPin',
        };
        assert.equal(
          (await call(owner, `v1/piles/${p.id}/members`, 'POST', request))
            .status,
          409,
        );
        assert.equal((await item(owner, saved.id)).pinned, false);
        const fresh = await ok<Impact>(
          owner,
          `v1/piles/${p.id}/members/text/${saved.id}/impact`,
        );
        request.workspaceRevision = fresh.workspaceRevision;
        request.operationId = crypto.randomUUID();
        const removed = await ok<{ pileRevision: number; item: SharedItem }>(
          owner,
          `v1/piles/${p.id}/members`,
          'POST',
          request,
        );
        assert.equal(removed.item.pinned, true);
        assert.deepEqual(removed.item.organization, {
          state: 'none',
          pending: false,
        });
        const replay = await ok<{ replayed: boolean; item: SharedItem }>(
          owner,
          `v1/piles/${p.id}/members`,
          'POST',
          request,
        );
        assert.equal(replay.replayed, true);
        assert.deepEqual(replay.item, removed.item);
        await ok(owner, `v1/piles/${p.id}/members`, 'POST', {
          operationId: crypto.randomUUID(),
          ref: state.ref,
          revision: removed.pileRevision,
          action: 'restore',
          undoOperationId: request.operationId,
        });
        assert.equal((await item(owner, saved.id)).pinned, true);
        assert.equal(
          (await item(owner, saved.id)).organization.state,
          'mapped',
        );
      },
    );
    await t.test(
      'collection change refuses stale workspace and tag-only exact keys remain unchanged',
      async () => {
        const owner = 'organize',
          saved = await create(owner, 'Mapped'),
          state = await item(owner, saved.id);
        await create(owner);
        assert.equal(
          (
            await call(owner, 'clips/' + saved.id, 'PATCH', {
              action: 'organize',
              revision: saved.revision,
              collection: '',
              keepPinned: true,
              workspaceRevision: state.workspaceRevision,
            })
          ).status,
          409,
        );
        assert.equal((await item(owner, saved.id)).pinned, false);
        const fresh = await item(owner, saved.id);
        await ok(owner, 'clips/' + saved.id, 'PATCH', {
          action: 'organize',
          revision: fresh.revision,
          collection: '',
          keepPinned: true,
          workspaceRevision: fresh.workspaceRevision,
        });
        const updated = await item(owner, saved.id);
        assert.equal(updated.pinned, true);
        assert.equal(updated.organization.state, 'none');
      },
    );
    await t.test(
      'both bookmark surfaces enforce URL validation and current revisions without changing pin compatibility',
      async () => {
        const owner = 'links';
        for (const path of ['content', 'v1/documents']) {
          const saved = await ok<{ id: string; revision: number }>(
            owner,
            path,
            'POST',
            {
              id: crypto.randomUUID(),
              kind: 'link',
              name: 'Shop',
              url: 'https://shop.example.test/receipt',
            },
          );
          const changed = await ok<{ revision: number }>(
            owner,
            path + '/' + saved.id,
            'PATCH',
            {
              name: 'Shop receipt',
              url: 'https://shop.example.test/new',
              revision: saved.revision,
            },
          );
          assert.equal(changed.revision, saved.revision + 1);
          assert.equal(
            (
              await call(owner, path + '/' + saved.id, 'PATCH', {
                name: 'Stale',
                revision: saved.revision,
              })
            ).status,
            409,
          );
          for (const url of [
            'http://example.test',
            'javascript:alert(1)',
            'https://me:secret@example.test',
          ])
            assert.equal(
              (
                await call(owner, path + '/' + saved.id, 'PATCH', {
                  url,
                  revision: changed.revision,
                })
              ).status,
              400,
            );
          assert.equal(
            (
              await call('other', path + '/' + saved.id, 'PATCH', {
                name: 'Other',
                revision: changed.revision,
              })
            ).status,
            404,
          );
          await ok(owner, path + '/' + saved.id, 'PATCH', { pinned: true });
          const shared = await ok<SharedItem>(
            owner,
            'v1/items/document/' + saved.id,
          );
          assert.equal(shared.displayKind, 'link');
          assert.equal(shared.capabilities.open, 'external');
          assert.equal(shared.capabilities.preview, null);
          assert.equal(shared.preview.host, 'shop.example.test');
        }
      },
    );
  } finally {
    await mf.dispose();
  }
});

void test('membership queue preserves partial success, retries uncertainty once and stops for reconfirmation/cancellation', async () => {
  const original = globalThis.fetch;
  const calls: { operationId: string; ref: { id: string } }[] = [];
  let revision = 1,
    lose = true,
    conflict = false;
  globalThis.fetch = async (_url, init) => {
    if (!init?.body) return Response.json({ pile: { revision } });
    const data = JSON.parse(init.body as string);
    calls.push(data);
    if (conflict) {
      conflict = false;
      return Response.json(
        { error: 'changed', code: 'revision_conflict' },
        { status: 409 },
      );
    }
    if (data.ref.id === 'two' && lose) {
      lose = false;
      revision++;
      throw new Error('response lost after commit');
    }
    revision++;
    return Response.json({
      operationId: data.operationId,
      pileRevision: revision,
    });
  };
  try {
    const batch = new MembershipBatch(
      { id: 'pile', name: 'Queue', color: 'mint', revision: 1, updatedAt: 0 },
      [
        { kind: 'text', id: 'one' },
        { kind: 'text', id: 'two' },
        { kind: 'text', id: 'three' },
      ],
    );
    await batch.step();
    await assert.rejects(batch.step());
    assert.equal(batch.done, 1);
    assert.deepEqual(
      batch.remaining.map((r) => r.id),
      ['two', 'three'],
    );
    await batch.step();
    assert.equal(calls[1].operationId, calls[2].operationId);
    assert.equal(calls.filter((c) => c.ref.id === 'one').length, 1);
    conflict = true;
    await assert.rejects(batch.step());
    assert.equal(batch.needsConfirmation, true);
    const count = calls.length;
    await assert.rejects(batch.step());
    assert.equal(calls.length, count);
    batch.confirm();
    await assert.rejects(batch.step(() => true));
    assert.equal(calls.length, count);
    await batch.step();
    assert.equal(batch.done, 3);
    assert.equal(batch.remaining.length, 0);
    assert.notEqual(calls.at(-1)?.operationId, calls[count - 1].operationId);
  } finally {
    globalThis.fetch = original;
  }
});
