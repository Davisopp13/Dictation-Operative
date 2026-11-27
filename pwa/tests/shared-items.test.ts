import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { handleAPI } from '../lib/server';
import { runClipboardCleanup } from '../lib/clipboard-cleanup';
import {
  nextCleanup,
  type SharedItem,
  type ItemReference,
} from '../lib/shared-items';

type TestResponse = SharedItem & {
  code: string;
  items: SharedItem[];
  nextCursor: string | null;
  pile: { revision: number };
  members: { ref: ItemReference; position: number }[];
  item: SharedItem;
  operationId: string;
  pileRevision: number;
  changed: boolean;
};

void test('cleanup schedule respects strict 24-hour age and next 08:00 run', () => {
  const at = Date.UTC(2026, 10, 25, 8);
  assert.equal(nextCleanup(at, at), at + 2 * 86400000);
  assert.equal(nextCleanup(at - 1, at), at + 86400000);
  assert.equal(nextCleanup(0, at + 1), at + 86400000);
});

void test('shared items and membership contracts on real D1', async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const file of readdirSync('drizzle')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
        '--> statement-breakpoint',
      ))
        if (sql.trim()) await db.prepare(sql).run();
    const call = (
      path: string,
      method = 'GET',
      data?: unknown,
      owner = 'alice',
    ) =>
      handleAPI(
        new Request('https://do.test/api/v1/' + path, {
          method,
          headers: {
            Origin: 'https://do.test',
            'Content-Type': 'application/json',
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        }),
        { db, owner },
      );
    const json = async (
      path: string,
      method = 'GET',
      data?: unknown,
      owner = 'alice',
    ) => {
      const r = await call(path, method, data, owner);
      const result = (await r.json()) as TestResponse;
      assert.equal(r.status, 200, JSON.stringify(result));
      return result;
    };
    const rev = async () => (await json('revision')).revision;
    const seedPile = async (name = 'pile-0001', owner = 'alice') => {
      await db
        .prepare('INSERT INTO piles(id,owner,name,updated_at) VALUES (?,?,?,0)')
        .bind(name, owner, name)
        .run();
      return name;
    };
    const seedText = async (name = crypto.randomUUID(), owner = 'alice') => {
      const r = await call(
        'text',
        'POST',
        { id: name, content: 'hello' },
        owner,
      );
      assert.equal(r.status, 201);
      return { kind: 'text', id: name } as ItemReference;
    };
    const seedImage = async (name = crypto.randomUUID(), owner = 'alice') => {
      await db
        .prepare(
          'INSERT INTO clipboard_images(id,owner,name,object_key,size,width,height,created_at) VALUES (?,?,?,?,1,1,1,0)',
        )
        .bind(name, owner, name, 'image/' + name)
        .run();
      return { kind: 'image', id: name } as ItemReference;
    };
    const seedDoc = async (
      name = crypto.randomUUID(),
      owner = 'alice',
      kind = 'file',
      mime = 'application/pdf',
      state = 'ready',
    ) => {
      await db
        .prepare(
          'INSERT INTO content_items(id,owner,kind,name,filename,mime,url,object_key,created_at,state) VALUES (?,?,?,?,?,?,?,?,0,?)',
        )
        .bind(
          name,
          owner,
          kind,
          name,
          'fixture.pdf',
          mime,
          kind === 'link' ? 'https://docs.google.com/document/d/test/edit' : '',
          kind === 'link' ? '' : 'document/' + name,
          state,
        )
        .run();
      return { kind: 'document', id: name } as ItemReference;
    };
    const write = async (
      pile: string,
      ref: ItemReference,
      action = 'add',
      extra: Record<string, unknown> = {},
    ) =>
      json(`piles/${pile}/members`, 'POST', {
        operationId: crypto.randomUUID(),
        revision: (await json(`piles/${pile}/members`)).pile.revision,
        ref,
        action,
        ...extra,
      });
    const view = async (ref: ItemReference) =>
      json(`items/${ref.kind}/${ref.id}`);
    await t.test(
      'owner-safe SQL aggregate, actual capabilities, consistent pages and stale cursors',
      async () => {
        const text = await seedText('same-id-0001'),
          image = await seedImage(text.id),
          doc = await seedDoc(text.id);
        await seedDoc('link-0001', 'alice', 'link');
        await seedDoc(
          'upload-0001',
          'alice',
          'file',
          'application/pdf',
          'uploading',
        );
        await seedText('other-account', 'bob');
        await db.prepare('UPDATE clips SET updated_at=0').run();
        const first = await json('items?limit=1');
        assert.equal(first.items.length, 1);
        assert.deepEqual(first.items[0].ref, text);
        let cursor = first.nextCursor;
        const ids = [first.items[0].ref];
        while (cursor) {
          const page = await json('items?limit=1&cursor=' + cursor);
          ids.push(...page.items.map((i: SharedItem) => i.ref));
          cursor = page.nextCursor;
        }
        assert.equal(ids.length, 4);
        assert.equal(new Set(ids.map((i) => i.kind + ':' + i.id)).size, 4);
        assert.equal(
          (
            await call(
              'items?cursor=' + first.nextCursor,
              'GET',
              undefined,
              'bob',
            )
          ).status,
          400,
        );
        assert.equal((await call('items?q=hello')).status, 400);
        assert.equal(
          (await view(image)).capabilities.copy,
          'image-if-supported',
        );
        assert.equal((await view(doc)).capabilities.print, true);
        const link = await view({ kind: 'document', id: 'link-0001' });
        assert.equal(link.contentKind, 'link');
        assert.equal(link.capabilities.download, false);
        assert.equal(link.capabilities.copy, null);
        assert.equal((await view(text)).cleanup.eligible, false);
        await call('text/' + text.id, 'PATCH', {
          action: 'edit',
          revision: 1,
          content: 'changed',
        });
        const stale = await call('items?cursor=' + first.nextCursor);
        assert.equal(stale.status, 409);
        assert.equal(
          ((await stale.json()) as TestResponse).code,
          'cursor_stale',
        );
        assert.equal(
          (await call('items/text/' + text.id, 'GET', undefined, 'bob')).status,
          404,
        );
      },
    );
    await t.test(
      'owner checked twice; retry receipts survive subsequent changes without reapplying',
      async () => {
        const pile = await seedPile(),
          ref = await seedText();
        await seedPile('pile-bob1', 'bob');
        const foreign = await seedText(undefined, 'bob');
        for (const [p, r] of [
          [pile, foreign],
          ['pile-bob1', ref],
        ] as const)
          assert.equal(
            (
              await call(`piles/${p}/members`, 'POST', {
                operationId: crypto.randomUUID(),
                revision: 1,
                action: 'add',
                ref: r,
              })
            ).status,
            404,
          );
        await assert.rejects(
          db
            .prepare('INSERT INTO pile_members VALUES (?,?,?,?,0,1,?)')
            .bind(pile, 'alice', 'text', foreign.id, 'bad-op-01')
            .run(),
          /item_gone/,
        );
        const input = {
          operationId: crypto.randomUUID(),
          revision: 1,
          ref,
          action: 'add',
        };
        const before = await rev(),
          both = await Promise.all([
            json(`piles/${pile}/members`, 'POST', input),
            json(`piles/${pile}/members`, 'POST', input),
          ]);
        assert.ok((await rev()) > before);
        assert.equal(both[0].pileRevision, 2);
        assert.equal(both[1].pileRevision, 2);
        const after = await rev();
        const replay = await json(`piles/${pile}/members`, 'POST', input);
        assert.equal(replay.item.cleanup.reason, 'pile');
        assert.equal(await rev(), after);
        const noop = await write(pile, ref);
        assert.equal(noop.changed, false);
        assert.equal(await rev(), after);
        await write(pile, ref, 'remove');
        await json(`piles/${pile}/members`, 'POST', input);
        assert.equal((await json(`piles/${pile}/members`)).members.length, 0);
        const collision = await call(`piles/${pile}/members`, 'POST', {
          ...input,
          action: 'remove',
        });
        assert.equal(collision.status, 409);
      },
    );
    await t.test(
      'manual order serializes concurrent moves; Undo retains slots across other changes',
      async () => {
        const pile = await seedPile('order-0001'),
          a = await seedText(),
          b = await seedText(),
          c = await seedText(),
          d = await seedText();
        for (const ref of [a, b, c]) await write(pile, ref);
        const removed = await write(pile, b, 'remove');
        await write(pile, d);
        await write(pile, c, 'move', { before: a });
        await write(pile, b, 'restore', {
          undoOperationId: removed.operationId,
        });
        assert.deepEqual(
          (await json(`piles/${pile}/members`)).members.map(
            (m: { ref: ItemReference; position: number }) => m.ref,
          ),
          [c, a, b, d],
        );
        const revision = (await json(`piles/${pile}/members`)).pile.revision;
        const outcomes = await Promise.all(
          [a, d].map((ref) =>
            call(`piles/${pile}/members`, 'POST', {
              operationId: crypto.randomUUID(),
              revision,
              ref,
              action: 'move',
              before: c,
            }),
          ),
        );
        assert.deepEqual(
          outcomes.map((r) => r.status).sort((a, b) => a - b),
          [200, 409],
        );
        const positions = (await json(`piles/${pile}/members`)).members.map(
          (m: { ref: ItemReference; position: number }) => m.position,
        );
        assert.equal(new Set(positions).size, 4);
        const old = await write(pile, b, 'remove');
        await write(pile, b);
        await write(pile, b, 'remove');
        assert.equal(
          (
            await call(`piles/${pile}/members`, 'POST', {
              operationId: crypto.randomUUID(),
              revision: (await json(`piles/${pile}/members`)).pile.revision,
              ref: b,
              action: 'restore',
              undoOperationId: old.operationId,
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      'cleanup protects piles, removal pins atomically, source deletion removes all refs and queues bytes',
      async () => {
        await db
          .prepare(
            "INSERT INTO preferences(owner,clipboard_daily_cleanup) VALUES('alice',1)",
          )
          .run();
        const pile = await seedPile('retain-001'),
          other = await seedPile('retain-002');
        const text = await seedText(),
          image = await seedImage(),
          doc = await seedDoc();
        await db
          .prepare('UPDATE clips SET created_at=0 WHERE id=?')
          .bind(text.id)
          .run();
        for (const ref of [text, image, doc]) {
          await write(pile, ref);
          await write(other, ref);
        }
        const cleanup = () =>
          runClipboardCleanup(db, { delete: async () => {} }, Date.now());
        await cleanup();
        for (const ref of [text, image, doc])
          assert.equal((await view(ref)).cleanup.reason, 'pile');
        await write(other, image, 'remove');
        const removed = await write(pile, image, 'removeAndPin');
        assert.equal(removed.item.pinned, true);
        assert.equal(removed.item.cleanup.reason, 'pinned');
        await cleanup();
        assert.equal((await view(image)).pinned, true);
        const deleted = await call(`text/${text.id}?revision=1`, 'DELETE');
        assert.equal(deleted.status, 200);
        assert.equal(
          (
            await db
              .prepare(
                'SELECT COUNT(*) AS n FROM pile_members WHERE kind=? AND item_id=?',
              )
              .bind('text', text.id)
              .first<{ n: number }>()
          )?.n,
          0,
        );
        await db
          .prepare('DELETE FROM content_items WHERE id=?')
          .bind(doc.id)
          .run();
        assert.ok(
          await db
            .prepare('SELECT 1 FROM content_deletion_queue WHERE object_key=?')
            .bind('document/' + doc.id)
            .first(),
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT COUNT(*) AS n FROM pile_members WHERE kind=? AND item_id=?',
              )
              .bind('document', doc.id)
              .first<{ n: number }>()
          )?.n,
          0,
        );
        const gone = await call(`piles/${pile}/members`, 'POST', {
          operationId: crypto.randomUUID(),
          revision: (await json(`piles/${pile}/members`)).pile.revision,
          action: 'add',
          ref: text,
        });
        assert.equal(((await gone.json()) as TestResponse).code, 'item_gone');
      },
    );
    await t.test(
      'concurrent last-protection removals return actual status; remove-and-pin races stay safe',
      async () => {
        const a = await seedPile('impact-0001'),
          b = await seedPile('impact-0002'),
          ref = await seedImage();
        await write(a, ref);
        await write(b, ref);
        const results = await Promise.all([
          write(a, ref, 'remove'),
          write(b, ref, 'remove'),
        ]);
        assert.equal(results.filter((x) => x.item.cleanup.eligible).length, 1);
        assert.equal((await view(ref)).cleanup.eligible, true);
        await write(a, ref);
        const [kept] = await Promise.all([
          write(a, ref, 'removeAndPin'),
          runClipboardCleanup(db, { delete: async () => {} }, Date.now()),
        ]);
        assert.equal(kept.item.cleanup.reason, 'pinned');
        assert.equal((await view(ref)).pinned, true);
        const text = await seedText();
        await write(a, text);
        const before = (await view(text)).revision;
        assert.equal(
          (
            await call('text/' + text.id, 'PATCH', {
              action: 'organize',
              revision: before,
              collection: 'Legacy collection',
              tags: ['kept'],
            })
          ).status,
          200,
        );
        assert.equal((await view(text)).cleanup.reason, 'pile');
        const source = await call('text/' + text.id);
        assert.equal(
          ((await source.json()) as { collection: string }).collection,
          'Legacy collection',
        );
      },
    );
    await t.test(
      'add versus cleanup and source deletion never create dangling memberships',
      async () => {
        const pile = await seedPile('racing-001');
        for (let n = 0; n < 8; n++) {
          const ref = await seedImage();
          const revision = (await json(`piles/${pile}/members`)).pile.revision;
          const [added] = await Promise.all([
            call(`piles/${pile}/members`, 'POST', {
              operationId: crypto.randomUUID(),
              revision,
              ref,
              action: 'add',
            }),
            runClipboardCleanup(db, { delete: async () => {} }, Date.now()),
          ]);
          const exists = await db
            .prepare('SELECT 1 FROM clipboard_images WHERE id=?')
            .bind(ref.id)
            .first();
          const member = await db
            .prepare(
              'SELECT 1 FROM pile_members WHERE pile_id=? AND item_id=? AND active=1',
            )
            .bind(pile, ref.id)
            .first();
          assert.equal(!!exists, !!member);
          if (added.status !== 200)
            assert.equal(
              ((await added.json()) as TestResponse).code,
              'item_cleared',
            );
        }
        const ref = await seedImage(),
          revision = (await json(`piles/${pile}/members`)).pile.revision;
        await Promise.all([
          call(`piles/${pile}/members`, 'POST', {
            operationId: crypto.randomUUID(),
            revision,
            ref,
            action: 'add',
          }),
          db
            .prepare('DELETE FROM clipboard_images WHERE id=?')
            .bind(ref.id)
            .run(),
        ]);
        assert.equal(
          await db
            .prepare('SELECT 1 FROM pile_members WHERE item_id=?')
            .bind(ref.id)
            .first(),
          null,
        );
        const cleared = await seedImage();
        await runClipboardCleanup(db, { delete: async () => {} }, Date.now());
        const response = await call(`piles/${pile}/members`, 'POST', {
          operationId: crypto.randomUUID(),
          revision: (await json(`piles/${pile}/members`)).pile.revision,
          ref: cleared,
          action: 'add',
        });
        assert.equal(
          ((await response.json()) as TestResponse).code,
          'item_cleared',
        );
      },
    );
  } finally {
    await mf.dispose();
  }
});

void test('0009 upgrades populated legacy stores without changing text, collections or ready files', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
  });
  try {
    const db = await mf.getD1Database('DB');
    const apply = async (file: string) => {
      for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
        '--> statement-breakpoint',
      ))
        if (sql.trim()) await db.prepare(sql).run();
    };
    for (const file of readdirSync('drizzle')
      .filter((f) => f.endsWith('.sql') && f < '0009')
      .sort())
      await apply(file);
    await db
      .prepare(
        `INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,tags,pinned,revision,clipboard_item,created_at,updated_at) VALUES('legacy-0001','legacy-owner','Before','note','Saved body','Original body','[]','[]','Exact Collection','["tag"]',1,9,0,1,2)`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO clipboard_images(id,owner,name,object_key,size,width,height,created_at,pinned) VALUES('image-0001','legacy-owner','Before','old/image-key',11,3,4,5,1)`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO content_items(id,owner,kind,name,object_key,size,created_at,state,pinned) VALUES('document-0001','legacy-owner','file','Before','old/document-key',12,6,'ready',1)`,
      )
      .run();
    const before = await db.prepare('SELECT * FROM clips').first();
    await apply('0009_shared_items.sql');
    assert.deepEqual(await db.prepare('SELECT * FROM clips').first(), before);
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) AS n FROM piles')
          .first<{ n: number }>()
      )?.n,
      0,
    );
    for (const table of ['clipboard_images', 'content_items']) {
      const row = await db
        .prepare(`SELECT owner,pinned,item_revision FROM ${table}`)
        .first<{ owner: string; pinned: number; item_revision: number }>();
      assert.deepEqual(row, {
        owner: 'legacy-owner',
        pinned: 1,
        item_revision: 1,
      });
    }
    assert.equal(
      (
        await db
          .prepare('SELECT object_key FROM content_items')
          .first<{ object_key: string }>()
      )?.object_key,
      'old/document-key',
    );
  } finally {
    await mf.dispose();
  }
});
