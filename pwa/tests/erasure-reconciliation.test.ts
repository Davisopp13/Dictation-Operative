import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import {
  reconciliationPlan,
  parseOwnerSnapshot,
  RECONCILIATION_SQL_BYTE_LIMIT,
  type OwnerSnapshot,
} from '../lib/erasure-reconciliation';

void test('reconciliation plans bound and safely quote reviewed raw identities', () => {
  for (const invalid of [
    null,
    [],
    Array(101).fill({ accountId: 'a', owner: 'b' }),
    [{ accountId: 'a', owner: '' }],
    [{ accountId: 'a', owner: 'b\n' }],
    [
      { accountId: 'a', owner: 'b' },
      { accountId: 'c', owner: 'b' },
    ],
  ])
    assert.throws(() => reconciliationPlan(invalid));
  const plan = reconciliationPlan([
    { accountId: "account'one", owner: "owner'); DELETE FROM auth_user; --" },
  ]);
  assert.match(plan.audit, /account''one/);
  assert.match(plan.audit, /owner''\); DELETE FROM auth_user; --/);
  assert.equal(plan.statements.length, 6);
  assert.match(plan.statements.at(-1)!, /DELETE FROM workspace_revision/);
});

void test('snapshot parser accepts the direct query envelope and original plain pairs', () => {
  const pairs = [
    { accountId: 'synthetic-account', owner: 'synthetic-legacy-owner' },
  ];
  const query = [
    {
      results: pairs,
      success: true,
      meta: {
        duration: 0.4,
        rows_read: 2,
        rows_written: 0,
        served_by: 'synthetic-d1',
      },
    },
  ];
  assert.deepEqual(parseOwnerSnapshot(query), pairs);
  assert.deepEqual(reconciliationPlan(query), reconciliationPlan(pairs));
});

void test('snapshot parser rejects import summaries and malformed envelopes or rows', () => {
  const pair = { accountId: 'account-one', owner: 'owner-one' };
  const envelope = { results: [pair], success: true, meta: { duration: 0.1 } };
  const summary = {
    'Total queries executed': 1,
    'Rows read': 2,
    'Rows written': 0,
    'Database size (MB)': '0.02',
  };
  for (const input of [
    [
      {
        results: [summary],
        success: true,
        meta: {},
        finalBookmark: 'synthetic',
      },
    ],
    [summary],
  ])
    assert.throws(
      () => reconciliationPlan(input),
      /import summary.*--command rather than --file/,
    );
  for (const input of [
    { results: [pair], success: true, meta: {} },
    [envelope, envelope],
    [{ ...envelope, success: false }],
    [{ ...envelope, success: 'true' }],
    [{ results: [pair], success: true }],
    [{ ...envelope, extra: 'not accepted' }],
    [{ ...envelope, meta: null }],
    [{ ...envelope, meta: [] }],
    [{ ...envelope, results: pair }],
    [{ ...envelope, results: [] }],
    [{ ...envelope, results: [{ accountId: 'account-one' }] }],
    [{ ...envelope, results: [{ ...pair, extra: 'not accepted' }] }],
    [{ ...envelope, results: [null] }],
    [{ ...envelope, results: [[pair]] }],
    [{ accountId: 'account-one' }],
    [{ ...pair, extra: 'not accepted' }],
  ])
    assert.throws(() => reconciliationPlan(input));
});

void test('UTF-8 byte guards bound each statement and complete file before writing', () => {
  const ordinary = Array.from({ length: 100 }, (_, i) => ({
    accountId: String(i).padStart(36, 'a'),
    owner: String(i).padStart(36, 'o'),
  }));
  const plan = reconciliationPlan(ordinary),
    bytes = (sql: string) => new TextEncoder().encode(sql).byteLength;
  for (const sql of [
    plan.audit,
    ...plan.statements,
    plan.auditFile,
    plan.applyFile,
  ])
    assert.ok(bytes(sql) < RECONCILIATION_SQL_BYTE_LIMIT);
  // All pairs meet the row limits; their generated SQL is too big. Exercise
  // ASCII, quote doubling, and multi-byte UTF-8 rather than string.length.
  for (const character of ['a', "'", '界']) {
    const maximum = Array.from({ length: 100 }, (_, i) => ({
      accountId: character.repeat(512),
      owner: character.repeat(509) + String(i).padStart(3, '0'),
    }));
    assert.equal(parseOwnerSnapshot(maximum).length, 100);
    assert.throws(
      () => reconciliationPlan(maximum),
      /SQL statement 1.*90000-byte.*smaller disjoint batches/,
    );
  }
  // Individual statements fit; their five-statement apply file does not.
  const fileTooBig = Array.from({ length: 50 }, (_, i) => ({
    accountId: 'a'.repeat(200),
    owner: 'o'.repeat(197) + String(i).padStart(3, '0'),
  }));
  assert.throws(
    () => reconciliationPlan(fileTooBig),
    /Apply output file.*90000-byte/,
  );
});

