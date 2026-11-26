import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = new URL('node_modules/pdfjs-dist/', root);
const { version } = JSON.parse(
  await readFile(new URL('package.json', source), 'utf8'),
);
const parent = new URL('public/vendor/pdfjs/', root);
await rm(parent, { recursive: true, force: true });
const target = new URL(`${version}/`, parent);
await mkdir(target, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(new URL(directory, source), new URL(directory, target), {
    recursive: true,
  });
}
await cp(
  new URL('legacy/build/pdf.worker.min.mjs', source),
  new URL('pdf.worker.min.mjs', target),
);
await cp(new URL('LICENSE', source), new URL('LICENSE', target));
console.log(`Prepared local PDF assets: ${fileURLToPath(target)}`);
