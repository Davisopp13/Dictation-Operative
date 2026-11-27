import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { handleAPI } from '../lib/server';
import {
  advanceCollectionBackfill,
  inspectCollectionBackfill,
} from '../lib/collection-mapping';
import { runClipboardCleanup } from '../lib/clipboard-cleanup';
import { writePileMember } from '../lib/pile-members';
import { deletePile as deletePileDirect } from '../lib/piles';
import { importedId, parseBackup } from '../lib/backup';
import { insertClip } from '../lib/repository';
import { newClip, type Clip } from '../lib/domain';
import { reconciliationPlan } from '../lib/erasure-reconciliation';

type API = Clip & {
  pile: {
    id: string;
    revision: number;
    name: string;
    color: string;
    memberCount: number;
  };
  piles: API['pile'][];
  item: { pinned: boolean; cleanup: { reason: string; eligible: boolean } };
  cleanup: { reason: string; eligible: boolean };
  changed: boolean;
  operationId: string;
  replayed: boolean;
  mappedKeys: number;
  imported: boolean;
  exposed: { ref: { kind: string; id: string } }[];
  impactToken: string;
};
type SourceRow = {
  revision: number;
  content: string;
  collection: string;
  collection_synced: number;
  versions: string;
  pinned: number;
};
const uuid = () => crypto.randomUUID();
void test('P2 collection coexistence, transactional backfill and lifecycle on real D1', async (t) => {
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
      .filter((f) => f.endsWith('.sql') && f < '0011')
      .sort())
      await apply(file);
    const seed = async (owner: string, collection: string, id = uuid()) => {
      await db
        .prepare(
          `INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,clipboard_item,created_at,updated_at) VALUES (?,?,'Title','note','body','original','[]','[]',?,1,0,0)`,
        )
        .bind(id, owner, collection)
        .run();
      return id;
    };
    const pre = await seed('upgrade', 'A');
    await db
      .prepare(
        "INSERT INTO piles(id,owner,name,updated_at) VALUES('upgrade-pile','upgrade','A',17)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO pile_members VALUES('upgrade-pile','upgrade','text',?,7,1,'old-add')",
      )
      .bind(pre)
      .run();
    const inactive = await seed('upgrade', '');
    await db
      .prepare(
        "INSERT INTO pile_members VALUES('upgrade-pile','upgrade','text',?,9,0,'old-remove')",
      )
      .bind(inactive)
      .run();
    await db
      .prepare(
        "INSERT INTO pile_operations VALUES('upgrade','old-remove','upgrade-pile','old-fingerprint',?)",
      )
      .bind(JSON.stringify({ action: 'remove', item: { revision: 1 } }))
      .run();
    const before = await db
      .prepare('SELECT * FROM clips WHERE owner=? ORDER BY id')
      .bind('upgrade')
      .all();
    await apply('0011_collection_mapping.sql');
    await t.test(
      'upgrade retains manual meaning, inactive order and exact receipts; no migration backfill',
      async () => {
        const rows = (
          await db
            .prepare(
              "SELECT * FROM pile_members WHERE owner='upgrade' ORDER BY position",
            )
            .all()
        ).results;
        assert.deepEqual(
          rows.map((x) => [
            x.manual ?? x.active,
            x.collection_key,
            x.position,
            x.active,
            x.last_operation,
          ]),
          [
            [1, null, 7, 1, 'old-add'],
            [0, null, 9, 0, 'old-remove'],
          ],
        );
        assert.equal(
          (await db
            .prepare('SELECT count(*) n FROM collection_mappings')
            .first())!.n,
          0,
        );
        const after = (
          await db
            .prepare("SELECT * FROM clips WHERE owner='upgrade' ORDER BY id")
            .all()
        ).results.map(({ collection_synced, ...row }) => {
          assert.equal(collection_synced, 0);
          return row;
        });
        assert.deepEqual(after, before.results);
        assert.equal(
          (await db
            .prepare(
              "SELECT fingerprint FROM pile_operations WHERE owner='upgrade'",
            )
            .first())!.fingerprint,
          'old-fingerprint',
        );
      },
    );
    await t.test(
      '0012 preserves populated P2 sources, mappings, slots, receipts and revisions',
      async () => {
        await db
          .prepare(
            "INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,collection_synced,created_at,updated_at) VALUES ('p2-upgrade-source','p2-upgrade','T','note','body','body','[]','[]','Existing mapping',1,0,0)",
          )
          .run();
        const tables = [
          'clips',
          'piles',
          'pile_members',
          'collection_mappings',
          'pile_operations',
          'workspace_revision',
        ];
        const snapshot = async () =>
          Promise.all(
            tables.map(
              async (table) =>
                (
                  await db
                    .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
                    .all()
                ).results,
            ),
          );
        const before = await snapshot();
        await apply('0012_collection_capacity_pending.sql');
        assert.deepEqual(await snapshot(), before);
      },
    );
    // Typed local helper; these tests also exercise the real server auth/Origin routing.
    const request = (
      owner: string,
      path: string,
      method = 'GET',
      data?: unknown,
      via: 'session' | 'bearer' = 'session',
      origin = 'https://do.test',
      accountId?: string,
    ) =>
      handleAPI(
        new Request('https://do.test/api/' + path, {
          method,
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        }),
        { db, owner, via, accountId },
      );
    const ok = async (
      owner: string,
      path: string,
      method = 'GET',
      data?: unknown,
    ) => {
      const r = await request(owner, path, method, data);
      assert.ok([200, 201].includes(r.status), await r.clone().text());
      assert.equal(r.headers.get('Cache-Control'), 'no-store');
      return r.json() as Promise<API>;
    };
    const mapping = async (owner: string, key: string) =>
      (
        await db
          .prepare(
            'SELECT pile_id FROM collection_mappings WHERE owner=? AND collection_key=?',
          )
          .bind(owner, key)
          .first<{ pile_id: string | null }>()
      )?.pile_id;
    const row = (id: string) =>
      db.prepare('SELECT * FROM clips WHERE id=?').bind(id).first<SourceRow>();
    const slots = async (owner: string, pile: string) =>
      (
        await db
          .prepare(
            'SELECT * FROM pile_members WHERE owner=? AND pile_id=? ORDER BY position,kind,item_id',
          )
          .bind(owner, pile)
          .all()
      ).results;
    const member = async (
      owner: string,
      pile: string,
      id: string,
      action: string,
      extra = {},
    ) =>
      ok(owner, `v1/piles/${pile}/members`, 'POST', {
        operationId: uuid(),
        revision: (await ok(owner, `v1/piles/${pile}`)).pile.revision,
        ref: { kind: 'text', id },
        action,
        ...extra,
      });
    const organize = async (
      owner: string,
      id: string,
      collection: string,
      legacy = false,
    ) =>
      ok(owner, (legacy ? 'clips/' : 'v1/text/') + id, 'PATCH', {
        action: 'organize',
        revision: (await row(id))!.revision,
        collection,
      });
    const create = (
      owner: string,
      collection: string,
      id = uuid(),
      legacy = false,
    ) =>
      ok(owner, legacy ? 'clips' : 'v1/text', 'POST', {
        id,
        content: 'body',
        collection,
        clipboardItem: true,
      });
    const backfill = (owner: string, limit = 50) =>
      advanceCollectionBackfill(db, owner, { limit });
    const enable = (owner: string) =>
      db
        .prepare(
          'INSERT INTO preferences(owner,clipboard_daily_cleanup) VALUES (?,1)',
        )
        .bind(owner)
        .run();
    const purge = () =>
      runClipboardCleanup(db, { delete: async () => {} }, Date.now());
    const deletePile = async (owner: string, pile: string, mode = 'pin') => {
      const impact = await ok(owner, `v1/piles/${pile}/deletion-impact`);
      const input = {
        operationId: uuid(),
        revision: impact.pile.revision,
        impactToken: impact.impactToken,
        mode,
        acknowledgeExposure: mode === 'expose',
      };
      return {
        impact,
        input,
        result: await ok(owner, `v1/piles/${pile}`, 'DELETE', input),
      };
    };
    await t.test(
      'pre-P2 inactive Undo restores manual provenance without touching collection or source revision',
      async () => {
        const restored = await member(
          'upgrade',
          'upgrade-pile',
          inactive,
          'restore',
          { undoOperationId: 'old-remove' },
        );
        assert.equal(restored.changed, true);
        const slot = (await slots('upgrade', 'upgrade-pile')).find(
          (x) => x.item_id === inactive,
        )!;
        assert.equal(slot.manual, 1);
        assert.equal(slot.active, 1);
        assert.equal(slot.position, 9);
        assert.equal((await row(inactive))!.revision, 1);
        assert.equal((await row(inactive))!.collection, '');
        const receipt = (await db
          .prepare(
            "SELECT fingerprint,result FROM pile_operations WHERE owner='upgrade' AND operation_id='old-remove'",
          )
          .first())!;
        assert.equal(receipt.fingerprint, 'old-fingerprint');
        assert.equal(
          receipt.result,
          JSON.stringify({ action: 'remove', item: { revision: 1 } }),
        );
      },
    );
    await t.test(
      'exact owner/key identity, Unicode/whitespace/overlength/NUL, display collisions and matching manual piles',
      async () => {
        const keys = [
          'A',
          ' A ',
          'a',
          'é',
          'e\u0301',
          '   ',
          '\t',
          '\0key',
          'x'.repeat(61),
          'x'.repeat(62),
          '',
        ];
        for (const k of keys) await seed('keys', k);
        await seed('keys-other', 'A');
        const manual = (
          await ok('keys', 'v1/piles', 'POST', {
            operationId: uuid(),
            name: 'A',
          })
        ).pile.id;
        assert.equal((await backfill('keys')).processed, keys.length - 1);
        await backfill('keys-other');
        const maps = (
          await db
            .prepare("SELECT * FROM collection_mappings WHERE owner='keys'")
            .all()
        ).results;
        assert.equal(maps.length, keys.length - 1);
        assert.equal(new Set(maps.map((x) => x.pile_id)).size, keys.length - 1);
        assert.notEqual(await mapping('keys', 'A'), manual);
        assert.notEqual(
          await mapping('keys', 'A'),
          await mapping('keys-other', 'A'),
        );
        const p = (await ok('keys', 'v1/piles')).piles;
        assert.equal(
          p.filter((x: { name: string }) => x.name === 'A').length,
          3,
        );
        for (const x of p)
          assert.ok(
            x.name.trim().length > 0 &&
              Array.from(x.name).length <= 60 &&
              !x.name.includes('\0'),
          );
        const original = (
          await db
            .prepare("SELECT * FROM piles WHERE owner='keys' ORDER BY id")
            .all()
        ).results;
        assert.equal((await backfill('keys')).processed, 0);
        assert.deepEqual(
          (
            await db
              .prepare("SELECT * FROM piles WHERE owner='keys' ORDER BY id")
              .all()
          ).results,
          original,
        );
      },
    );
    await t.test(
      'union semantics, provenance-only invalidation, legacy A to B/clear and no-op manual add',
      async () => {
        const o = 'union',
          item = await create(o, 'A'),
          a = (await mapping(o, 'A'))!;
        assert.equal((await slots(o, a))[0].manual, 0);
        const rev = (await ok(o, 'v1/revision')).revision;
        const add = await member(o, a, item.id, 'add');
        assert.equal(add.changed, true);
        assert.ok((await ok(o, 'v1/revision')).revision > rev);
        assert.equal((await member(o, a, item.id, 'add')).changed, false);
        const after = (await ok(o, 'v1/revision')).revision;
        assert.equal((await member(o, a, item.id, 'add')).changed, false);
        assert.equal((await ok(o, 'v1/revision')).revision, after);
        await organize(o, item.id, 'B', true);
        assert.deepEqual(
          (await slots(o, a)).map((x) => [
            x.manual,
            x.collection_key,
            x.active,
          ]),
          [[1, null, 1]],
        );
        const b = (await mapping(o, 'B'))!;
        await organize(o, item.id, '');
        assert.equal((await slots(o, b))[0].active, 0);
        assert.equal((await slots(o, a))[0].active, 1);
        assert.equal((await row(item.id))!.content, 'body');
        assert.deepEqual(
          JSON.parse((await row(item.id))!.versions),
          item.versions,
        );
      },
    );
    await t.test(
      'remove clears legacy field, preserves order, restores provenance; pin stays pinned; stale Undo refuses newer text',
      async () => {
        const o = 'undo',
          first = await create(o, 'A'),
          second = await create(o, 'A'),
          a = (await mapping(o, 'A'))!;
        await member(o, a, first.id, 'add');
        const positions = await slots(o, a);
        const removal = await member(o, a, first.id, 'removeAndPin');
        assert.equal((await row(first.id))!.collection, '');
        assert.equal(removal.item.pinned, true);
        assert.equal((await backfill(o)).processed, 0);
        const undo = await member(o, a, first.id, 'restore', {
          undoOperationId: removal.operationId,
        });
        assert.equal(undo.item.pinned, true);
        assert.equal((await row(first.id))!.collection, 'A');
        assert.deepEqual(
          (await slots(o, a)).map((x) => [x.item_id, x.position]),
          positions.map((x) => [x.item_id, x.position]),
        );
        assert.equal((await slots(o, a))[0].manual, 1);
        const r = await member(o, a, second.id, 'remove');
        await ok(o, 'clips/' + second.id, 'PATCH', {
          action: 'edit',
          content: 'newer',
          revision: (await row(second.id))!.revision,
        });
        const stale = await request(o, `v1/piles/${a}/members`, 'POST', {
          operationId: uuid(),
          revision: (await ok(o, `v1/piles/${a}`)).pile.revision,
          ref: { kind: 'text', id: second.id },
          action: 'restore',
          undoOperationId: r.operationId,
        });
        assert.equal(stale.status, 409);
        assert.equal((await row(second.id))!.collection, '');
        await organize(o, second.id, 'A');
        assert.equal((await slots(o, a))[1].active, 1);
      },
    );
    await t.test(
      'current-row traversal, concurrent retry, interruption rollback, manual moves, and inserts behind old boundary',
      async () => {
        const o = 'resume';
        for (let i = 0; i < 8; i++) await seed(o, 'A', `resume-${i}`);
        const first = await backfill(o, 2);
        assert.equal(first.processed, 2);
        assert.equal(first.pending, 6);
        const a = (await mapping(o, 'A'))!;
        await member(o, a, 'resume-1', 'move', {
          before: { kind: 'text', id: 'resume-0' },
        });
        const moved = (await slots(o, a)).map((x) => x.item_id);
        await db
          .prepare(
            "CREATE TRIGGER p2_fail BEFORE UPDATE OF collection_synced ON clips WHEN NEW.id='resume-3' BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END",
          )
          .run();
        await assert.rejects(backfill(o, 3), /synthetic interruption/);
        assert.equal((await inspectCollectionBackfill(db, o)).pending, 6);
        assert.equal((await row('resume-2'))!.collection_synced, 0);
        await db.prepare('DROP TRIGGER p2_fail').run();
        await seed(o, 'A', 'resume--earlier');
        await db
          .prepare(
            "UPDATE clips SET collection='B',revision=revision+1 WHERE id='resume-5'",
          )
          .run();
        await db.prepare("DELETE FROM clips WHERE id='resume-6'").run();
        await Promise.all([backfill(o, 3), backfill(o, 3), backfill(o, 3)]);
        assert.equal((await inspectCollectionBackfill(db, o)).complete, true);
        assert.deepEqual(
          (await slots(o, a)).slice(0, 2).map((x) => x.item_id),
          moved,
        );
        assert.equal(
          (await slots(o, a)).filter((x) => x.item_id === 'resume-5').length,
          0,
        );
        assert.equal(
          (await slots(o, (await mapping(o, 'B'))!))[0].item_id,
          'resume-5',
        );
        const snapshot = JSON.stringify(await slots(o, a));
        await backfill(o);
        assert.equal(JSON.stringify(await slots(o, a)), snapshot);
      },
    );
    await t.test(
      'all text writes: legacy/v1 create, stale edit, duplicate create/append, import, restore and older Worker SQL',
      async () => {
        const o = 'writers',
          item = await create(o, 'A', uuid(), true),
          a = (await mapping(o, 'A'))!;
        const duplicate = await create(o, 'B', item.id);
        assert.equal(duplicate.collection, 'A');
        assert.equal(await mapping(o, 'B'), undefined);
        const stale = await request(o, 'v1/text/' + item.id, 'PATCH', {
          action: 'organize',
          revision: 99,
          collection: 'B',
        });
        assert.equal(stale.status, 409);
        assert.equal(await mapping(o, 'B'), undefined);
        const append = {
          action: 'append',
          revision: 1,
          content: 'extra',
          segmentId: uuid(),
        };
        await ok(o, 'v1/text/' + item.id, 'PATCH', append);
        const revision = (await ok(o, 'v1/revision')).revision;
        await ok(o, 'clips/' + item.id, 'PATCH', append);
        assert.equal((await ok(o, 'v1/revision')).revision, revision);
        await ok(o, 'clips/' + item.id, 'PATCH', {
          action: 'restore-original',
          revision: (await row(item.id))!.revision,
        });
        assert.equal((await row(item.id))!.collection, 'A');
        await db
          .prepare(
            "UPDATE clips SET collection='Old Worker',revision=revision+1 WHERE id=?",
          )
          .bind(item.id)
          .run();
        assert.equal((await slots(o, a))[0].active, 0);
        assert.ok(await mapping(o, 'Old Worker'));
        const old = await seed(o, 'Old insert');
        assert.equal((await row(old))!.collection_synced, 0);
        assert.equal(
          (await ok(o, 'v1/items/text/' + old)).cleanup.reason,
          'collection_pending',
        );
        await backfill(o);
        const backup = { ...item, id: uuid(), collection: 'Imported' };
        assert.equal(
          (await ok(o, 'import', 'POST', { clip: backup })).imported,
          true,
        );
        assert.equal(
          (await ok(o, 'import', 'POST', { clip: backup })).imported,
          false,
        );
        assert.equal(
          (await slots(o, (await mapping(o, 'Imported'))!)).length,
          1,
        );
      },
    );
    await t.test(
      'mapped rename, suppression, historical replay, explicit later assignments and accurate pending cleanup',
      async () => {
        const o = 'suppression',
          item = await create(o, 'A'),
          a = (await mapping(o, 'A'))!;
        await enable(o);
        await db
          .prepare('UPDATE clips SET created_at=0 WHERE id=?')
          .bind(item.id)
          .run();
        const pending = await seed(o, 'A');
        await ok(o, `v1/piles/${a}`, 'PATCH', {
          operationId: uuid(),
          revision: (await ok(o, `v1/piles/${a}`)).pile.revision,
          name: 'Renamed',
          color: 'mint',
        });
        assert.equal(await mapping(o, 'A'), a);
        const removed = await deletePile(o, a, 'expose');
        assert.equal(removed.impact.exposed.length, 1);
        assert.equal(await mapping(o, 'A'), null);
        assert.equal((await backfill(o)).suppressedPending, 1);
        assert.equal((await backfill(o)).complete, false);
        assert.equal(
          (await ok(o, 'v1/items/text/' + pending)).cleanup.reason,
          'collection_pending',
        );
        await ok(o, 'clips/' + pending, 'PATCH', {
          action: 'rename',
          title: 'Unrelated',
          revision: 1,
        });
        assert.equal(
          (await ok(o, 'v1/items/text/' + pending)).cleanup.reason,
          'collection_pending',
        );
        await purge();
        assert.equal(await row(item.id), null);
        assert.ok(await row(pending));
        assert.equal(
          (await ok(o, `v1/piles/${a}`, 'DELETE', removed.input)).replayed,
          true,
        );
        // Legacy tag-only saves send the unchanged collection too: retain the hold.
        await ok(o, 'clips/' + pending, 'PATCH', {
          action: 'organize',
          revision: (await row(pending))!.revision,
          collection: 'A',
          tags: ['new-tag'],
        });
        assert.equal(await mapping(o, 'A'), null);
        assert.equal(
          (await ok(o, 'v1/items/text/' + pending)).cleanup.reason,
          'collection_pending',
        );
        assert.equal((await backfill(o)).complete, false);
        await organize(o, pending, '');
        assert.equal(
          (await ok(o, 'v1/items/text/' + pending)).cleanup.eligible,
          true,
        );
        assert.equal((await backfill(o)).complete, true);
        const later = await create(o, 'A');
        assert.equal(
          (await ok(o, 'v1/items/text/' + later.id)).piles.length,
          0,
        );
      },
    );
    await t.test(
      'pile capacity, concurrent new keys, blocked progress and recovery preserve original source',
      async () => {
        const o = 'pile-cap';
        await db
          .prepare(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<99) INSERT INTO piles(id,owner,name,updated_at) SELECT 'cap-pile-'||x,?,'Manual',0 FROM n",
          )
          .bind(o)
          .run();
        const ids = [await seed(o, 'A'), await seed(o, 'B')];
        await Promise.all([backfill(o, 1), backfill(o, 1)]);
        const state = await inspectCollectionBackfill(db, o);
        assert.equal(state.pileCapacity, 1);
        assert.equal(state.status, 'blocked');
        const rejected = await request(o, 'v1/text', 'POST', {
          id: uuid(),
          content: 'capacity',
          collection: 'C',
        });
        assert.equal(rejected.status, 201);
        assert.equal(await mapping(o, 'C'), undefined);
        await db
          .prepare("DELETE FROM piles WHERE id IN ('cap-pile-1','cap-pile-3')")
          .run();
        assert.equal((await backfill(o)).complete, true);
        for (const id of ids) assert.equal((await row(id))!.content, 'body');
        const winner = await Promise.all([
          request(o, 'v1/piles', 'POST', {
            operationId: uuid(),
            name: 'No room',
          }),
          request(o, 'v1/text', 'POST', {
            id: uuid(),
            content: 'No room',
            collection: 'D',
          }),
        ]);
        assert.deepEqual(
          winner.map((x) => x.status),
          [409, 201],
        );
        await db.prepare("DELETE FROM piles WHERE id='cap-pile-2'").run();
        await seed(o, 'Final key');
        const [manualRace] = await Promise.all([
          request(o, 'v1/piles', 'POST', {
            operationId: uuid(),
            name: 'Final manual pile',
          }),
          backfill(o),
        ]);
        assert.ok([201, 409].includes(manualRace.status));
        assert.equal(
          (await db
            .prepare('SELECT count(*) n FROM piles WHERE owner=?')
            .bind(o)
            .first())!.n,
          100,
        );
        assert.equal(
          (await inspectCollectionBackfill(db, o)).pending,
          manualRace.status === 201 ? 2 : 1,
        );
      },
    );
    await t.test(
      '500 slots include inactive/manual slots; blocked rows survive cleanup; source deletion frees capacity',
      async () => {
        const o = 'slot-cap',
          initial = await create(o, 'A'),
          a = (await mapping(o, 'A'))!;
        await db
          .prepare(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<499) INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,created_at,updated_at) SELECT 'slot-text-'||x,?,'T','note','c','c','[]','[]',0,0 FROM n",
          )
          .bind(o)
          .run();
        await db
          .prepare(
            "INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation,manual) SELECT ?,?,'text',id,CAST(substr(id,11) AS INTEGER),0,'inactive',0 FROM clips WHERE owner=? AND id LIKE 'slot-text-%'",
          )
          .bind(a, o, o)
          .run();
        const blocked = await seed(o, 'A');
        await enable(o);
        const state = await backfill(o);
        assert.equal(state.memberCapacity, 1);
        assert.equal(state.processed, 0);
        await purge();
        assert.ok(await row(blocked));
        const failed = await request(o, 'v1/text', 'POST', {
          id: uuid(),
          content: 'capacity',
          collection: 'A',
        });
        assert.equal(failed.status, 201);
        // Unchanged collection/tag edits do not activate mapping or lose the hold.
        await organize(o, blocked, 'A');
        assert.equal((await row(blocked))!.collection_synced, 0);
        const candidate = await create(o, '');
        await organize(o, candidate.id, 'A');
        assert.equal((await row(candidate.id))!.collection, 'A');
        assert.equal((await row(candidate.id))!.collection_synced, 0);
        assert.equal(
          (await inspectCollectionBackfill(db, o)).memberCapacity,
          3,
        );
        await db.prepare("DELETE FROM clips WHERE id='slot-text-1'").run();
        assert.equal((await backfill(o)).processed, 1);
        assert.equal((await slots(o, a)).length, 500);
        assert.equal(
          (await slots(o, a)).filter((x) => x.active === 1).length,
          2,
        );
        assert.equal((await row(initial.id))!.collection, 'A');
      },
    );
    // Build capacity from real collection writes, not fabricated member counts.
    const fillCollection = async (
      owner: string,
      key: string,
      count: number,
    ) => {
      await db
        .prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?)
        INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,collection_synced,created_at,updated_at)
        SELECT ?||'-'||printf('%04d',x),?,'Old note','note','body','body','[]','[]',?,1,0,0 FROM n`)
        .bind(count, owner, owner, key)
        .run();
      return (await mapping(owner, key))!;
    };
    await t.test(
      'B1 restore crosses exhausted collection slots and keeps every later source, with safe whole-file retry',
      async () => {
        const o = 'restore-cap',
          pile = await fillCollection(o, 'Inbox', 500);
        await db
          .prepare(
            "UPDATE clips SET collection='',revision=revision+1 WHERE owner=?",
          )
          .bind(o)
          .run();
        assert.equal((await slots(o, pile)).length, 500);
        assert.equal((await slots(o, pile)).filter((x) => x.active).length, 0);
        const originalSlots = await slots(o, pile);
        const native = await create(o, 'Inbox'),
          legacy = await create(o, 'Inbox', uuid(), true);
        for (const id of [native.id, legacy.id]) {
          assert.equal((await row(id))!.collection_synced, 0);
          assert.equal(
            (await ok(o, 'v1/items/text/' + id)).cleanup.reason,
            'collection_pending',
          );
        }
        const backup = parseBackup({
          app: 'DO',
          version: 1,
          clips: ['Other', 'Inbox', '', 'Other'].map((collection, i) =>
            newClip(
              {
                id: uuid(),
                collection,
                content: 'Restored body ' + i,
                title: 'Restored ' + i,
                tags: ['backup'],
              },
              1000,
            ),
          ),
        });
        let restored = 0;
        // Same bounded, sequential import request loop as workspace.restoreBackup.
        for (const clip of backup)
          if ((await ok(o, 'import', 'POST', { clip })).imported) restored++;
        assert.equal(restored, 4);
        for (const clip of backup) {
          const id = await importedId(o, clip.id),
            saved = await ok(o, 'clips/' + id);
          assert.deepEqual(saved, { ...clip, id, revision: 1 });
        }
        const blockedId = await importedId(o, backup[1].id);
        assert.equal((await row(blockedId))!.collection_synced, 0);
        assert.equal(
          (await inspectCollectionBackfill(db, o)).memberCapacity,
          3,
        );
        const revision = (await ok(o, 'v1/revision')).revision;
        for (const clip of backup)
          assert.equal(
            (await ok(o, 'import', 'POST', { clip })).imported,
            false,
          );
        assert.equal((await ok(o, 'v1/revision')).revision, revision);
        assert.deepEqual(await slots(o, pile), originalSlots);
        // Cleanup cannot delete an old pending capture; imports retain their ordinary legacy exemption too.
        await enable(o);
        await db
          .prepare('UPDATE clips SET created_at=0 WHERE id IN (?,?)')
          .bind(native.id, legacy.id)
          .run();
        await purge();
        for (const id of [native.id, legacy.id, blockedId])
          assert.ok(await row(id));
        assert.equal((await backfill(o)).processed, 0);
        // Explicit source deletion, not merely reassignment, frees a retained slot.
        await ok(o, 'clips/' + o + '-0001', 'DELETE', { revision: 2 });
        const resumed = await backfill(o);
        assert.equal(resumed.processed, 1);
        assert.equal(resumed.memberCapacity, 2);
        assert.equal((await slots(o, pile)).length, 500);
      },
    );
    await t.test(
      'B1 100 empty mapped piles do not prevent new collections, imports or later unfiled restore rows',
      async () => {
        const o = 'empty-maps';
        await db
          .prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100)
        INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,collection_synced,created_at,updated_at)
        SELECT 'empty-map-source-'||x,?,'Old','note','body','body','[]','[]','Key '||x,1,0,0 FROM n`)
          .bind(o)
          .run();
        await db.prepare('DELETE FROM clips WHERE owner=?').bind(o).run();
        assert.equal((await inspectCollectionBackfill(db, o)).mappedKeys, 100);
        const sources = await Promise.all([
          create(o, 'New key'),
          create(o, 'Newer key', uuid(), true),
        ]);
        const backup = [
          newClip({
            id: uuid(),
            content: 'capacity import',
            collection: 'Import key',
          }),
          newClip({ id: uuid(), content: 'later unfiled' }),
        ];
        for (const clip of backup)
          assert.equal(
            (await ok(o, 'import', 'POST', { clip })).imported,
            true,
          );
        for (const source of sources)
          assert.equal((await row(source.id))!.collection_synced, 0);
        const state = await backfill(o);
        assert.equal(state.pileCapacity, 3);
        assert.equal(state.complete, false);
        assert.equal(state.mappedKeys, 100);
        assert.equal(await mapping(o, 'New key'), undefined);
        assert.ok(await row(await importedId(o, backup[1].id)));
        assert.equal(
          (
            await request(o, 'v1/piles', 'POST', {
              operationId: uuid(),
              name: 'Still full',
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      'B1 moving to a full collection removes only old collection provenance and rolls back on real SQL failure',
      async () => {
        const o = 'move-full',
          full = await fillCollection(o, 'Full', 500),
          item = await create(o, 'Old'),
          old = (await mapping(o, 'Old'))!;
        await member(o, old, item.id, 'add');
        const prior = await row(item.id),
          priorSlots = await slots(o, old),
          priorFull = await slots(o, full),
          revision = (await ok(o, 'v1/revision')).revision;
        await db
          .prepare(`CREATE TRIGGER fail_pending_write BEFORE UPDATE OF collection_synced ON clips
        WHEN NEW.owner='move-full' AND NEW.collection_synced=0 BEGIN SELECT RAISE(ABORT,'synthetic pending failure'); END`)
          .run();
        const failed = await request(o, 'clips/' + item.id, 'PATCH', {
          action: 'organize',
          collection: 'Full',
          revision: item.revision,
        });
        assert.equal(failed.status, 500);
        assert.deepEqual(await row(item.id), prior);
        assert.deepEqual(await slots(o, old), priorSlots);
        assert.deepEqual(await slots(o, full), priorFull);
        assert.equal((await ok(o, 'v1/revision')).revision, revision);
        await db.prepare('DROP TRIGGER fail_pending_write').run();
        await organize(o, item.id, 'Full', true);
        assert.equal((await row(item.id))!.collection_synced, 0);
        assert.deepEqual(
          (await slots(o, old)).map((x) => [
            x.manual,
            x.collection_key,
            x.active,
          ]),
          [[1, null, 1]],
        );
        assert.deepEqual(await slots(o, full), priorFull);
        // Source CAS and duplicate create still reject/replay without an accidental mapping attempt.
        assert.equal(
          (
            await request(o, 'v1/text/' + item.id, 'PATCH', {
              action: 'organize',
              collection: 'Fresh',
              revision: item.revision,
            })
          ).status,
          409,
        );
        assert.equal(await mapping(o, 'Fresh'), undefined);
        assert.equal((await create(o, 'Fresh', item.id)).collection, 'Full');
        await organize(o, item.id, '');
        assert.equal((await row(item.id))!.collection_synced, 1);
        assert.equal((await slots(o, full)).length, 500);
        assert.equal((await slots(o, old))[0].active, 1);
      },
    );
    await t.test(
      'B1 later moves reconcile pending sources and same-key saves keep the cleanup hold',
      async () => {
        const o = 'pending-moves',
          full = await fillCollection(o, 'Full', 500),
          item = await create(o, 'Full');
        assert.equal((await row(item.id))!.collection_synced, 0);
        await ok(o, 'clips/' + item.id, 'PATCH', {
          action: 'organize',
          collection: 'Full',
          tags: ['edited'],
          revision: 1,
        });
        assert.equal((await row(item.id))!.collection_synced, 0);
        await organize(o, item.id, 'Available');
        const available = (await mapping(o, 'Available'))!;
        assert.equal((await row(item.id))!.collection_synced, 1);
        assert.equal((await slots(o, available)).length, 1);
        await organize(o, item.id, 'Full');
        assert.equal((await row(item.id))!.collection_synced, 0);
        assert.equal((await slots(o, available))[0].active, 0);
        assert.equal((await slots(o, full)).length, 500);
        await enable(o);
        await db
          .prepare('UPDATE clips SET created_at=0 WHERE id=?')
          .bind(item.id)
          .run();
        await purge();
        assert.ok(await row(item.id));
        assert.equal(
          (await ok(o, 'v1/items/text/' + item.id)).cleanup.reason,
          'collection_pending',
        );
      },
    );
    await t.test(
      'Remove and Undo round-trip NUL and Unicode exact keys through the capacity-aware trigger',
      async () => {
        for (const key of ['nul\0key', 'e\u0301🗂']) {
          const o = 'unusual-undo',
            item = await create(o, key),
            pile = (await mapping(o, key))!;
          const removed = await member(o, pile, item.id, 'removeAndPin');
          assert.equal((await row(item.id))!.collection, '');
          await member(o, pile, item.id, 'restore', {
            undoOperationId: removed.operationId,
          });
          assert.equal((await row(item.id))!.collection, key);
          assert.equal((await row(item.id))!.pinned, 1);
          assert.equal((await slots(o, pile))[0].collection_key, key);
          assert.equal((await row(item.id))!.collection_synced, 1);
        }
      },
    );
    await t.test(
      'O2 tag-only organize preserves exact historical identity and pending holds on both routes',
      async () => {
        const o = 'exact-tag-edit';
        for (const key of [
          '  Inbox  ',
          ' '.repeat(4),
          'x'.repeat(80),
          'e\u0301🗂',
        ]) {
          const id = await seed(o, key);
          for (const path of ['clips/', 'v1/text/']) {
            const before = (await row(id))!;
            await ok(o, path + id, 'PATCH', {
              action: 'organize',
              revision: before.revision,
              collection: key,
              tags: ['updated'],
            });
            assert.equal((await row(id))!.collection, key);
            assert.equal((await row(id))!.collection_synced, 0);
            assert.equal(await mapping(o, key), undefined);
            assert.equal(
              (await ok(o, 'v1/items/text/' + id)).cleanup.reason,
              'collection_pending',
            );
          }
          await backfill(o);
          const pile = (await mapping(o, key))!,
            originalSlots = await slots(o, pile);
          await organize(o, id, key, true);
          assert.equal((await row(id))!.collection, key);
          assert.deepEqual(await slots(o, pile), originalSlots);
          // A deliberate changed input still follows the existing new-key rules.
          await organize(o, id, '  Changed  ');
          assert.equal((await row(id))!.collection, 'Changed');
          assert.ok(await mapping(o, 'Changed'));
        }
      },
    );
    const beforeBatch = (effect: () => Promise<unknown>, ordinal = 1) => {
      let calls = 0;
      return new Proxy(db, {
        get(target, prop) {
          if (prop === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              if (++calls === ordinal) await effect();
              return target.batch(statements);
            };
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    await t.test(
      'transaction-time source edits, deletes and imports are reconciled without stale assignments',
      async () => {
        const o = 'moving',
          edited = await seed(o, 'Old'),
          deleted = await seed(o, 'Old');
        const proxy = beforeBatch(async () => {
          await organize(o, edited, 'New');
          await db.prepare('DELETE FROM clips WHERE id=?').bind(deleted).run();
          await ok(o, 'import', 'POST', {
            clip: newClip({
              id: uuid(),
              content: 'body',
              collection: 'Imported',
            }),
          });
          await seed(o, 'Behind', 'moving--before');
        });
        const result = await advanceCollectionBackfill(proxy, o, { limit: 50 });
        assert.equal(result.complete, true);
        assert.equal(result.processed, 1);
        assert.equal(await mapping(o, 'Old'), undefined);
        assert.ok(await mapping(o, 'New'));
        assert.ok(await mapping(o, 'Imported'));
        assert.ok(await mapping(o, 'Behind'));
        assert.equal(await row(deleted), null);
      },
    );
    await t.test(
      'source CAS, receipt rollback, replay and provenance-only confirmation invalidation',
      async () => {
        const o = 'cas',
          item = await create(o, 'A'),
          a = (await mapping(o, 'A'))!;
        await enable(o);
        await db
          .prepare('UPDATE pile_members SET position=9 WHERE pile_id=?')
          .bind(a)
          .run();
        const impact = await ok(o, `v1/piles/${a}/deletion-impact`);
        await member(o, a, item.id, 'add');
        assert.equal((await slots(o, a))[0].position, 9);
        await assert.rejects(
          deletePileDirect(db, o, a, {
            operationId: uuid(),
            revision: impact.pile.revision,
            impactToken: impact.impactToken,
            mode: 'pin',
          }),
          { code: 'impact_stale' },
        );
        const remove = {
          operationId: uuid(),
          revision: (await ok(o, `v1/piles/${a}`)).pile.revision,
          ref: { kind: 'text', id: item.id },
          action: 'removeAndPin',
        };
        await assert.rejects(
          writePileMember(
            beforeBatch(
              () =>
                db
                  .prepare(
                    "UPDATE clips SET content='newer',revision=revision+1 WHERE id=?",
                  )
                  .bind(item.id)
                  .run(),
              2,
            ),
            o,
            a,
            remove,
          ),
          { code: 'revision_conflict' },
        );
        assert.equal((await row(item.id))!.collection, 'A');
        assert.equal((await row(item.id))!.pinned, 0);
        await db
          .prepare(
            `CREATE TRIGGER p2_receipt_fail BEFORE INSERT ON pile_operations WHEN NEW.owner='cas' BEGIN SELECT RAISE(ABORT,'receipt failure'); END`,
          )
          .run();
        const before = JSON.stringify(await row(item.id)),
          beforeSlots = JSON.stringify(await slots(o, a)),
          revision = (await ok(o, 'v1/revision')).revision;
        await assert.rejects(
          writePileMember(db, o, a, remove),
          /receipt failure/,
        );
        assert.equal(JSON.stringify(await row(item.id)), before);
        assert.equal(JSON.stringify(await slots(o, a)), beforeSlots);
        assert.equal((await ok(o, 'v1/revision')).revision, revision);
        await db.prepare('DROP TRIGGER p2_receipt_fail').run();
        const removed = await writePileMember(db, o, a, remove);
        const restore = {
          operationId: uuid(),
          revision: removed.pileRevision,
          ref: { kind: 'text', id: item.id },
          action: 'restore',
          undoOperationId: remove.operationId,
        };
        await assert.rejects(
          writePileMember(
            beforeBatch(
              () =>
                db
                  .prepare(
                    "UPDATE clips SET title='newer',revision=revision+1 WHERE id=?",
                  )
                  .bind(item.id)
                  .run(),
              2,
            ),
            o,
            a,
            restore,
          ),
          { code: 'revision_conflict' },
        );
        await organize(o, item.id, 'A');
        const replay = await writePileMember(db, o, a, remove);
        assert.deepEqual({ ...replay, replayed: false }, removed);
        assert.equal((await row(item.id))!.collection, 'A');
      },
    );
    await t.test(
      'cleanup racing mapping, reassignment, remove-and-pin, Undo and safe pile deletion',
      async () => {
        const o = 'cleanup-race',
          id = await seed(o, 'A');
        await enable(o);
        await Promise.all([backfill(o), purge()]);
        assert.ok(await row(id));
        const a = (await mapping(o, 'A'))!;
        await Promise.all([organize(o, id, 'B'), purge()]);
        assert.ok(await row(id));
        const b = (await mapping(o, 'B'))!;
        const [removed] = await Promise.all([
          member(o, b, id, 'removeAndPin'),
          purge(),
        ]);
        await Promise.all([
          member(o, b, id, 'restore', { undoOperationId: removed.operationId }),
          purge(),
        ]);
        assert.ok(await row(id));
        await deletePile(o, a);
        await Promise.all([deletePile(o, b), purge()]);
        assert.ok(await row(id));
        assert.equal((await row(id))!.pinned, 1);
        // A collection added to an initial selection is still manual in that separate pile.
        const c = await create(o, 'C');
        const manual = (
          await ok(o, 'v1/piles', 'POST', {
            operationId: uuid(),
            name: 'Selection',
            members: [{ kind: 'text', id: c.id }],
          })
        ).pile.id;
        await organize(o, c.id, '');
        assert.equal(
          (await slots(o, manual))[0].manual ??
            (await slots(o, manual))[0].active,
          1,
        );
      },
    );
    await t.test(
      'more than 500 collection texts remain explicitly blocked without slot compaction',
      async () => {
        const o = 'large';
        await db
          .prepare(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<502) INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,clipboard_item,created_at,updated_at) SELECT 'large-text-'||printf('%04d',x),?,'T','note','body','original','[]','[]','A',1,0,0 FROM n",
          )
          .bind(o)
          .run();
        for (let i = 0; i < 10; i++)
          assert.equal((await backfill(o)).processed, 50);
        const result = await backfill(o);
        assert.equal(result.memberCapacity, 2);
        assert.equal(result.complete, false);
        const a = (await mapping(o, 'A'))!;
        assert.equal((await slots(o, a)).length, 500);
        await enable(o);
        await purge();
        assert.equal((await inspectCollectionBackfill(db, o)).pending, 2);
        const safe = await deletePile(o, a);
        assert.equal(
          (safe.result as unknown as { pinned: unknown[] }).pinned.length,
          500,
        );
        await purge();
        assert.equal(
          (await db
            .prepare('SELECT count(*) n FROM clips WHERE owner=?')
            .bind(o)
            .first())!.n,
          502,
        );
        const held = await inspectCollectionBackfill(db, o);
        assert.equal(held.suppressedPending, 2);
        assert.equal(held.complete, false);
        assert.equal(
          (await ok(o, 'v1/items/text/large-text-0501')).cleanup.reason,
          'collection_pending',
        );
      },
    );
    await t.test(
      'manual adds and mapping serialize at the final member slot',
      async () => {
        const o = 'slot-race',
          first = await create(o, 'A'),
          a = (await mapping(o, 'A'))!;
        await db
          .prepare(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<498) INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,created_at,updated_at) SELECT 'race-slot-'||x,?,'T','note','c','c','[]','[]',0,0 FROM n",
          )
          .bind(o)
          .run();
        await db
          .prepare(
            "INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation,manual) SELECT ?,?,'text',id,CAST(substr(id,11) AS INTEGER),0,'inactive',0 FROM clips WHERE owner=? AND id LIKE 'race-slot-%'",
          )
          .bind(a, o, o)
          .run();
        const pending = await seed(o, 'A'),
          manual = await create(o, '');
        const [add] = await Promise.all([
          request(o, `v1/piles/${a}/members`, 'POST', {
            operationId: uuid(),
            revision: (await ok(o, `v1/piles/${a}`)).pile.revision,
            ref: { kind: 'text', id: manual.id },
            action: 'add',
          }),
          backfill(o),
        ]);
        assert.ok([200, 409].includes(add.status));
        assert.equal((await slots(o, a)).length, 500);
        if (add.status === 200) {
          assert.equal((await row(pending))!.collection_synced, 0);
          await db
            .prepare('DELETE FROM clips WHERE id=?')
            .bind(manual.id)
            .run();
          await backfill(o);
        }
        assert.equal((await row(pending))!.collection_synced, 1);
        assert.equal((await row(first.id))!.collection, 'A');
      },
    );
    await t.test(
      'Origin, native parity, bounds, owner isolation and erasure-race guards',
      async () => {
        const o = 'auth';
        await seed(o, 'A');
        assert.equal(
          (
            await request(
              o,
              'v1/collection-backfill',
              'POST',
              {},
              'session',
              'https://evil.test',
            )
          ).status,
          403,
        );
        assert.equal(
          (await request(o, 'v1/collection-backfill', 'POST', {}, 'bearer', ''))
            .status,
          200,
        );
        assert.equal(
          (await ok('other', 'v1/collection-backfill')).mappedKeys,
          0,
        );
        for (const input of [
          { limit: null },
          { limit: 0 },
          { limit: 51 },
          { limit: 1.5 },
          { limit: '1' },
          { owner: o },
        ])
          assert.equal(
            (await request(o, 'v1/collection-backfill', 'POST', input)).status,
            400,
          );
        await db
          .prepare(
            "INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES ('p2-racing-account','Synthetic','p2-race@example.test',1,0,0)",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO auth_legacy_owner VALUES ('p2-racing-account','p2-racing-owner')",
          )
          .run();
        await seed('p2-racing-owner', 'Before erase');
        await assert.rejects(
          advanceCollectionBackfill(
            beforeBatch(async () => {
              await db.batch([
                ...[
                  'clips',
                  'piles',
                  'collection_mappings',
                  'pile_operations',
                  'item_deletions',
                  'workspace_revision',
                ].map((table) =>
                  db.prepare(
                    `DELETE FROM ${table} WHERE owner='p2-racing-owner'`,
                  ),
                ),
                db.prepare(
                  "DELETE FROM auth_user WHERE id='p2-racing-account'",
                ),
              ]);
            }),
            'p2-racing-owner',
            { limit: 50 },
            'p2-racing-account',
          ),
          { status: 401 },
        );
        for (const table of [
          'clips',
          'piles',
          'collection_mappings',
          'pile_operations',
          'item_deletions',
          'workspace_revision',
        ])
          assert.equal(
            (await db
              .prepare(
                `SELECT count(*) n FROM ${table} WHERE owner='p2-racing-owner'`,
              )
              .first())!.n,
            0,
            table,
          );
        const guardOwner = 'erased-legacy',
          id = await seed(guardOwner, 'A');
        assert.equal(
          (
            await request(
              guardOwner,
              'v1/collection-backfill',
              'POST',
              {},
              'bearer',
              '',
              'deleted-account',
            )
          ).status,
          401,
        );
        assert.equal((await row(id))!.collection_synced, 0);
        const candidate = newClip({
          id: uuid(),
          content: 'late',
          collection: 'B',
        });
        await assert.rejects(
          insertClip(db, guardOwner, candidate, true, 'deleted-account'),
        );
        assert.equal(await mapping(guardOwner, 'B'), undefined);
        assert.equal(await row(candidate.id), null);
        // Simulate P1 erasure after a populated P2 mapping: suppression remains until guarded reconciliation.
        await backfill(guardOwner);
        await db.batch(
          [
            'clips',
            'piles',
            'pile_operations',
            'item_deletions',
            'workspace_revision',
          ].map((table) =>
            db.prepare(`DELETE FROM ${table} WHERE owner=?`).bind(guardOwner),
          ),
        );
        assert.equal(await mapping(guardOwner, 'A'), null);
        const plan = reconciliationPlan([
          { accountId: 'deleted-account', owner: guardOwner },
        ]);
        for (const sql of plan.statements.slice(0, 2))
          await db.prepare(sql).run();
        for (const sql of plan.statements) await db.prepare(sql).run();
        for (const sql of plan.statements) await db.prepare(sql).run();
        const audit = (await db.prepare(plan.audit).first())!;
        for (const [key, value] of Object.entries(audit))
          if (!['accountId', 'owner', 'eligible'].includes(key))
            assert.equal(value, 0, key);
        assert.ok(await mapping(o, 'A'));
      },
    );
  } finally {
    await mf.dispose();
  }
});
