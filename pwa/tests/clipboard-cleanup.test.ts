import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { handleAPI } from '../lib/server';
import { insertClip } from '../lib/repository';
import { newClip, type Clip } from '../lib/domain';
import {
  runClipboardCleanup,
  CLIPBOARD_RETENTION_MS,
} from '../lib/clipboard-cleanup';
import type { ClipboardImage, ImageStore } from '../lib/images';

const now = 1800000000000;
const cutoff = now - CLIPBOARD_RETENTION_MS;
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);

void test('daily Clipboard retention and image pins on real D1/R2', async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
    r2Buckets: ['IMAGES'],
  });
  try {
    const db = await mf.getD1Database('DB');
    const bucket = await mf.getR2Bucket('IMAGES');
    const images: ImageStore = {
      put: (key, bytes, options) => bucket.put(key, bytes, options),
      get: async (key) => {
        const result = await bucket.get(key);
        return result
          ? {
              body: new Response(await result.arrayBuffer()).body!,
              size: result.size,
            }
          : null;
      },
      delete: (key) => bucket.delete(key),
    };
    const migrations = readdirSync(new URL('../drizzle/', import.meta.url))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    async function migrate(file: string) {
      for (const sql of readFileSync(
        new URL('../drizzle/' + file, import.meta.url),
        'utf8',
      ).split('--> statement-breakpoint'))
        if (sql.trim()) await db.prepare(sql.trim()).run();
    }
    for (const file of migrations.filter((file) => !file.startsWith('0005')))
      await migrate(file);
    const legacy = newClip(
      {
        id: crypto.randomUUID(),
        content: 'Previously saved text',
        kind: 'note',
      },
      cutoff - 1,
    );
    await db
      .prepare(
        'INSERT INTO clips (id,owner,title,kind,content,original,segments,versions,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        legacy.id,
        'alice',
        legacy.title,
        legacy.kind,
        legacy.content,
        legacy.original,
        JSON.stringify(legacy.segments),
        JSON.stringify(legacy.versions),
        legacy.createdAt,
        legacy.updatedAt,
      )
      .run();
    await migrate(migrations.find((file) => file.startsWith('0005'))!);
    const call = (
      path: string,
      method = 'GET',
      data?: unknown,
      owner = 'alice',
      origin = 'https://do.test',
      store = images,
    ) =>
      handleAPI(
        new Request('https://do.test/api/' + path, {
          method,
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        }),
        { db, owner, images: store},
      );
    const saveText = (
      owner: string,
      time: number,
      clipboard = true,
      pinned = false,
    ) =>
      insertClip(
        db,
        owner,
        newClip(
          {
            id: crypto.randomUUID(),
            content: 'Keep useful words',
            kind: 'note',
            pinned,
          },
          time,
        ),
        clipboard,
      );
    async function saveImage(owner = 'alice', time = cutoff - 1) {
      const result = await handleAPI(
        new Request('https://do.test/api/images', {
          method: 'POST',
          headers: { Origin: 'https://do.test', 'Content-Type': 'image/png' },
          body: png,
        }),
        { db, owner, images},
      );
      assert.equal(result.status, 201);
      const image = (await result.json()) as ClipboardImage;
      assert.equal(image.pinned, false);
      await db
        .prepare('UPDATE clipboard_images SET created_at=? WHERE id=?')
        .bind(time, image.id)
        .run();
      return image;
    }
    const exists = async (id: string, table = 'clips') =>
      !!(await db
        .prepare(`SELECT id FROM ${table} WHERE id=?`)
        .bind(id)
        .first());

    await t.test(
      'opt-in defaults off, validates input, persists per account and preserves other settings',
      async () => {
        assert.equal(
          (
            (await (await call('settings')).json()) as {
              clipboardDailyCleanup: boolean;
            }
          ).clipboardDailyCleanup,
          false,
        );
        const text = await saveText('alice', cutoff - 1);
        await runClipboardCleanup(db, images, now);
        assert.equal(await exists(text.id), true);
        assert.equal(
          (
            await call('settings', 'POST', {
              action: 'clipboard-cleanup',
              enabled: 'yes',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              'settings',
              'POST',
              { action: 'clipboard-cleanup', enabled: true },
              '',
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await call(
              'settings',
              'POST',
              { action: 'clipboard-cleanup', enabled: true },
              'alice',
              'https://evil.test',
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call('settings', 'POST', {
              action: 'clipboard-cleanup',
              enabled: true,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            (await (
              await call('settings', 'GET', undefined, 'bob')
            ).json()) as { clipboardDailyCleanup: boolean }
          ).clipboardDailyCleanup,
          false,
        );
        // Consent recorded while dictation existed stays in the row untouched.
        await db
          .prepare("UPDATE preferences SET consent=1 WHERE owner='alice'")
          .run();
        await call('settings', 'POST', {
          action: 'clipboard-cleanup',
          enabled: true,
        });
        const settings = (await (await call('settings')).json()) as {
          clipboardDailyCleanup: boolean;
        };
        assert.equal(settings.clipboardDailyCleanup, true);
        assert.equal(
          (
            await db
              .prepare("SELECT consent FROM preferences WHERE owner='alice'")
              .first<{ consent: number }>()
          )?.consent,
          1,
        );
      },
    );
    await t.test(
      'only expired unpinned Clipboard items are removed; exact cutoff, pins, history and other accounts survive',
      async () => {
        const old = await saveText('alice', cutoff - 1);
        const recent = await saveText('alice', now - 1000);
        const boundary = await saveText('alice', cutoff);
        const pinned = await saveText('alice', cutoff - 1, true, true);
        const history = await saveText('alice', cutoff - 1, false);
        const bob = await saveText('bob', cutoff - 1);
        const oldImage = await saveImage();
        const freshImage = await saveImage('alice', cutoff);
        const pinnedImage = await saveImage();
        const bobImage = await saveImage('bob');
        assert.equal(
          (await call(`images/${pinnedImage.id}`, 'PATCH', { pinned: true }))
            .status,
          200,
        );
        assert.equal(
          (
            await call(
              `images/${pinnedImage.id}`,
              'PATCH',
              { pinned: false },
              'bob',
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              `images/${pinnedImage.id}`,
              'PATCH',
              { pinned: false },
              'alice',
              'https://evil.test',
            )
          ).status,
          403,
        );
        assert.equal(
          (await call(`images/${pinnedImage.id}`, 'PATCH', { pinned: 'true' }))
            .status,
          400,
        );
        const list = (await (await call('images?pinned=true')).json()) as {
          images: ClipboardImage[];
        };
        assert.deepEqual(
          list.images.map((image) => image.id),
          [pinnedImage.id],
        );
        assert.equal(list.images[0].pinned, true);
        const result = await runClipboardCleanup(db, images, now);
        assert.equal(result.imagesDeleted, 1);
        assert.equal(await exists(old.id), false);
        for (const clip of [recent, boundary, pinned, history, legacy, bob])
          assert.equal(await exists(clip.id), true);
        assert.equal(await exists(oldImage.id, 'clipboard_images'), false);
        assert.equal(await bucket.get(`clipboard/${oldImage.id}.png`), null);
        for (const image of [freshImage, pinnedImage, bobImage]) {
          assert.equal(await exists(image.id, 'clipboard_images'), true);
          assert.ok(await bucket.get(`clipboard/${image.id}.png`));
        }
        assert.deepEqual(await runClipboardCleanup(db, images, now), {
          textDeleted: 0,
          imagesDeleted: 0,
        });
      },
    );
    await t.test(
      'concurrent cleanup and pin have a consistent winner',
      async () => {
        for (let i = 0; i < 10; i++) {
          const image = await saveImage();
          const [pin] = await Promise.all([
            call(`images/${image.id}`, 'PATCH', { pinned: true }),
            runClipboardCleanup(db, images, now),
          ]);
          assert.ok(pin.status === 200 || pin.status === 404);
          assert.equal(
            await exists(image.id, 'clipboard_images'),
            pin.status === 200,
          );
          assert.equal(
            !!(await bucket.get(`clipboard/${image.id}.png`)),
            pin.status === 200,
          );
        }
        const pinned = await saveImage();
        await call(`images/${pinned.id}`, 'PATCH', { pinned: true });
        await runClipboardCleanup(db, images, now);
        assert.equal(await exists(pinned.id, 'clipboard_images'), true);
        const unpinned = await call(`images/${pinned.id}`, 'PATCH', {
          pinned: false,
        });
        assert.equal(((await unpinned.json()) as ClipboardImage).pinned, false);
        const filtered = (await (await call('images?pinned=true')).json()) as {
          images: ClipboardImage[];
        };
        assert.ok(!filtered.images.some((image) => image.id === pinned.id));
        await runClipboardCleanup(db, images, now);
        assert.equal(await exists(pinned.id, 'clipboard_images'), false);
      },
    );
    await t.test(
      'Clipboard creation marker is atomic and retries cannot reclassify dictation history',
      async () => {
        const response = await call('clips', 'POST', {
          id: crypto.randomUUID(),
          content: 'Direct Clipboard text',
          kind: 'note',
          clipboardItem: true,
        });
        assert.equal(response.status, 201);
        const clip = (await response.json()) as Clip;
        const stored = await db
          .prepare('SELECT clipboard_item FROM clips WHERE id=?')
          .bind(clip.id)
          .first<{ clipboard_item: number }>();
        assert.equal(stored?.clipboard_item, 1);
        const appended = await call(`clips/${clip.id}`, 'PATCH', {
          action: 'append',
          revision: 1,
          content: 'A dictated addition',
          segmentId: 'retention-segment',
        });
        assert.equal(appended.status, 200);
        assert.equal(
          (
            await db
              .prepare('SELECT clipboard_item FROM clips WHERE id=?')
              .bind(clip.id)
              .first<{ clipboard_item: number }>()
          )?.clipboard_item,
          0,
        );
        await call('clips', 'POST', {
          id: legacy.id,
          content: 'Try again',
          clipboardItem: true,
        });
        assert.equal(
          (
            await db
              .prepare('SELECT clipboard_item FROM clips WHERE id=?')
              .bind(legacy.id)
              .first<{ clipboard_item: number }>()
          )?.clipboard_item,
          0,
        );
        assert.equal(
          (
            await call('clips', 'POST', {
              id: crypto.randomUUID(),
              content: 'Bad marker',
              clipboardItem: 'yes',
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      'file deletion failures are durable; a pin cannot resurrect deleted metadata; retry works after opt-out',
      async () => {
        const image = await saveImage();
        const failing = {
          delete: async () => {
            throw new Error('storage unavailable');
          },
        };
        await assert.rejects(
          runClipboardCleanup(db, failing, now),
          /pending work/,
        );
        assert.equal(await exists(image.id, 'clipboard_images'), false);
        assert.ok(await bucket.get(`clipboard/${image.id}.png`));
        assert.ok(
          await db
            .prepare(
              'SELECT object_key FROM clipboard_image_deletion_queue WHERE object_key=?',
            )
            .bind(`clipboard/${image.id}.png`)
            .first(),
        );
        assert.equal(
          (await call(`images/${image.id}`, 'PATCH', { pinned: true })).status,
          404,
        );
        await call('settings', 'POST', {
          action: 'clipboard-cleanup',
          enabled: false,
        });
        const survivor = await saveImage();
        await runClipboardCleanup(db, images, now);
        assert.equal(await bucket.get(`clipboard/${image.id}.png`), null);
        assert.equal(await exists(survivor.id, 'clipboard_images'), true);
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS count FROM clipboard_image_deletion_queue',
              )
              .first<{ count: number }>()
          )?.count,
          0,
        );
        const manual = await saveImage();
        const failedStore = { ...images, ...failing };
        assert.equal(
          (
            await call(
              `images/${manual.id}`,
              'DELETE',
              undefined,
              'alice',
              'https://do.test',
              failedStore,
            )
          ).status,
          200,
        );
        assert.equal(await exists(manual.id, 'clipboard_images'), false);
        await runClipboardCleanup(db, images, now);
        assert.equal(await bucket.get(`clipboard/${manual.id}.png`), null);
      },
    );
    await t.test(
      'processes multiple bounded pages without skipping eligible items',
      async () => {
        await call('settings', 'POST', {
          action: 'clipboard-cleanup',
          enabled: true,
        });
        const clips = await Promise.all(
          Array.from({ length: 205 }, () => saveText('alice', cutoff - 1)),
        );
        await db.batch(
          Array.from({ length: 205 }, (_, i) =>
            db
              .prepare(
                'INSERT INTO clipboard_images (id,owner,name,object_key,size,width,height,created_at) VALUES (?,?,?,?,?,?,?,?)',
              )
              .bind(
                `cleanup-page-${i}`,
                'alice',
                'Old image',
                `cleanup/page-${i}`,
                1,
                1,
                1,
                cutoff - 1,
              ),
          ),
        );
        const result = await runClipboardCleanup(db, images, now);
        assert.ok(result.textDeleted >= 205);
        assert.ok(result.imagesDeleted >= 205);
        for (const clip of clips) assert.equal(await exists(clip.id), false);
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS count FROM clipboard_image_deletion_queue',
              )
              .first<{ count: number }>()
          )?.count,
          0,
        );
      },
    );
  } finally {
    await mf.dispose();
  }
});
