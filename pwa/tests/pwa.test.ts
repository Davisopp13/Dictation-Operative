import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

type WorkerEvent = {
  waitUntil?: (promise: Promise<unknown>) => void;
  request?: { url: string; method: string; mode: string };
  respondWith?: (promise: Promise<Response>) => void;
};

const publicFile = (path: string) =>
  new URL(`../public/${path}`, import.meta.url);

void test('install manifest references real icons of the declared dimensions', () => {
  const manifest = JSON.parse(
    readFileSync(publicFile('manifest.webmanifest'), 'utf8'),
  );
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.name && manifest.short_name && manifest.id);
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(
      (item: { sizes: string }) => item.sizes === `${size}x${size}`,
    );
    assert.ok(icon);
    const png = readFileSync(publicFile(icon.src.slice(1)));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

void test('service worker precaches offline assets, falls back offline, and leaves private requests alone', async () => {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const shell = new Response('offline capture');
  Object.defineProperty(shell, 'redirected', { value: true });
  let cachedPaths: string[] = [];
  runInNewContext(readFileSync(publicFile('sw.js'), 'utf8'), {
    URL,
    Response,
    self: {
      location: { origin: 'https://do.example' },
      addEventListener: (
        name: string,
        listener: (event: WorkerEvent) => void,
      ) => listeners.set(name, listener),
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
    caches: {
      open: async () => ({
        addAll: async (paths: string[]) => {
          cachedPaths = paths;
        },
      }),
      match: async (path: string) =>
        path === '/offline.html' ? shell : undefined,
    },
    fetch: async () => {
      throw new Error('offline');
    },
  });
  let installation: Promise<unknown> | undefined;
  listeners.get('install')!({
    waitUntil: (promise: Promise<unknown>) => {
      installation = promise;
    },
  });
  await installation;
  assert.ok(cachedPaths.includes('/offline.html'));
  assert.ok(cachedPaths.includes('/recording-store.js'));
  for (const path of cachedPaths)
    assert.ok(existsSync(publicFile(path.slice(1))), path);
  let response: Promise<Response> | undefined;
  listeners.get('fetch')!({
    request: { url: 'https://do.example/', method: 'GET', mode: 'navigate' },
    respondWith: (promise: Promise<Response>) => {
      response = promise;
    },
  });
  const fallback = (await response)!;
  assert.equal(fallback.redirected, false);
  assert.equal(await fallback.text(), 'offline capture');
  for (const [path, method, mode] of [
    ['/api/thoughts', 'GET', 'cors'],
    ['/api/windows-downloads/x64', 'GET', 'navigate'],
    ['/api/mac-downloads/arm64', 'GET', 'navigate'],
    ['/cdn-cgi/access/logout', 'GET', 'navigate'],
    ['/', 'POST', 'navigate'],
  ]) {
    listeners.get('fetch')!({
      request: { url: `https://do.example${path}`, method, mode },
      respondWith: () => assert.fail(`Intercepted ${method} ${path}`),
    });
  }
});
