import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { releaseDatabase, releaseEnvironment } from '../lib/release-fence';
void test('release fence blocks older invocations after reopen and preserves atomic batches', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    d1Databases: ['DB'],
  });
  try {
    const raw = await mf.getD1Database('DB');
    await raw
      .prepare(
        'CREATE TABLE p3_release_maintenance(id INTEGER PRIMARY KEY,active INTEGER,mode TEXT)',
      )
      .run();
    await raw
      .prepare("INSERT INTO p3_release_maintenance VALUES(1,1,'closed')")
      .run();
    await raw
      .prepare('CREATE TABLE records(id TEXT PRIMARY KEY,value TEXT)')
      .run();
    for (const op of ['INSERT', 'UPDATE', 'DELETE'])
      await raw
        .prepare(
          `CREATE TRIGGER fence_${op} BEFORE ${op} ON records WHEN COALESCE((SELECT active FROM p3_release_maintenance),1)=1 BEGIN SELECT RAISE(ABORT,'workspace_maintenance'); END`,
        )
        .run();
    const db = releaseDatabase(raw);
    assert.equal(releaseEnvironment({ DB: raw }).DB, raw);
    assert.equal(
      releaseEnvironment({ DB: raw, WORKSPACE_WRITE_FENCE: 'on' }).DB,
      db,
    );
    const late = raw.prepare("INSERT INTO records VALUES('old','unsafe')");
    await assert.rejects(
      db.prepare("INSERT INTO records VALUES('new','safe')").run(),
      /workspace_maintenance/,
    );
    await raw.prepare("UPDATE p3_release_maintenance SET mode='open'").run();
    await db.prepare("INSERT INTO records VALUES('new','safe')").run();
    await assert.rejects(late.run(), /workspace_maintenance/);
    const output = await db
      .prepare("UPDATE records SET value=? WHERE id='new' RETURNING id,value")
      .bind('current')
      .raw();
    assert.deepEqual(output, [['new', 'current']]);
    assert.equal(
      await db
        .prepare("SELECT value FROM records WHERE id='new'")
        .first('value'),
      'current',
    );
    await assert.rejects(
      db.batch([
        db.prepare("UPDATE records SET value='rolled back'"),
        db.prepare("INSERT INTO records VALUES('new','duplicate')"),
      ]),
      /UNIQUE/,
    );
    assert.equal(
      await raw
        .prepare('SELECT active FROM p3_release_maintenance')
        .first('active'),
      1,
    );
    assert.equal(
      await db
        .prepare("SELECT value FROM records WHERE id='new'")
        .first('value'),
      'current',
    );
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        i % 2
          ? late.run()
          : db.prepare("UPDATE records SET value=value WHERE id='new'").run(),
      ),
    );
    assert.equal(attempts.filter((r) => r.status === 'rejected').length, 5);
    assert.equal(
      await raw
        .prepare('SELECT active FROM p3_release_maintenance')
        .first('active'),
      1,
    );
    await db
      .withSession('first-primary')
      .prepare("UPDATE records SET value='session' WHERE id='new'")
      .run();
    assert.equal(
      await db.prepare('SELECT value FROM records').first('value'),
      'session',
    );
    await assert.rejects(
      db.batch([raw.prepare('SELECT 1')]),
      /another database/,
    );
    await raw.prepare("UPDATE p3_release_maintenance SET mode='closed'").run();
    await assert.rejects(
      db.prepare('DELETE FROM records').run(),
      /workspace_maintenance/,
    );
    assert.equal(
      await db.prepare('SELECT count(*) n FROM records').first('n'),
      1,
    );
    await raw.prepare('DELETE FROM p3_release_maintenance').run();
    await assert.rejects(
      db.prepare("INSERT INTO records VALUES('missing-gate','unsafe')").run(),
      /workspace_maintenance/,
    );
  } finally {
    await mf.dispose();
  }
});
