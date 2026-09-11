import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { handleAPI, type Services } from '../lib/server';
import { MAC_RELEASE_KEY, macRelease } from '../lib/mac-release';

void test('Mac downloads require sign-in and serve only reviewed packages', async (t) => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}', compatibilityDate: '2026-05-22', d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB');
    let reads = 0;
    let canceled = 0;
    let mismatch = false;
    let missing = false;
    let lastBody: ReadableStream<Uint8Array>;
    const s: Services = {
      db, owner: 'tester', encryptionKey: '',
      images: {
        put: async () => { throw new Error('Download must never write'); },
        delete: async () => { throw new Error('Download must never delete'); },
        get: async (key) => {
          reads++;
          assert.equal(key, MAC_RELEASE_KEY, 'only the pinned release key may be read');
          const release = macRelease;
          if (missing) return null;
          lastBody = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('synthetic DMG stream')); }, cancel() { canceled++; } });
          return { body: lastBody, size: mismatch ? 3 : release.size };
        },
      },
    };
    const call = (path: string, method = 'GET', services = s) => handleAPI(new Request(`https://do.test/api/mac-downloads/${path}`, { method, headers: { Origin: 'https://do.test' } }), services);
    await t.test('unsigned requests cannot read the bucket', async () => {
      assert.equal((await call('arm64', 'GET', { ...s, owner: '' })).status, 401);
      assert.equal((await call('arm64', 'HEAD', { ...s, owner: '' })).status, 401);
      assert.equal(reads, 0);
    });
    await t.test('unknown architectures, object paths and writes are rejected', async () => {
      for (const path of ['', '__proto__', 'constructor', 'x64', 'x86', 'arm64/extra', '%2e%2e%2fclipboard%2fprivate.png'])
        assert.equal((await call(path)).status, 404);
      assert.equal((await call('arm64', 'POST')).status, 405);
      assert.equal(reads, 0);
    });
    await t.test('streams the expected installer without buffering', async () => {
      for (const arch of ['arm64']) {
        const response = await call(arch);
        const release = macRelease;
        assert.equal(response.status, 200);
        assert.equal(response.body, lastBody);
        assert.equal(response.headers.get('Content-Type'), 'application/x-apple-diskimage');
        assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="${release.filename}"`);
        assert.equal(response.headers.get('Content-Length'), String(release.size));
        assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
        assert.equal(response.headers.get('ETag'), `"${release.sha256}"`);
        await response.body!.cancel();
      }
    });
    await t.test('HEAD supplies metadata and cancels the unused stream', async () => {
      const before = canceled;
      const response = await call('arm64', 'HEAD');
      assert.equal(response.status, 200);
      assert.equal(response.body, null);
      assert.equal(canceled, before + 1);
    });
    await t.test('missing storage and absent packages fail clearly', async () => {
      assert.equal((await call('arm64', 'GET', { ...s, images: undefined })).status, 503);
      missing = true;
      assert.equal((await call('arm64')).status, 503);
      missing = false;
    });
    await t.test('unexpected package size fails closed and releases the stream', async () => {
      mismatch = true;
      const before = canceled;
      assert.equal((await call('arm64')).status, 503);
      assert.equal(canceled, before + 1);
    });
  } finally { await mf.dispose(); }
});
