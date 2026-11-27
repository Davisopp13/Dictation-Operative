import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { handleAPI } from '../lib/server';
import { createPile, deletePile, readPileDeletionImpact } from '../lib/piles';
import { runClipboardCleanup } from '../lib/clipboard-cleanup';
import type { ItemReference } from '../lib/shared-items';

const uuid = () => crypto.randomUUID();
type Result = {
  code: string;
  pile: {
    id: string;
    name: string;
    color: string;
    revision: number;
    createdAt: number;
    updatedAt: number;
    memberCount: number;
  };
  piles: Result['pile'][];
  revision: number;
  nextCursor: string | null;
  operationId: string;
  changed: boolean;
  replayed: boolean;
  committedAt: number;
  pileRevision: number;
  members: { ref: ItemReference; position: number }[];
  impactToken: string;
  exposed: {
    ref: ItemReference;
    name: string;
    clearsAt: number;
    eligibleAfter: number;
  }[];
  pinned: ItemReference[];
  memberCount: number;
};
void test('P1 pile lifecycle on isolated D1/R2', async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
    r2Buckets: ['IMAGES'],
  });
  try {
    const db = await mf.getD1Database('DB'),
      bucket = await mf.getR2Bucket('IMAGES');
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
      via?: 'session' | 'bearer',
      origin = 'https://do.test',
    ) =>
      handleAPI(
        new Request('https://do.test/api/v1/' + path, {
          method,
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        }),
        { db, owner, via },
      );
    const ok = async (
      path: string,
      method = 'GET',
      data?: unknown,
      owner = 'alice',
    ) => {
      const response = await call(path, method, data, owner),
        result = (await response.json()) as Result;
      assert.ok([200, 201].includes(response.status), JSON.stringify(result));
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      return result;
    };
    const error = async (
      path: string,
      method: string,
      data: unknown,
      status: number,
      code?: string,
      owner = 'alice',
    ) => {
      const response = await call(path, method, data, owner);
      assert.equal(response.status, status, await response.clone().text());
      if (code) assert.equal(((await response.json()) as Result).code, code);
    };
    const count = async (table: string, owner = 'alice') =>
      (await db
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE owner=?`)
        .bind(owner)
        .first<{ n: number }>())!.n;
    const workspace = async () => (await ok('revision')).revision;
    const seed = async (
      kind: ItemReference['kind'],
      owner = 'alice',
      itemId = uuid(),
      state = 'ready',
      link = false,
    ): Promise<ItemReference> => {
      if (kind === 'text') {
        await ok(
          'text',
          'POST',
          { id: itemId, content: 'original body', title: 'Grocery note' },
          owner,
        );
        await db
          .prepare('UPDATE clips SET created_at=0 WHERE id=?')
          .bind(itemId)
          .run();
      } else if (kind === 'image') {
        await db
          .prepare(
            "INSERT INTO clipboard_images(id,owner,name,object_key,size,width,height,created_at) VALUES(?,?,'Screenshot',?,5,1,1,0)",
          )
          .bind(itemId, owner, 'image/' + itemId)
          .run();
        await bucket.put('image/' + itemId, 'bytes');
      } else {
        await db
          .prepare(
            "INSERT INTO content_items(id,owner,kind,name,filename,mime,url,object_key,size,created_at,state) VALUES(?,?,?,'Receipt','receipt.pdf','application/pdf',?,?,5,0,?)",
          )
          .bind(
            itemId,
            owner,
            link ? 'link' : 'file',
            link ? 'https://docs.google.com/spreadsheets/d/synthetic/edit' : '',
            link ? '' : 'doc/' + itemId,
            state,
          )
          .run();
        if (!link) await bucket.put('doc/' + itemId, 'bytes');
      }
      return { kind, id: itemId };
    };
    const create = (
      members: ItemReference[] = [],
      owner = 'alice',
      name = 'Errands',
    ) => ok('piles', 'POST', { operationId: uuid(), name, members }, owner);
    const write = async (
      pileId: string,
      ref: ItemReference,
      action: string,
      extra = {},
    ) =>
      ok(`piles/${pileId}/members`, 'POST', {
        operationId: uuid(),
        revision: (await ok(`piles/${pileId}`)).pile.revision,
        ref,
        action,
        ...extra,
      });
    const preview = (pileId: string) => ok(`piles/${pileId}/deletion-impact`);
    const deletion = (impact: Result, mode = 'pin') => ({
      operationId: uuid(),
      revision: impact.pile.revision,
      impactToken: impact.impactToken,
      mode,
      ...(mode === 'expose' ? { acknowledgeExposure: true } : {}),
    });
    const cleanup = () => runClipboardCleanup(db, bucket);

    await t.test(
      'mixed initial selection, typed identity, source preservation, deterministic pages and owner isolation',
      async () => {
        const same = uuid(),
          text = await seed('text', 'alice', same),
          image = await seed('image', 'alice', same),
          doc = await seed('document', 'alice', same),
          link = await seed('document', 'alice', uuid(), 'ready', true);
        const refs = [image, link, text, doc];
        const before = await db.batch(
          ['clips', 'clipboard_images', 'content_items'].map((table) =>
            db.prepare(
              `SELECT * FROM ${table} WHERE owner='alice' ORDER BY id`,
            ),
          ),
        );
        const pile = (await create(refs)).pile;
        assert.equal(pile.memberCount, 4);
        assert.ok(pile.createdAt > 0);
        assert.equal(pile.color, 'blue');
        assert.deepEqual(
          (await ok(`piles/${pile.id}/members`)).members.map((m) => m.ref),
          refs,
        );
        await create(refs); // Duplicate names and references in another pile are legal.
        const after = await db.batch(
          ['clips', 'clipboard_images', 'content_items'].map((table) =>
            db.prepare(
              `SELECT * FROM ${table} WHERE owner='alice' ORDER BY id`,
            ),
          ),
        );
        assert.deepEqual(
          after.map((r) => r.results),
          before.map((r) => r.results),
        );
        assert.equal(
          await (await bucket.get('image/' + same))!.text(),
          'bytes',
        );
        assert.equal(await (await bucket.get('doc/' + same))!.text(), 'bytes');
        for (const path of [
          `piles/${pile.id}`,
          `piles/${pile.id}/members`,
          `piles/${pile.id}/deletion-impact`,
        ])
          await error(path, 'GET', undefined, 404, 'pile_gone', 'bob');
        await error(
          `piles/${pile.id}`,
          'PATCH',
          { operationId: uuid(), revision: 1, name: 'Stolen' },
          404,
          'pile_gone',
          'bob',
        );
        assert.deepEqual(
          (await ok('piles', 'GET', undefined, 'bob')).piles,
          [],
        );
        // Force a tie and verify binary id ordering.
        await db
          .prepare("UPDATE piles SET updated_at=10 WHERE owner='alice'")
          .run();
        const first = await ok('piles?limit=1'),
          second = await ok('piles?limit=1&cursor=' + first.nextCursor);
        assert.ok(first.piles[0].id > second.piles[0].id);
        assert.equal(second.nextCursor, null);
        await error(
          'piles?cursor=' + first.nextCursor,
          'GET',
          undefined,
          400,
          undefined,
          'bob',
        );
        await error('piles?sort=name', 'GET', undefined, 400);
        await create();
        await error(
          'piles?cursor=' + first.nextCursor,
          'GET',
          undefined,
          409,
          'cursor_stale',
        );
      },
    );
    await t.test(
      'validation, unavailable sources and partial-failure rollback leave no pile, slots, receipt or invalidation',
      async () => {
        const valid = await seed('text'),
          foreign = await seed('image', 'bob'),
          pending = await seed('document', 'alice', uuid(), 'uploading'),
          writing = await seed('document', 'alice', uuid(), 'writing');
        for (const bad of [
          { kind: 'text', id: uuid() },
          foreign,
          pending,
          writing,
        ]) {
          const before = [
            await count('piles'),
            await count('pile_members'),
            await count('pile_operations'),
            await workspace(),
          ];
          await error(
            'piles',
            'POST',
            { operationId: uuid(), name: 'Rollback', members: [valid, bad] },
            404,
            'item_gone',
          );
          assert.deepEqual(
            [
              await count('piles'),
              await count('pile_members'),
              await count('pile_operations'),
              await workspace(),
            ],
            before,
          );
        }
        for (const props of [
          { name: '  ' },
          { name: 'a'.repeat(61) },
          { color: 'red' },
          { name: '\0' },
          { color: null },
          { members: null },
          { members: [{ kind: ['text'], id: valid.id }] },
          { members: [valid, valid] },
          {
            members: Array.from({ length: 51 }, () => ({
              kind: 'text',
              id: uuid(),
            })),
          },
          { members: [{ kind: 'bookmark', id: uuid() }] },
          { extra: true },
        ])
          await error(
            'piles',
            'POST',
            { operationId: uuid(), name: 'Valid', ...props },
            400,
          );
        assert.equal(
          (
            await ok('piles', 'POST', {
              operationId: uuid(),
              name: '  Trimmed  ',
              color: 'mint',
            })
          ).pile.name,
          'Trimmed',
        );
        assert.equal(
          (
            await ok('piles', 'POST', {
              operationId: uuid(),
              name: '😀'.repeat(60),
            })
          ).pile.name,
          '😀'.repeat(60),
        );
        await error(
          'piles',
          'POST',
          { operationId: uuid(), name: 'a'.repeat(13000) },
          413,
        );
        const refs = await Promise.all(
          Array.from({ length: 50 }, () => seed('image')),
        );
        assert.equal((await create(refs)).pile.memberCount, 50);
      },
    );
    await t.test(
      'create/update exact retries, cross-operation conflicts, concurrent revisions and no-op invalidation',
      async () => {
        const input = { operationId: uuid(), name: 'Replay', color: 'sky' };
        const results = await Promise.all([
          ok('piles', 'POST', input),
          ok('piles', 'POST', input),
        ]);
        assert.equal(results[0].pile.id, results[1].pile.id);
        assert.deepEqual(
          results.map((r) => r.replayed).sort((a, b) => Number(a) - Number(b)),
          [false, true],
        );
        const pileId = results[0].pile.id,
          path = `piles/${pileId}`;
        const update = {
          operationId: uuid(),
          revision: 1,
          name: 'Renamed',
          color: 'sunny',
        };
        const updated = await ok(path, 'PATCH', update);
        assert.equal(updated.pile.revision, 2);
        assert.equal(updated.pile.createdAt, results[0].pile.createdAt);
        const before = await workspace();
        const noop = await ok(path, 'PATCH', {
          operationId: uuid(),
          revision: 2,
          name: ' Renamed ',
          color: 'sunny',
        });
        assert.equal(noop.changed, false);
        assert.equal(noop.pile.updatedAt, updated.pile.updatedAt);
        assert.equal(await workspace(), before);
        const retry = await ok(path, 'PATCH', update);
        assert.deepEqual({ ...retry, replayed: false }, updated);
        assert.equal(await workspace(), before);
        await error(
          path,
          'PATCH',
          { ...update, color: 'paper' },
          409,
          'operation_conflict',
        );
        await error(
          path,
          'PATCH',
          { operationId: input.operationId, revision: 2, name: 'Bad' },
          409,
          'operation_conflict',
        );
        await error(
          path,
          'PATCH',
          { operationId: uuid(), revision: 1, name: 'Renamed' },
          409,
          'revision_conflict',
        );
        const concurrent = await Promise.all(
          ['A', 'B'].map((name) =>
            call(path, 'PATCH', { operationId: uuid(), revision: 2, name }),
          ),
        );
        assert.deepEqual(
          concurrent.map((r) => r.status).sort((a, b) => a - b),
          [200, 409],
        );
        assert.equal((await ok('piles', 'POST', input)).pile.name, 'Replay');
        assert.notEqual((await ok(path)).pile.name, 'Replay');
      },
    );
    await t.test(
      '100-pile limit serialized for concurrent distinct and duplicate creates',
      async () => {
        const owner = 'limit-owner';
        await db.batch(
          Array.from({ length: 99 }, (_, i) =>
            db
              .prepare(
                'INSERT INTO piles(id,owner,name,updated_at) VALUES(?,?,?,0)',
              )
              .bind('limit-pile-' + i, owner, 'Limit'),
          ),
        );
        const input = { operationId: uuid(), name: 'Last' };
        const responses = await Promise.all([
          call('piles', 'POST', input, owner),
          call('piles', 'POST', input, owner),
          call(
            'piles',
            'POST',
            { operationId: uuid(), name: 'Competitor' },
            owner,
          ),
        ]);
        assert.equal(await count('piles', owner), 100);
        const status = responses.map((r) => r.status);
        assert.equal(status.filter((s) => s === 201).length, 1);
        assert.ok(status.every((s) => [200, 201, 409].includes(s)));
        await error(
          'piles',
          'POST',
          { operationId: uuid(), name: 'Too many' },
          409,
          'limit_reached',
          owner,
        );
      },
    );
    await t.test(
      'P1 metadata and F2 order/removal/Undo interoperate without slot compaction',
      async () => {
        const a = await seed('text'),
          b = await seed('image'),
          c = await seed('document'),
          d = await seed('text');
        const p = (await create([a, b, c])).pile.id;
        const removed = await write(p, b, 'removeAndPin');
        await write(p, d, 'add');
        await write(p, c, 'move', { before: a });
        await ok(`piles/${p}`, 'PATCH', {
          operationId: uuid(),
          revision: (await ok(`piles/${p}`)).pile.revision,
          name: 'New name',
        });
        await write(p, b, 'restore', { undoOperationId: removed.operationId });
        assert.deepEqual(
          (await ok(`piles/${p}/members`)).members.map((m) => m.ref),
          [c, a, b, d],
        );
        assert.equal(
          (await db
            .prepare('SELECT pinned FROM clipboard_images WHERE id=?')
            .bind(b.id)
            .first<{ pinned: number }>())!.pinned,
          1,
        );
        await write(p, b, 'remove');
        assert.equal((await ok(`piles/${p}`)).pile.memberCount, 3);
        assert.equal(
          (await db
            .prepare('SELECT count(*) n FROM pile_members WHERE pile_id=?')
            .bind(p)
            .first<{ n: number }>())!.n,
          4,
        );
        const full = (await create()).pile.id;
        const refs = Array.from({ length: 500 }, () => uuid());
        await db.batch([
          db
            .prepare(
              "INSERT INTO clipboard_images(id,owner,name,object_key,size,width,height,created_at) SELECT value,'alice','Capacity',value,1,1,1,0 FROM json_each(?)",
            )
            .bind(JSON.stringify(refs)),
          db
            .prepare(
              "INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation) SELECT ?,'alice','image',value,CAST(key AS INTEGER),0,'old-remove' FROM json_each(?)",
            )
            .bind(full, JSON.stringify(refs)),
        ]);
        await error(
          `piles/${full}/members`,
          'POST',
          { operationId: uuid(), revision: 1, action: 'add', ref: a },
          409,
          'limit_reached',
        );
        await write(full, { kind: 'image', id: refs[0] }, 'add');
        assert.equal(
          (await ok(`piles/${full}/members`)).members[0].position,
          499,
        );
      },
    );
    await t.test(
      'impact detects changes to pins, other piles and cleanup settings with unchanged target revision',
      async () => {
        await db
          .prepare(
            "INSERT INTO preferences(owner,clipboard_daily_cleanup) VALUES('alice',1)",
          )
          .run();
        const a = await seed('text'),
          b = await seed('image'),
          doc = await seed('document');
        const p = (await create([a, b, doc])).pile.id,
          other = (await create([b])).pile.id;
        const impact = await preview(p);
        assert.deepEqual(
          impact.exposed.map((i) => i.ref),
          [a],
        );
        assert.equal(impact.memberCount, 3);
        assert.equal(impact.exposed[0].name, 'Grocery note');
        assert.ok(impact.exposed[0].clearsAt > Date.now());
        await write(other, b, 'remove');
        assert.equal(
          (await ok(`piles/${p}`)).pile.revision,
          impact.pile.revision,
        );
        await error(
          `piles/${p}`,
          'DELETE',
          deletion(impact, 'expose'),
          409,
          'impact_stale',
        );
        const next = await preview(p);
        assert.equal(next.exposed.length, 2);
        await db
          .prepare('UPDATE clipboard_images SET pinned=1 WHERE id=?')
          .bind(b.id)
          .run();
        await error(
          `piles/${p}`,
          'DELETE',
          deletion(next),
          409,
          'impact_stale',
        );
        const pinned = await preview(p);
        await db
          .prepare(
            "UPDATE preferences SET clipboard_daily_cleanup=0 WHERE owner='alice'",
          )
          .run();
        await error(
          `piles/${p}`,
          'DELETE',
          deletion(pinned),
          409,
          'impact_stale',
        );
        const disabled = await preview(p);
        assert.equal(disabled.exposed.length, 0);
        await db
          .prepare(
            "UPDATE preferences SET clipboard_daily_cleanup=1 WHERE owner='alice'",
          )
          .run();
        await error(
          `piles/${p}`,
          'DELETE',
          deletion(disabled, 'expose'),
          409,
          'impact_stale',
        );
        const before = await preview(p);
        await write(p, doc, 'remove');
        await error(
          `piles/${p}`,
          'DELETE',
          deletion(before),
          409,
          'impact_stale',
        );
        const latest = await preview(p);
        for (const mode of [['pin'], ['expose'], {}, null, 'unknown'])
          await error(
            `piles/${p}`,
            'DELETE',
            { ...deletion(latest), mode },
            400,
          );
        await error(
          `piles/${p}`,
          'DELETE',
          { ...deletion(latest, 'expose'), acknowledgeExposure: false },
          400,
        );
        await error(
          `piles/${p}`,
          'DELETE',
          deletion(latest),
          400,
          undefined,
          'bob',
        );
      },
    );
    await t.test(
      'safe deletion pins only newly exposed sources atomically; retries never recreate or repin',
      async () => {
        const a = await seed('text'),
          b = await seed('image'),
          doc = await seed('document'),
          shared = await seed('image');
        const input = {
          operationId: uuid(),
          name: 'Delete safely',
          members: [a, b, doc, shared],
        };
        const created = await ok('piles', 'POST', input),
          p = created.pile.id;
        const other = (await create([shared])).pile.id;
        const original = await db
          .prepare(
            'SELECT content,original,segments,versions FROM clips WHERE id=?',
          )
          .bind(a.id)
          .first();
        const impact = await preview(p),
          request = deletion(impact);
        const result = await ok(`piles/${p}`, 'DELETE', request);
        assert.deepEqual(result.pinned, [a, b]);
        assert.equal((await call(`piles/${p}`)).status, 404);
        for (const ref of [a, b, doc, shared])
          assert.equal((await call(`items/${ref.kind}/${ref.id}`)).status, 200);
        assert.equal((await ok(`piles/${other}`)).pile.memberCount, 1);
        assert.equal(
          await (await bucket.get('image/' + b.id))!.text(),
          'bytes',
        );
        assert.equal(
          await (await bucket.get('doc/' + doc.id))!.text(),
          'bytes',
        );
        assert.deepEqual(
          await db
            .prepare(
              'SELECT content,original,segments,versions FROM clips WHERE id=?',
            )
            .bind(a.id)
            .first(),
          original,
        );
        await db
          .prepare('UPDATE clipboard_images SET pinned=0 WHERE id=?')
          .bind(b.id)
          .run();
        const rev = await workspace();
        assert.deepEqual(
          { ...(await ok(`piles/${p}`, 'DELETE', request)), replayed: false },
          result,
        );
        assert.equal(await workspace(), rev);
        assert.equal(
          (await db
            .prepare('SELECT pinned FROM clipboard_images WHERE id=?')
            .bind(b.id)
            .first<{ pinned: number }>())!.pinned,
          0,
        );
        assert.equal((await ok('piles', 'POST', input)).pile.id, p);
        assert.equal((await call(`piles/${p}`)).status, 404);
        await error(
          `piles/${p}`,
          'DELETE',
          { ...request, mode: 'expose', acknowledgeExposure: true },
          409,
          'operation_conflict',
        );
        const empty = (await create()).pile.id,
          concurrentRequest = deletion(await preview(empty));
        const both = await Promise.all([
          ok(`piles/${empty}`, 'DELETE', concurrentRequest),
          ok(`piles/${empty}`, 'DELETE', concurrentRequest),
        ]);
        assert.deepEqual(
          both.map((r) => r.replayed).sort((a, b) => Number(a) - Number(b)),
          [false, true],
        );
      },
    );
    await t.test(
      'explicit exposure preserves sources immediately, then permits cleanup and durable byte deletion',
      async () => {
        const image = await seed('image'),
          doc = await seed('document'),
          p = (await create([image, doc])).pile.id;
        const impact = await preview(p);
        assert.deepEqual(
          impact.exposed.map((i) => i.ref),
          [image],
        );
        await ok(`piles/${p}`, 'DELETE', deletion(impact, 'expose'));
        assert.ok(await bucket.get('image/' + image.id));
        assert.equal((await call('items/image/' + image.id)).status, 200);
        await cleanup();
        assert.equal((await call('items/image/' + image.id)).status, 410);
        assert.equal(await bucket.get('image/' + image.id), null);
        assert.equal((await call('items/document/' + doc.id)).status, 200);
      },
    );
    await t.test(
      'cleanup races with create and safe deletion never produce partial selection or unprotected state',
      async () => {
        for (let n = 0; n < 5; n++) {
          const image = await seed('image'),
            doc = await seed('document');
          const input = {
            operationId: uuid(),
            name: 'Race',
            members: [doc, image],
          };
          const [r] = await Promise.all([
            call('piles', 'POST', input),
            cleanup(),
          ]);
          if (r.status === 201) {
            const p = ((await r.json()) as Result).pile.id;
            assert.equal((await ok(`piles/${p}`)).pile.memberCount, 2);
            const request = deletion(await preview(p));
            // Other cleanup work may invalidate impact; a conflict must leave the pile.
            const [removed] = await Promise.all([
              call(`piles/${p}`, 'DELETE', request),
              cleanup(),
            ]);
            assert.ok([200, 409].includes(removed.status));
            await cleanup();
            assert.equal((await call('items/image/' + image.id)).status, 200);
          } else {
            assert.equal(r.status, 410);
            assert.equal(((await r.json()) as Result).code, 'item_cleared');
            assert.equal(
              await db
                .prepare('SELECT 1 FROM pile_operations WHERE operation_id=?')
                .bind(input.operationId)
                .first(),
              null,
            );
          }
          assert.equal((await call('items/document/' + doc.id)).status, 200);
        }
      },
    );
    await t.test(
      'transaction-time guards reject protection changes and source deletion after preflight',
      async () => {
        const image = await seed('image'),
          p = (await create([image])).pile.id;
        const impact = await readPileDeletionImpact(db, 'alice', p);
        let intercepted = false;
        const proxy = new Proxy(db, {
          get(target, prop) {
            if (prop === 'batch')
              return async (statements: D1PreparedStatement[]) => {
                if (statements.length === 6 && !intercepted) {
                  intercepted = true;
                  await db
                    .prepare('UPDATE clipboard_images SET pinned=1 WHERE id=?')
                    .bind(image.id)
                    .run();
                }
                return target.batch(statements);
              };
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        await assert.rejects(
          deletePile(proxy, 'alice', p, {
            operationId: uuid(),
            revision: impact.pile.revision,
            impactToken: impact.impactToken,
            mode: 'pin',
          }),
          { code: 'impact_stale' },
        );
        assert.equal((await ok(`piles/${p}`)).pile.memberCount, 1);
        const doc = await seed('document'),
          before = await count('piles');
        const createProxy = new Proxy(db, {
          get(target, prop) {
            if (prop === 'batch')
              return async (statements: D1PreparedStatement[]) => {
                await db
                  .prepare('DELETE FROM content_items WHERE id=?')
                  .bind(doc.id)
                  .run();
                return target.batch(statements);
              };
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        await assert.rejects(
          createPile(createProxy, 'alice', {
            operationId: uuid(),
            name: 'Deleted during create',
            members: [image, doc],
          }),
          { code: 'item_gone' },
        );
        assert.equal(await count('piles'), before);
      },
    );
    await t.test(
      'full 500-member deletion stays bounded; failed receipt insertion rolls back pins and deletion',
      async () => {
        const p = (await create()).pile.id,
          refs = Array.from({ length: 500 }, () => uuid());
        await db.batch([
          db
            .prepare(
              "INSERT INTO clipboard_images(id,owner,name,object_key,size,width,height,created_at) SELECT value,'alice','Full pile',value,1,1,1,0 FROM json_each(?)",
            )
            .bind(JSON.stringify(refs)),
          db
            .prepare(
              "INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation) SELECT ?,'alice','image',value,CAST(key AS INTEGER),1,'fixture-operation' FROM json_each(?)",
            )
            .bind(p, JSON.stringify(refs)),
        ]);
        const impact = await preview(p);
        assert.equal(impact.exposed.length, 500);
        const request = deletion(impact),
          before = await workspace();
        await db
          .prepare(
            "CREATE TRIGGER fail_p1_receipt BEFORE INSERT ON pile_operations WHEN json_extract(NEW.result,'$.action')='deletePile' BEGIN SELECT RAISE(ABORT,'synthetic receipt outage'); END",
          )
          .run();
        await assert.rejects(
          deletePile(db, 'alice', p, request),
          /synthetic receipt outage/,
        );
        assert.equal(await workspace(), before);
        assert.equal((await ok(`piles/${p}`)).pile.memberCount, 500);
        assert.equal(
          (await db
            .prepare(
              'SELECT count(*) n FROM clipboard_images WHERE pinned=1 AND id IN (SELECT value FROM json_each(?))',
            )
            .bind(JSON.stringify(refs))
            .first<{ n: number }>())!.n,
          0,
        );
        await db.prepare('DROP TRIGGER fail_p1_receipt').run();
        const result = await ok(`piles/${p}`, 'DELETE', request);
        assert.equal(result.pinned.length, 500);
        await cleanup();
        assert.equal(
          (await db
            .prepare(
              'SELECT count(*) n FROM clipboard_images WHERE pinned=1 AND id IN (SELECT value FROM json_each(?))',
            )
            .bind(JSON.stringify(refs))
            .first<{ n: number }>())!.n,
          500,
        );
      },
    );
    await t.test(
      'cleanup exemptions survive pile deletion and concurrent exact deletion replays after preflight',
      async () => {
        const legacy = await seed('text'),
          history = await seed('text'),
          pinned = await seed('image'),
          doc = await seed('document');
        await db
          .prepare('UPDATE clips SET clipboard_item=0 WHERE id IN (?,?)')
          .bind(legacy.id, history.id)
          .run();
        await db
          .prepare('UPDATE clips SET segments=? WHERE id=?')
          .bind(JSON.stringify([{ id: 'one' }, { id: 'two' }]), history.id)
          .run();
        await db
          .prepare('UPDATE clipboard_images SET pinned=1 WHERE id=?')
          .bind(pinned.id)
          .run();
        const p = (await create([legacy, history, pinned, doc])).pile.id,
          impact = await preview(p),
          request = deletion(impact);
        assert.deepEqual(impact.exposed, []);
        let raced = false;
        const proxy = new Proxy(db, {
          get(target, prop) {
            if (prop === 'batch')
              return async (statements: D1PreparedStatement[]) => {
                if (!raced) {
                  raced = true;
                  await deletePile(db, 'alice', p, request);
                }
                return target.batch(statements);
              };
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        assert.equal(
          (await deletePile(proxy, 'alice', p, request)).replayed,
          true,
        );
        await cleanup();
        for (const ref of [legacy, history, pinned, doc])
          assert.equal((await call(`items/${ref.kind}/${ref.id}`)).status, 200);
      },
    );
    await t.test(
      'session Origin rules apply; bearer creation uses the same service',
      async () => {
        const input = { operationId: uuid(), name: 'Native' };
        assert.equal(
          (
            await call(
              'piles',
              'POST',
              input,
              'alice',
              'session',
              'https://evil.test',
            )
          ).status,
          403,
        );
        assert.equal(
          (await call('piles', 'POST', input, 'alice', 'bearer', '')).status,
          201,
        );
      },
    );
  } finally {
    await mf.dispose();
  }
});

void test('0010 preserves populated F2 piles, slots, receipts, revisions and unknown creation times', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const file of readdirSync('drizzle')
      .filter((f) => f.endsWith('.sql') && f < '0010')
      .sort())
      for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
        '--> statement-breakpoint',
      ))
        if (sql.trim()) await db.prepare(sql).run();
    await db.batch([
      db.prepare(
        "INSERT INTO clipboard_images(id,owner,name,object_key,size,width,height,created_at) VALUES('old-image','legacy-owner','Original','old/key',10,2,3,4)",
      ),
      db.prepare(
        "INSERT INTO piles(id,owner,name,color,revision,updated_at) VALUES('old-pile1','legacy-owner','Existing','mint',8,123)",
      ),
      db.prepare(
        "INSERT INTO pile_members VALUES('old-pile1','legacy-owner','image','old-image',9,0,'old-operation')",
      ),
      db.prepare(
        "INSERT INTO pile_operations VALUES('legacy-owner','old-operation','old-pile1','fingerprint','receipt')",
      ),
    ]);
    const queries = [
      'SELECT id,owner,name,color,revision,updated_at,write_token FROM piles',
      'SELECT * FROM pile_members',
      'SELECT * FROM pile_operations',
      'SELECT * FROM clipboard_images',
      'SELECT * FROM workspace_revision',
    ];
    const before = await db.batch(queries.map((q) => db.prepare(q)));
    await db
      .prepare(readFileSync('drizzle/0010_pile_created_at.sql', 'utf8'))
      .run();
    assert.deepEqual(
      (await db.batch(queries.map((q) => db.prepare(q)))).map((r) => r.results),
      before.map((r) => r.results),
    );
    assert.equal(
      (await db
        .prepare('SELECT created_at FROM piles')
        .first<{ created_at: number | null }>())!.created_at,
      null,
    );
  } finally {
    await mf.dispose();
  }
});
