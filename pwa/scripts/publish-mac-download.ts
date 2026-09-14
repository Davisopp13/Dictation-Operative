import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { MAC_RELEASE_KEY, macRelease } from '../lib/mac-release';

const args = process.argv.slice(2);
const files = args.filter(arg => !arg.startsWith('--'));
if (files.length !== 1 || args.some(arg => arg.startsWith('--') && arg !== '--check'))
  throw new Error('Usage: npm run publish:mac-download -- /path/to/Dictation.dmg [--check]');
const file = resolve(files[0]);
const hash = createHash('sha256');
for await (const chunk of createReadStream(file)) hash.update(chunk);
if ((await stat(file)).size !== macRelease.size || hash.digest('hex') !== macRelease.sha256)
  throw new Error(`Package does not match the reviewed, notarized release: ${macRelease.filename}`);
console.log(`Verified ${macRelease.filename}`);

// An immutable key prevents another local build from replacing the reviewed DMG.
if (!args.includes('--check')) {
  const result = spawnSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'r2', 'object', 'put',
    `do-voice-images/${MAC_RELEASE_KEY}`, '--file', file,
    '--content-type', 'application/x-apple-diskimage', '--remote',
  ], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
