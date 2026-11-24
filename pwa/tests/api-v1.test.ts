import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { handleAPI } from '../lib/server';
import { runClipboardCleanup } from '../lib/clipboard-cleanup';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { IMAGE_ACCOUNT_LIMIT, type ClipboardImage } from '../lib/images';
import type { Clip } from '../lib/domain';

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);
type TextPage = {
  items: { id: string; content: string; contentLength: number }[];
  nextCursor: string | null;
  revision: number;
};
type ImagePage = {
  items: ClipboardImage[];
  nextCursor: string | null;
  revision: number;
};

void test('cursors round-trip and reject anything malformed', () => {
  const cursor = { time: 1790000000000, id: 'abc-123_XYZ' };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(''), null);
  for (const bad of [
    'not-base64!',
    btoa('{}'),
    btoa('[1]'),
    btoa('["1","id"]'),
    btoa('[1.5,"id"]'),
    'A'.repeat(301),
  ])
    assert.throws(() => decodeCursor(bad), /Invalid cursor/);
});

void test('/api/v1 on real D1 and R2: revision, text and images', async (t) => {
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
    for (const file of readdirSync(new URL('../drizzle/', import.meta.url))
      .filter((f) => f.endsWith('.sql'))
      .sort())
      for (const sql of readFileSync(
        new URL('../drizzle/' + file, import.meta.url),
        'utf8',
      ).split('--> statement-breakpoint'))
        if (sql.trim()) await db.prepare(sql.trim()).run();
    const images = {
      put: (
        key: string,
        bytes: Uint8Array<ArrayBuffer>,
        options: { httpMetadata: { contentType: string } },
      ) => bucket.put(key, bytes, options),
      get: async (key: string) => {
        const stored = await bucket.get(key);
        return stored
          ? {
              body: new Response(await stored.arrayBuffer()).body!,
              size: stored.size,
            }
          : null;
      },
      delete: (key: string) => bucket.delete(key),
    };
    const call = (
      path: string,
      method = 'GET',
      data?: unknown,
      owner = 'alice',
      origin = 'https://do.test',
    ) =>
      handleAPI(
        new Request('https://do.test/api/v1/' + path, {
          method,
          headers: {
            Origin: origin,
            'Content-Type':
              data instanceof Uint8Array ? 'image/png' : 'application/json',
          },
          ...(data === undefined
            ? {}
            : {
                body:
                  data instanceof Uint8Array
                    ? (data as Uint8Array<ArrayBuffer>)
                    : JSON.stringify(data),
              }),
        }),
        { db, images, owner },
      );
    const revision = async (owner = 'alice') =>
      (
        (await (await call('revision', 'GET', undefined, owner)).json()) as {
          revision: number;
        }
      ).revision;
    // Every change must move the counter, so a polling client notices it.
    const moves = async (change: () => Promise<unknown>) => {
      const before = await revision();
      await change();
      const after = await revision();
      assert.ok(after > before, `revision stayed at ${before}`);
    };

    await t.test('requires sign-in and same-origin writes', async () => {
      assert.equal((await call('revision', 'GET', undefined, '')).status, 401);
      assert.equal((await call('text', 'GET', undefined, '')).status, 401);
      assert.equal(
        (
          await call(
            'text',
            'POST',
            { id: crypto.randomUUID(), content: 'x' },
            'alice',
            'https://evil.test',
          )
        ).status,
        403,
      );
      assert.equal((await call('unknown')).status, 404);
    });

    await t.test('a new workspace starts at revision 0', async () => {
      const response = await call('revision');
      assert.equal(response.status, 200);
      const state = (await response.json()) as {
        revision: number;
        updatedAt: number;
        serverTime: number;
      };
      assert.equal(state.revision, 0);
      assert.equal(state.updatedAt, 0);
      assert.ok(Math.abs(state.serverTime - Date.now()) < 60000);
    });

    let saved: Clip;
    await t.test(
      'text create is idempotent on a client identifier and first-write-wins',
      async () => {
        const input = { id: crypto.randomUUID(), content: 'From the phone' };
        let created: Response;
        await moves(async () => {
          created = await call('text', 'POST', input);
        });
        assert.equal(created!.status, 201);
        saved = (await created!.json()) as Clip;
        assert.equal(saved.content, 'From the phone');
        const replay = await call('text', 'POST', {
          ...input,
          content: 'A retry that carries different text',
        });
        assert.equal(replay.status, 200);
        assert.equal(((await replay.json()) as Clip).content, 'From the phone');
        assert.equal(
          ((await (await call('text')).json()) as TextPage).items.length,
          1,
        );
        // Saved by a client, so it is a Clipboard item eligible for cleanup.
        assert.equal(
          (
            await db
              .prepare('SELECT clipboard_item FROM clips WHERE id=?')
              .bind(saved.id)
              .first<{ clipboard_item: number }>()
          )?.clipboard_item,
          1,
        );
        const kept = await call('text', 'POST', {
          id: crypto.randomUUID(),
          content: 'Keep out of cleanup',
          clipboardItem: false,
        });
        const keptId = ((await kept.json()) as Clip).id;
        assert.equal(
          (
            await db
              .prepare('SELECT clipboard_item FROM clips WHERE id=?')
              .bind(keptId)
              .first<{ clipboard_item: number }>()
          )?.clipboard_item,
          0,
        );
        await call(`text/${keptId}?revision=1`, 'DELETE');
      },
    );

    await t.test(
      'another account cannot read, take or learn about an identifier',
      async () => {
        assert.equal(
          (await call('text/' + saved.id, 'GET', undefined, 'bob')).status,
          404,
        );
        const taken = await call(
          'text',
          'POST',
          { id: saved.id, content: 'Collision' },
          'bob',
        );
        assert.equal(taken.status, 409);
        assert.ok(!(await taken.text()).includes('From the phone'));
        assert.equal(
          ((await (await call('text', 'GET', undefined, 'bob')).json()) as TextPage)
            .items.length,
          0,
        );
        assert.equal(await revision('bob'), 0);
      },
    );

    await t.test(
      'edits, pins and deletes move the revision; stale edits do not win',
      async () => {
        let edited: Response;
        await moves(async () => {
          edited = await call('text/' + saved.id, 'PATCH', {
            action: 'edit',
            content: 'Edited on the Mac',
            revision: saved.revision,
          });
        });
        assert.equal(edited!.status, 200);
        const stale = await call('text/' + saved.id, 'PATCH', {
          action: 'edit',
          content: 'Stale edit from the phone',
          revision: saved.revision,
        });
        assert.equal(stale.status, 409);
        saved = (await (await call('text/' + saved.id)).json()) as Clip;
        assert.equal(saved.content, 'Edited on the Mac');
        await moves(() =>
          call('text/' + saved.id, 'PATCH', {
            action: 'pin',
            pinned: true,
            revision: saved.revision,
          }),
        );
        saved = (await (await call('text/' + saved.id)).json()) as Clip;
        assert.equal(saved.pinned, true);
        assert.equal(
          (await call(`text/${saved.id}?revision=1`, 'DELETE')).status,
          409,
        );
        await moves(async () => {
          assert.equal(
            (await call(`text/${saved.id}?revision=${saved.revision}`, 'DELETE'))
              .status,
            200,
          );
        });
        assert.equal((await call('text/' + saved.id)).status, 404);
      },
    );

    await t.test(
      'text pages by cursor: no item is skipped when earlier items are deleted',
      async () => {
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
          const id = crypto.randomUUID();
          ids.push(id);
          await call('text', 'POST', { id, content: `Item ${i}` });
          await db
            .prepare('UPDATE clips SET updated_at=?,created_at=? WHERE id=?')
            .bind(1000 + i, 1000 + i, id)
            .run();
        }
        const first = (await (
          await call('text?limit=2')
        ).json()) as TextPage;
        assert.deepEqual(
          first.items.map((item) => item.content),
          ['Item 4', 'Item 3'],
        );
        assert.equal(first.items[0].contentLength, 6);
        assert.ok(first.nextCursor);
        assert.equal(first.revision, await revision());
        // Offset paging would now skip "Item 2": both page-one items are gone.
        for (const id of [ids[4], ids[3]])
          await call(`text/${id}?revision=1`, 'DELETE');
        const second = (await (
          await call(`text?limit=2&cursor=${first.nextCursor}`)
        ).json()) as TextPage;
        assert.deepEqual(
          second.items.map((item) => item.content),
          ['Item 2', 'Item 1'],
        );
        const third = (await (
          await call(`text?limit=2&cursor=${second.nextCursor}`)
        ).json()) as TextPage;
        assert.deepEqual(
          third.items.map((item) => item.content),
          ['Item 0'],
        );
        assert.equal(third.nextCursor, null);
        const long = 'x'.repeat(700);
        await call('text', 'POST', { id: crypto.randomUUID(), content: long });
        const preview = (
          (await (await call('text?limit=1')).json()) as TextPage
        ).items[0];
        assert.equal(preview.content.length, 500);
        assert.equal(preview.contentLength, 700);
        assert.equal((await call('text?cursor=garbage')).status, 400);
        assert.equal((await call('text?limit=0')).status, 400);
        assert.equal((await call('text?limit=101')).status, 400);
        // Search and pinned filters work with cursors.
        const found = (await (
          await call('text?q=Item%201')
        ).json()) as TextPage;
        assert.deepEqual(
          found.items.map((item) => item.content),
          ['Item 1'],
        );
      },
    );

    await t.test(
      'scheduled cleanup moves the revision for text it removes',
      async () => {
        await db
          .prepare(
            "INSERT INTO preferences (owner,clipboard_daily_cleanup) VALUES ('alice',1)",
          )
          .run();
        const now = Date.now() + 48 * 60 * 60 * 1000;
        const before = await revision();
        const bobBefore = await revision('bob');
        const result = await runClipboardCleanup(db, images, now);
        assert.ok(result.textDeleted > 0);
        assert.ok((await revision()) > before);
        assert.equal(await revision('bob'), bobBefore);
        await db.prepare("DELETE FROM preferences WHERE owner='alice'").run();
      },
    );

    let picture: ClipboardImage;
    const imageId = crypto.randomUUID();
    await t.test(
      'image create is idempotent and stores the bytes once',
      async () => {
        let created: Response;
        await moves(async () => {
          created = await call(`images/${imageId}?name=Receipt.png`, 'PUT', png);
        });
        assert.equal(created!.status, 201);
        picture = (await created!.json()) as ClipboardImage;
        assert.equal(picture.id, imageId);
        assert.equal(picture.name, 'Receipt.png');
        assert.equal(picture.width, 1);
        const replay = await call(`images/${imageId}?name=Other.png`, 'PUT', png);
        assert.equal(replay.status, 200);
        assert.equal(((await replay.json()) as ClipboardImage).name, 'Receipt.png');
        // Two requests racing on a new identifier also leave one image.
        const racing = crypto.randomUUID();
        const both = await Promise.all([
          call(`images/${racing}`, 'PUT', png),
          call(`images/${racing}`, 'PUT', png),
        ]);
        assert.deepEqual(
          both.map((r) => r.status).sort((x, y) => x - y),
          [200, 201],
        );
        assert.equal((await bucket.list()).objects.length, 2);
        assert.equal(
          (
            await db
              .prepare(
                "SELECT COUNT(*) AS n FROM clipboard_images WHERE owner='alice'",
              )
              .first<{ n: number }>()
          )?.n,
          2,
        );
        await call(`images/${racing}`, 'DELETE');
        assert.equal((await bucket.list()).objects.length, 1);
      },
    );

    await t.test(
      'image metadata, bytes, pin and isolation',
      async () => {
        const metadata = await call(`images/${imageId}`);
        assert.equal(metadata.headers.get('Content-Type'), 'application/json');
        assert.deepEqual(await metadata.json(), picture);
        const file = await call(`images/${imageId}/file`);
        assert.equal(file.headers.get('Content-Type'), 'image/png');
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), png);
        for (const path of [`images/${imageId}`, `images/${imageId}/file`])
          assert.equal((await call(path, 'GET', undefined, 'bob')).status, 404);
        const taken = await call(`images/${imageId}`, 'PUT', png, 'bob');
        assert.equal(taken.status, 409);
        assert.equal((await bucket.list()).objects.length, 1);
        await moves(async () => {
          const pinned = await call(`images/${imageId}`, 'PATCH', {
            pinned: true,
          });
          assert.equal(((await pinned.json()) as ClipboardImage).pinned, true);
        });
        assert.equal(
          (await call(`images/${imageId}`, 'PUT', png, 'alice', 'https://evil.test'))
            .status,
          403,
        );
        assert.equal(
          (await call(`images/${crypto.randomUUID()}`, 'PUT', { not: 'png' }))
            .status,
          415,
        );
      },
    );

    await t.test(
      'images page by cursor and a deleted identifier can be reused safely',
      async () => {
        const ids = [imageId];
        for (let i = 0; i < 3; i++) {
          const id = crypto.randomUUID();
          ids.push(id);
          await call(`images/${id}?name=Shot%20${i}.png`, 'PUT', png);
          await db
            .prepare('UPDATE clipboard_images SET created_at=? WHERE id=?')
            .bind(Date.now() + 1000 * (i + 1), id)
            .run();
        }
        const first = (await (
          await call('images?limit=2')
        ).json()) as ImagePage;
        assert.deepEqual(
          first.items.map((item) => item.name),
          ['Shot 2.png', 'Shot 1.png'],
        );
        assert.equal(first.revision, await revision());
        await call(`images/${first.items[0].id}`, 'DELETE');
        const second = (await (
          await call(`images?limit=2&cursor=${first.nextCursor}`)
        ).json()) as ImagePage;
        assert.deepEqual(
          second.items.map((item) => item.name),
          ['Shot 0.png', 'Receipt.png'],
        );
        assert.equal(second.nextCursor, null);
        assert.equal(
          ((await (await call('images?pinned=true')).json()) as ImagePage).items
            .length,
          1,
        );
        // Delete, leaving the old file queued (as after a storage outage),
        // then save a new image under the same identifier.
        const oldKey = (await db
          .prepare('SELECT object_key FROM clipboard_images WHERE id=?')
          .bind(imageId)
          .first<{ object_key: string }>())!.object_key;
        await moves(() => db.prepare('DELETE FROM clipboard_images WHERE id=?').bind(imageId).run());
        assert.ok(
          await db
            .prepare(
              'SELECT 1 FROM clipboard_image_deletion_queue WHERE object_key=?',
            )
            .bind(oldKey)
            .first(),
        );
        const again = await call(`images/${imageId}?name=Again.png`, 'PUT', png);
        assert.equal(again.status, 201);
        const newKey = (await db
          .prepare('SELECT object_key FROM clipboard_images WHERE id=?')
          .bind(imageId)
          .first<{ object_key: string }>())!.object_key;
        assert.notEqual(newKey, oldKey);
        // Draining the queue removes only the old file.
        await runClipboardCleanup(db, images, 0);
        assert.equal(await bucket.head(oldKey), null);
        assert.ok(await bucket.head(newKey));
        assert.equal((await call(`images/${imageId}/file`)).status, 200);
      },
    );

    await t.test(
      'the image budget is enforced atomically and leaves no stray file',
      async () => {
        const objects = (await bucket.list()).objects.length;
        await db
          .prepare(
            "INSERT INTO clipboard_images (id,owner,name,object_key,size,width,height,created_at) VALUES ('budget-filler','carol','Filler','clipboard/none.png',?,1,1,0)",
          )
          .bind(IMAGE_ACCOUNT_LIMIT - png.length)
          .run();
        const statuses = (
          await Promise.all([
            call(`images/${crypto.randomUUID()}`, 'PUT', png, 'carol'),
            call(`images/${crypto.randomUUID()}`, 'PUT', png, 'carol'),
          ])
        ).map((r) => r.status);
        assert.deepEqual(
          statuses.sort((x, y) => x - y),
          [201, 409],
        );
        assert.equal((await bucket.list()).objects.length, objects + 1);
        // The browser upload route shares the same budget.
        const legacy = await handleAPI(
          new Request('https://do.test/api/images', {
            method: 'POST',
            headers: { Origin: 'https://do.test', 'Content-Type': 'image/png' },
            body: png,
          }),
          { db, images, owner: 'carol' },
        );
        assert.equal(legacy.status, 409);
        assert.equal((await bucket.list()).objects.length, objects + 1);
        // Another account is unaffected.
        assert.equal(
          (await call(`images/${crypto.randomUUID()}`, 'PUT', png, 'dave')).status,
          201,
        );
      },
    );
  } finally {
    await mf.dispose();
  }
});
