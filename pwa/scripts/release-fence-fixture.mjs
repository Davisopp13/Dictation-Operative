import { releaseDatabase } from '../lib/release-fence.ts';
/** Only for synthetic built checks, after migrations. No production connection. */
export async function installTestReleaseFence(db) {
  const { results: tables } = await db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations'",
    )
    .all();
  await db
    .prepare(
      "CREATE TABLE p3_release_maintenance(id INTEGER PRIMARY KEY CHECK(id=1),active INTEGER NOT NULL CHECK(active IN (0,1)),mode TEXT NOT NULL CHECK(mode IN ('closed','open')))",
    )
    .run();
  await db
    .prepare("INSERT INTO p3_release_maintenance VALUES(1,1,'open')")
    .run();
  for (const { name } of tables) {
    if (!/^[a-zA-Z0-9_]+$/.test(name))
      throw new Error('Unexpected fixture table');
    for (const op of ['INSERT', 'UPDATE', 'DELETE'])
      await db
        .prepare(
          `CREATE TRIGGER p3_release_${name}_${op.toLowerCase()} BEFORE ${op} ON ${name} WHEN COALESCE((SELECT active FROM p3_release_maintenance WHERE id=1),1)=1 BEGIN SELECT RAISE(ABORT,'workspace_maintenance'); END`,
        )
        .run();
  }
  return releaseDatabase(db);
}
