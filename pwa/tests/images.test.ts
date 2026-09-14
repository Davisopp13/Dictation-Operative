import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { handleAPI } from '../lib/server';
import { IMAGE_LIMIT } from '../lib/sync/protocol';
import type { ClipboardImage } from '../lib/images';

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);

void test('saved Clipboard images: storage, isolation, limits, search, pagination and deletion', async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
    r2Buckets: ['IMAGES'],
  });
  try {
    const db = await mf.getD1Database('DB');
    const images = await mf.getR2Bucket('IMAGES');
    for (const file of readdirSync(new URL('../drizzle/', import.meta.url))
      .filter((file) => file.endsWith('.sql'))
      .sort()) {
      for (const sql of readFileSync(
        new URL('../drizzle/' + file, import.meta.url),
        'utf8',
      ).split('--> statement-breakpoint'))
        if (sql.trim()) await db.prepare(sql.trim()).run();
    }
    const call = (
      path: string,
      method = 'GET',
      bytes?: Uint8Array<ArrayBuffer>,
      owner = 'alice',
      origin = 'https://do.test',
      type = 'image/png',
    ) =>
      handleAPI(
        new Request('https://do.test/api/' + path, {
          method,
          headers: { Origin: origin, 'Content-Type': type },
          ...(bytes ? { body: bytes } : {}),
        }),
        {
          db,
          images: {
            put: (key, bytes, options) => images.put(key, bytes, options),
            get: async (key) => {
              const stored = await images.get(key);
              return stored ? { body: new Response(await stored.arrayBuffer()).body!, size: stored.size } : null;
            },
            delete: (key) => images.delete(key),
          },
          owner,
          encryptionKey: '',
        },
      );
    let image: ClipboardImage;
    await t.test(
      'requires a signed-in owner and same-origin uploads',
      async () => {
        assert.equal((await call('images', 'POST', png, '')).status, 401);
        assert.equal(
          (await call('images', 'POST', png, 'alice', 'https://evil.test'))
            .status,
          403,
        );
        assert.equal((await images.list()).objects.length, 0);
      },
    );
    await t.test(
      'stores PNG bytes separately and returns metadata; owner can retrieve and download',
      async () => {
        const response = await call(
          'images?name=Screenshot%20100%25.png',
          'POST',
          png,
        );
        assert.equal(response.status, 201);
        image = (await response.json()) as ClipboardImage;
        assert.equal(image.name, 'Screenshot 100%.png');
        assert.equal(image.size, png.length);
        assert.equal(image.width, 1);
        assert.equal(image.height, 1);
        assert.equal((await images.list()).objects.length, 1);
        const result = await call(`images/${image.id}`);
        assert.equal(result.headers.get('Content-Type'), 'image/png');
        assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
        assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
        assert.deepEqual(new Uint8Array(await result.arrayBuffer()), png);
        const download = await call(`images/${image.id}?download=1`);
        assert.match(
          download.headers.get('Content-Disposition')!,
          /^attachment;/,
        );
        assert.match(
          download.headers.get('Content-Disposition')!,
          /Screenshot%20100%25.png/,
        );
      },
    );
    await t.test(
      'another owner cannot list, read or delete an image',
      async () => {
        assert.deepEqual(
          await (await call('images', 'GET', undefined, 'bob')).json(),
          { images: [], hasMore: false },
        );
        assert.equal(
          (await call(`images/${image.id}`, 'GET', undefined, 'bob')).status,
          404,
        );
        assert.equal(
          (await call(`images/${image.id}`, 'DELETE', undefined, 'bob')).status,
          404,
        );
        assert.equal((await images.list()).objects.length, 1);
      },
    );
    await t.test(
      'rejects unsupported, oversized, malformed and extreme-dimension payloads',
      async () => {
        assert.equal(
          (
            await call(
              'images',
              'POST',
              png,
              'alice',
              'https://do.test',
              'image/svg+xml',
            )
          ).status,
          415,
        );
        assert.equal(
          (await call('images', 'POST', new Uint8Array(IMAGE_LIMIT + 1)))
            .status,
          413,
        );
        assert.equal(
          (
            await call(
              'images',
              'POST',
              new TextEncoder().encode('not an image'),
            )
          ).status,
          400,
        );
        const huge = png.slice();
        new DataView(huge.buffer).setUint32(16, 20000);
        assert.equal((await call('images', 'POST', huge)).status, 400);
        assert.equal(
          (await call('images?name=' + 'x'.repeat(121), 'POST', png)).status,
          400,
        );
        assert.equal((await images.list()).objects.length, 1);
      },
    );
    await t.test(
      'search treats wildcards literally and rejects invalid pages',
      async () => {
        const data = (await (await call('images?q=100%25')).json()) as {
          images: ClipboardImage[];
        };
        assert.equal(data.images.length, 1);
        assert.deepEqual(
          (
            (await (await call('images?q=_')).json()) as {
              images: ClipboardImage[];
            }
          ).images,
          [],
        );
        assert.equal((await call('images?offset=-1')).status, 400);
        assert.equal((await call('images?offset=1.5')).status, 400);
      },
    );
    await t.test('deletion removes both metadata and file bytes', async () => {
      assert.equal((await call(`images/${image.id}`, 'DELETE')).status, 200);
      assert.equal((await call(`images/${image.id}`)).status, 404);
      assert.equal((await images.list()).objects.length, 0);
      assert.deepEqual(await (await call('images')).json(), {
        images: [],
        hasMore: false,
      });
    });
    await t.test(
      'lists a bounded page and exposes the remaining page',
      async () => {
        await db.batch(
          Array.from({ length: 41 }, (_, i) =>
            db
              .prepare('INSERT INTO clipboard_images VALUES (?,?,?,?,?,?,?,?)')
              .bind(
                `image-page-${i}`,
                'alice',
                `Page ${i}`,
                `key-${i}`,
                1,
                1,
                1,
                i,
              ),
          ),
        );
        const first = (await (await call('images')).json()) as {
          images: ClipboardImage[];
          hasMore: boolean;
        };
        assert.equal(first.images.length, 40);
        assert.equal(first.hasMore, true);
        const last = (await (await call('images?offset=40')).json()) as {
          images: ClipboardImage[];
          hasMore: boolean;
        };
        assert.equal(last.images.length, 1);
        assert.equal(last.hasMore, false);
        assert.equal(last.images[0].id, 'image-page-0');
      },
    );
  } finally {
    await mf.dispose();
  }
});
