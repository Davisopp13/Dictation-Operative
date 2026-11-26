import { readFileSync, writeFileSync } from 'node:fs';
import { reconciliationPlan } from '../lib/erasure-reconciliation';

const [input, outputPrefix, ...extra] = process.argv.slice(2);
if (!input || !outputPrefix || extra.length)
  throw new Error(
    'Usage: node --import tsx scripts/prepare-erasure-reconciliation.ts verified-snapshot.json output-prefix',
  );
const plan = reconciliationPlan(JSON.parse(readFileSync(input, 'utf8')));
// All statement/file byte checks finish before either output is written.
writeFileSync(outputPrefix + '.audit.sql', plan.auditFile, {
  flag: 'wx',
  mode: 0o600,
});
writeFileSync(outputPrefix + '.apply.sql', plan.applyFile, {
  flag: 'wx',
  mode: 0o600,
});
console.log('Created audit and apply SQL files. No database was contacted.');
