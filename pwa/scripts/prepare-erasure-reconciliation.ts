import {readFileSync,writeFileSync} from 'node:fs';
import {reconciliationPlan} from '../lib/erasure-reconciliation';

const [input,outputPrefix,...extra]=process.argv.slice(2);
if(!input || !outputPrefix || extra.length) throw new Error('Usage: node --import tsx scripts/prepare-erasure-reconciliation.ts verified-snapshot.json output-prefix');
const plan=reconciliationPlan(JSON.parse(readFileSync(input,'utf8')));
const preamble='-- Generated from a verified pre-window account/owner snapshot.\n-- Follow docs/account-erasure-reconciliation.md; generating SQL does not authorize execution.\n';
writeFileSync(outputPrefix+'.audit.sql',preamble+plan.audit+'\n',{flag:'wx',mode:0o600});
writeFileSync(outputPrefix+'.apply.sql',preamble+plan.statements.join('\n\n')+'\n',{flag:'wx',mode:0o600});
console.log('Created audit and apply SQL files. No database was contacted.');
