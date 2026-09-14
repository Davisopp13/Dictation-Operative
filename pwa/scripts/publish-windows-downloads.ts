import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { windowsRelease } from '../lib/windows-release';

const project = fileURLToPath(new URL('../', import.meta.url));
const packages = ['x64', 'arm64'].map(architecture => {
  const release = windowsRelease(architecture)!;
  return { ...release, file: fileURLToPath(new URL(`../../windows/dist/${release.filename}`, import.meta.url)) };
});

// Verify every local package before any remote write. Hashes are in the object
// keys so a different build never silently replaces an existing download.
for (const release of packages) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(release.file)) hash.update(chunk);
  if ((await stat(release.file)).size !== release.size || hash.digest('hex') !== release.sha256)
    throw new Error(`Package does not match the reviewed release: ${release.filename}`);
  console.log(`Verified ${release.filename}`);
}
if (!process.argv.includes('--check')) {
  for (const release of packages) {
    const result = spawnSync(process.execPath, [
      'node_modules/wrangler/bin/wrangler.js', 'r2', 'object', 'put',
      `do-voice-images/${release.key}`, '--file', release.file,
      '--content-type', 'application/zip', '--remote',
    ], { cwd: project, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