void test('old Worker erasure on 0011 reconciles safely and repeatably, including mapped owners', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
  });
  try {
    const db = await mf.getD1Database('DB');
    const migrate = async (file: string) => {
      for (const sql of readFileSync(
        new URL('../drizzle/' + file, import.meta.url),
        'utf8',
      ).split('--> statement-breakpoint'))
        if (sql.trim()) await db.prepare(sql).run();
    };
    for (const file of readdirSync(new URL('../drizzle/', import.meta.url))
      .filter((f) => f.endsWith('.sql') && f < '0009')
      .sort())
      await migrate(file);
    const user = async (accountId: string, owner = accountId) => {
      await db
        .prepare(
          'INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,0,0)',
        )
        .bind(accountId, accountId, accountId + '@example.test')
        .run();
      if (owner !== accountId)
        await db
          .prepare('INSERT INTO auth_legacy_owner(user_id,owner) VALUES (?,?)')
          .bind(accountId, owner)
          .run();
    };
    await user('deleted-direct');
    await user('deleted-linked', 'legacy-deleted');
    await user('live-direct');
    await user('live-linked', 'legacy-live');
    await user('incomplete-delete');
    await user("deleted'quoted", "legacy'quoted");
    const snapshot = (
      await db
        .prepare(
          readFileSync(
            new URL(
              '../maintenance/account-owner-snapshot.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        )
        .all<OwnerSnapshot>()
    ).results;
    assert.ok(
      snapshot.some(
        (x) => x.accountId === 'deleted-linked' && x.owner === 'legacy-deleted',
      ),
    );
    await migrate('0009_shared_items.sql');
    await migrate('0010_pile_created_at.sql');
    await migrate('0011_collection_mapping.sql');
    const seed = async (owner: string) => {
      await db
        .prepare(
          "INSERT INTO collection_mappings VALUES (?,'Private suppressed collection',NULL)",
        )
        .bind(owner)
        .run();
      await db
        .prepare(
          "INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,created_at,updated_at) VALUES (?,?,'Private','note','content','original','[]','[]',0,0)",
        )
        .bind('clip-' + owner, owner)
        .run();
      await db
        .prepare(
          "INSERT INTO clipboard_images(id,owner,name,object_key,size,width,height,created_at) VALUES (?,?,'Image',?,1,1,1,0)",
        )
        .bind('image-' + owner, owner, 'old-image/' + owner)
        .run();
      await db
        .prepare(
          "INSERT INTO content_items(id,owner,kind,name,object_key,size,created_at,state) VALUES (?,?,'file','Document',?,1,0,'ready')",
        )
        .bind('document-' + owner, owner, 'old-document/' + owner)
        .run();
      await db
        .prepare('INSERT INTO piles(id,owner,name,updated_at) VALUES (?,?,?,0)')
        .bind('pile-' + owner, owner, 'Private pile ' + owner)
        .run();
      await db
        .prepare(
          "INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation) VALUES (?,?,'text',?,0,1,'op-seed')",
        )
        .bind('pile-' + owner, owner, 'clip-' + owner)
        .run();
      await db
        .prepare("INSERT INTO pile_operations VALUES (?,'op-seed',?,'{}',?)")
        .bind(
          owner,
          'pile-' + owner,
          JSON.stringify({ piles: [{ name: 'Private pile ' + owner }] }),
        )
        .run();
    };
    for (const owner of [
      ...snapshot.map((x) => x.owner),
      'unclaimed-access',
      'local_dev',
    ])
      await seed(owner);
    // Live and unclaimed owners with only F2 metadata must also survive; source
    // guards alone would not protect them. Direct deletion models pre-pile rollout.
    for (const owner of [
      'live-direct',
      'legacy-live',
      'unclaimed-access',
      'local_dev',
    ])
      for (const table of ['clips', 'clipboard_images', 'content_items'])
        await db
          .prepare(`DELETE FROM ${table} WHERE owner=?`)
          .bind(owner)
          .run();
    await db.prepare("DELETE FROM piles WHERE owner='deleted-direct'").run();
    await db
      .prepare("DELETE FROM pile_operations WHERE owner='deleted-direct'")
      .run();
    // Exact ordered batch from base 0967509 lib/account-deletion.ts. In particular
    // the legacy mapping goes before auth_user, and no F2 tables are cleared.
    const eraseOld = async (accountId: string, owner: string) => {
      const remove = (sql: string, ...args: string[]) =>
        db.prepare(sql).bind(...args);
      await db.batch([
        remove('DELETE FROM clips WHERE owner=?', owner),
        remove('DELETE FROM clipboard_images WHERE owner=?', owner),
        remove('DELETE FROM content_items WHERE owner=?', owner),
        remove('DELETE FROM preferences WHERE owner=?', owner),
        remove('DELETE FROM workspace_tools WHERE owner=?', owner),
        remove('DELETE FROM usage WHERE owner=?', owner),
        remove('DELETE FROM shared_ai_usage WHERE key=?', `user:${owner}`),
        remove('DELETE FROM workspace_revision WHERE owner=?', owner),
        remove('DELETE FROM auth_session WHERE user_id=?', accountId),
        remove('DELETE FROM auth_account WHERE user_id=?', accountId),
        remove('DELETE FROM auth_legacy_owner WHERE user_id=?', accountId),
        remove(
          'DELETE FROM auth_verification WHERE identifier=?',
          accountId + '@example.test',
        ),
        remove(
          'DELETE FROM auth_throttle WHERE key IN (?,?)',
          `account-deletion:${accountId}`,
          `password-setup:${accountId}`,
        ),
        remove('DELETE FROM auth_user WHERE id=?', accountId),
      ]);
    };
    for (const pair of snapshot.filter((x) =>
      x.accountId.startsWith('deleted'),
    ))
      await eraseOld(pair.accountId, pair.owner);
    await db
      .prepare("DELETE FROM auth_user WHERE id='incomplete-delete'")
      .run();
    const count = async (table: string, owner: string) =>
      (await db
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE owner=?`)
        .bind(owner)
        .first<{ n: number }>())!.n;
    assert.equal(await count('item_deletions', 'deleted-direct'), 3);
    assert.equal(await count('piles', 'legacy-deleted'), 1);
    assert.equal(await count('pile_operations', 'legacy-deleted'), 1);
    assert.equal(await count('workspace_revision', 'legacy-deleted'), 0);
    const protectedState = async () => {
      const result: Record<string, unknown> = {};
      for (const table of [
        'auth_user',
        'auth_legacy_owner',
        'clips',
        'clipboard_images',
        'content_items',
        'piles',
        'pile_members',
        'collection_mappings',
        'pile_operations',
        'item_deletions',
        'workspace_revision',
      ])
        result[table] = (
          await db
            .prepare(
              `SELECT * FROM ${table} ${table.startsWith('auth_') ? '' : "WHERE owner IN ('live-direct','legacy-live','unclaimed-access','local_dev','incomplete-delete')"} ORDER BY 1`,
            )
            .all()
        ).results;
      return result;
    };
    const before = await protectedState();
    const queues = async () => ({
      images: (
        await db
          .prepare(
            'SELECT * FROM clipboard_image_deletion_queue ORDER BY object_key',
          )
          .all()
      ).results,
      documents: (
        await db
          .prepare('SELECT * FROM content_deletion_queue ORDER BY object_key')
          .all()
      ).results,
    });
    const queuedBefore = await queues(),
      plan = reconciliationPlan([
        {
          results: snapshot,
          success: true,
          meta: { duration: 0.1, rows_read: snapshot.length, rows_written: 0 },
        },
      ]);
    const audit = await db
      .prepare(plan.audit)
      .all<{ owner: string; eligible: number }>();
    assert.equal(
      audit.results.find((x) => x.owner === 'legacy-deleted')?.eligible,
      1,
    );
    for (const owner of ['live-direct', 'legacy-live', 'incomplete-delete'])
      assert.equal(audit.results.find((x) => x.owner === owner)?.eligible, 0);
    assert.ok(!audit.results.some((x) => x.owner === 'unclaimed-access'));
    for (const owner of ['live-direct', 'legacy-live']) {
      const stale = reconciliationPlan([
        { accountId: 'formerly-linked-account', owner },
      ]);
      assert.equal(
        (await db.prepare(stale.audit).first<{ eligible: number }>())?.eligible,
        0,
      );
      for (const statement of stale.statements)
        await db.prepare(statement).run();
    }
    assert.deepEqual(await protectedState(), before);
    // Interruption after piles re-creates a revision; the complete rerun clears it.
    await db.prepare(plan.statements[0]).run();
    assert.equal(await count('workspace_revision', 'legacy-deleted'), 1);
    assert.equal(await count('pile_operations', 'legacy-deleted'), 1);
    for (const statement of plan.statements) await db.prepare(statement).run();
    for (const pair of snapshot.filter((x) =>
      x.accountId.startsWith('deleted'),
    ))
      for (const table of [
        'piles',
        'pile_members',
        'collection_mappings',
        'pile_operations',
        'item_deletions',
        'workspace_revision',
      ])
        assert.equal(
          await count(table, pair.owner),
          0,
          `${table}: ${pair.owner}`,
        );
    assert.deepEqual(await protectedState(), before);
    assert.deepEqual(await queues(), queuedBefore);
    for (const statement of plan.statements) await db.prepare(statement).run();
    assert.deepEqual(await protectedState(), before);
    assert.deepEqual(await queues(), queuedBefore);
    const after = await db.prepare(plan.audit).all<{
      eligible: number;
      item_deletions: number;
      piles: number;
      pile_operations: number;
      workspace_revision: number;
    }>();
    assert.ok(
      after.results
        .filter((x) => x.eligible)
        .every(
          (x) =>
            x.item_deletions +
              x.piles +
              x.pile_operations +
              x.workspace_revision ===
            0,
        ),
    );
  } finally {
    await mf.dispose();
  }
});
