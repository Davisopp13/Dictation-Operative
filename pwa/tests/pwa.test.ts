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
  // Identity an installed app depends on must not change with the rebrand.
  assert.equal(manifest.id, '/');
  assert.equal(manifest.name, 'Catch-all Desk');
  assert.ok(manifest.short_name);
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

void test('service worker precaches the offline page, replaces older caches, and leaves private requests alone', async () => {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const shell = new Response('offline page');
  Object.defineProperty(shell, 'redirected', { value: true });
  let cachedPaths: string[] = [];
  let openedCache = '';
  const deletedCaches: string[] = [];
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
      open: async (name: string) => {
        openedCache = name;
        return {
          addAll: async (paths: string[]) => {
            cachedPaths = paths;
          },
        };
      },
      keys: async () => ['do-static-v3', openedCache, 'another-app-cache'],
      delete: async (name: string) => {
        deletedCaches.push(name);
        return true;
      },
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
  // The retired recorder's scripts are no longer shipped or cached.
  for (const retired of ['/offline-capture.js', '/recording-store.js']) {
    assert.ok(!cachedPaths.includes(retired), retired);
    assert.ok(!existsSync(publicFile(retired.slice(1))), retired);
  }
  for (const path of cachedPaths)
    assert.ok(existsSync(publicFile(path.slice(1))), path);
  const offline = readFileSync(publicFile('offline.html'), 'utf8');
  assert.ok(!/<script|record/i.test(offline));
  // Upgrading from the previous cache removes it and nothing else.
  assert.match(openedCache, /^do-static-v\d+$/);
  assert.notEqual(openedCache, 'do-static-v3');
  let activation: Promise<unknown> | undefined;
  listeners.get('activate')!({
    waitUntil: (promise: Promise<unknown>) => {
      activation = promise;
    },
  });
  await activation;
  assert.deepEqual(deletedCaches, ['do-static-v3']);
  let response: Promise<Response> | undefined;
  listeners.get('fetch')!({
    request: { url: 'https://do.example/', method: 'GET', mode: 'navigate' },
    respondWith: (promise: Promise<Response>) => {
      response = promise;
    },
  });
  const fallback = (await response)!;
  assert.equal(fallback.redirected, false);
  assert.equal(await fallback.text(), 'offline page');
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
