import { readFileSync, writeFileSync } from 'node:fs';
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    'Usage: node maintenance/prepare-release-fence.mjs schema-query.json output.sql',
  );
const envelope = JSON.parse(readFileSync(input, 'utf8'));
if (
  !Array.isArray(envelope) ||
  envelope.length !== 1 ||
  envelope[0].success !== true ||
  !Array.isArray(envelope[0].results)
)
  throw new Error('Expected one successful sqlite_schema query envelope.');
const rows = envelope[0].results;
const control =
  "CREATE TABLE p3_release_maintenance(id INTEGER PRIMARY KEY CHECK(id=1),active INTEGER NOT NULL CHECK(active IN (0,1)),mode TEXT NOT NULL CHECK(mode IN ('closed','open')))";
const normalize = (s) => s.trim().replace(/;$/, '').replace(/\s+/g, ' ');
const existing = rows.find(
  (r) => r.type === 'table' && r.name === 'p3_release_maintenance',
);
if (existing && normalize(existing.sql) !== control)
  throw new Error('Unexpected maintenance control schema.');
const statements = existing
  ? []
  : [control + ';', "INSERT INTO p3_release_maintenance VALUES(1,0,'closed');"];
for (const table of rows.filter(
  (r) =>
    r.type === 'table' &&
    !/^(sqlite_|_cf_)/.test(r.name) &&
    !['d1_migrations', 'p3_release_maintenance'].includes(r.name),
)) {
  if (!/^[a-zA-Z0-9_]+$/.test(table.name))
    throw new Error('Unexpected table identifier.');
  for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
    const name = `p3_release_${table.name}_${action.toLowerCase()}`;
    const sql = `CREATE TRIGGER "${name}" BEFORE ${action} ON "${table.name}" WHEN COALESCE((SELECT active FROM p3_release_maintenance WHERE id=1),1)=1 BEGIN SELECT RAISE(ABORT,'workspace_maintenance'); END`;
    const prior = rows.find((r) => r.type === 'trigger' && r.name === name);
    if (prior && normalize(prior.sql) !== sql)
      throw new Error('Unexpected existing fence trigger ' + name);
    if (!prior) statements.push(sql + ';');
  }
}
const sql = statements.join('\n') + '\n';
if (Buffer.byteLength(sql) >= 90000)
  throw new Error(
    'Split the reviewed installation below the query size bound.',
  );
writeFileSync(output, sql, { flag: 'wx', mode: 0o600 });
console.log(`Prepared ${statements.length} statements; no database contacted.`);
