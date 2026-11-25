import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import {
  contentLink,
  CONTENT_FILE_LIMIT,
  CONTENT_ACCOUNT_LIMIT,
} from '../lib/content-model';
import { contentRange } from '../lib/content';

void test('Content links and range syntax reject unsafe or ambiguous values', () => {
  assert.equal(
    contentLink('https://docs.google.com/document/d/synthetic/edit'),
    'https://docs.google.com/document/d/synthetic/edit',
  );
  assert.equal(
    contentLink('https://docs.google.com/spreadsheets/d/synthetic/edit#gid=0'),
    'https://docs.google.com/spreadsheets/d/synthetic/edit#gid=0',
  );
  for (const value of [
    'http://docs.google.com/document/d/a',
    'javascript:alert(1)',
    'https://docs.google.com.evil.test/document/d/a',
    'https://evil.test/document/d/a',
    'https://user:pass@docs.google.com/document/d/a',
    'https://docs.google.com:444/document/d/a',
    'https://docs.google.com/document',
    'https://docs.google.com/document/d/',
    'https://docs.google.com/document/d/a' + 'x'.repeat(2048),
  ])
    assert.throws(() => contentLink(value));
  assert.deepEqual(contentRange('bytes=3-', 10), { offset: 3, length: 7 });
  assert.deepEqual(contentRange('bytes=-3', 10), { offset: 7, length: 3 });
  assert.deepEqual(contentRange('bytes=0-99', 10), { offset: 0, length: 10 });
  for (const value of [
    'bytes=10-',
    'bytes=8-2',
    'bytes=0-2,5-7',
    'bytes=-0',
    'bytes=-',
    'bytes=a-',
    'items=0-1',
    'bytes=99999999999999999-',
  ])
    assert.throws(() => contentRange(value, 10));
});

void test('Content API uses real Worker streams, D1, R2 and application sessions', async (t) => {
  const bundle = await build({
    stdin: {
      contents: `
    import { handleWorkspaceRequest } from './lib/workspace-request';
    import { getAppAuth } from './lib/app-auth';
    import { resolveUser } from './lib/identity';
    import { handleAPI } from './lib/server';
    import { runContentCleanup } from './lib/content';
    export default {
      async fetch(request,env) {
        if(request.headers.has('X-Test-Declared-Length')) { const headers=new Headers(request.headers);headers.set('Content-Length',request.headers.get('X-Test-Declared-Length'));request=new Request(request,{headers}); }
        if(new URL(request.url).pathname.startsWith('/api/auth/')) return (await getAppAuth(env)).handler(request);
        if(request.headers.has('X-Test-Storage-Failure')) {
          const user=await resolveUser(env,request.headers);
          const failure=request.headers.get('X-Test-Storage-Failure');
          const store={
            put:(...args)=>failure==='put' ? Promise.reject(new Error('Synthetic R2 outage')) : env.IMAGES.put(...args),
            get:(...args)=>env.IMAGES.get(...args), head:(...args)=>env.IMAGES.head(...args),
            delete:(...args)=>failure==='delete' ? Promise.reject(new Error('Synthetic R2 outage')) : env.IMAGES.delete(...args),
          };
          return handleAPI(request,{db:env.DB,owner:user?.userId ?? '',content:store});
        }
        if(request.headers.has('X-Test-Replace-Before-Claim')) {
          // Between this upload reading its reservation and claiming it, the
          // reservation is replaced by one with the same identifier and a new
          // object key, as a delete followed by a fresh reserve would do.
          const user=await resolveUser(env,request.headers);
          const db={
            batch:(...args)=>env.DB.batch(...args),
            prepare:(sql)=>{
              const real=env.DB.prepare(sql);
              if(!sql.includes("SET state='writing'")) return real;
              return {bind:(...args)=>({first:async()=>{
                await env.DB.prepare("UPDATE content_items SET object_key='content/replacement-' || id WHERE id=?").bind(args[1]).run();
                return real.bind(...args).first();
              }})};
            },
          };
          return handleAPI(request,{db,owner:user?.userId ?? '',content:env.IMAGES});
        }
        return handleWorkspaceRequest(request,env);
      },
      async scheduled(controller,env){await runContentCleanup(env.DB,env.IMAGES,controller.scheduledTime);}
    };`,
      resolveDir: process.cwd(),
      sourcefile: 'content-test-worker.ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['node:*'],
  });
  const mf = new Miniflare({
    modules: [
      {
        type: 'ESModule',
        path: process.cwd() + '/content-test-worker.mjs',
        contents: bundle.outputFiles[0].text,
      },
    ],
    compatibilityDate: '2026-05-22',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['IMAGES'],
    bindings: {
      BETTER_AUTH_URL: 'https://content.test',
      BETTER_AUTH_SECRET: 'synthetic-content-test-secret-32-characters',
    },
  });
  const origin = 'https://content.test';
  try {
    const db = await mf.getD1Database('DB'),
      bucket = await mf.getR2Bucket('IMAGES');
    for (const file of readdirSync(new URL('../drizzle/', import.meta.url))
      .filter((f) => f.endsWith('.sql'))
      .sort())
      for (const sql of readFileSync(
        new URL('../drizzle/' + file, import.meta.url),
        'utf8',
      ).split('--> statement-breakpoint'))
        if (sql.trim()) await db.prepare(sql.trim()).run();
    async function signup(username: string) {
      const response = await mf.dispatchFetch(
        origin + '/api/auth/sign-up/email',
        {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            email: `${username}@example.test`,
            name: username,
            password: 'synthetic-content-password',
          }),
        },
      );
      assert.equal(response.status, 200, await response.clone().text());
      const data = (await response.json()) as { user: { id: string } };
      return {
        owner: data.user.id,
        cookie: response.headers
          .getSetCookie()
          .map((v) => v.split(';')[0])
          .join('; '),
      };
    }
    const alice = await signup('contentalice'),
      bob = await signup('contentbob');
    const call = (
      path: string,
      method = 'GET',
      body?: unknown,
      cookie = alice.cookie,
      extra: Record<string, string> = {},
    ) =>
      mf.dispatchFetch(origin + '/api/' + path, {
        method,
        headers: {
          Origin: origin,
          Cookie: cookie,
          ...(body instanceof Uint8Array
            ? {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(body.length),
              }
            : { 'Content-Type': 'application/json' }),
          ...extra,
        },
        ...(body === undefined
          ? {}
          : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
      });
    const reserve = async (
      name = 'synthetic.mp3',
      size = 16,
      mime = 'audio/mpeg',
    ) => {
      const response = await call('content', 'POST', {
        kind: 'file',
        name,
        filename: name,
        size,
        mime,
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as { id: string; mime: string };
    };
    let saved: { id: string; mime: string };
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
    await t.test(
      'signed-in and same-origin access required before reservations or uploads',
      async () => {
        assert.equal((await call('content', 'GET', undefined, '')).status, 401);
        assert.equal(
          (
            await call(
              'content',
              'POST',
              { kind: 'file', name: 'test', filename: 'test', size: 10 },
              '',
              {},
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await call(
              'content',
              'POST',
              {
                kind: 'link',
                name: 'test',
                url: 'https://docs.google.com/document/d/test',
              },
              alice.cookie,
              { Origin: 'https://evil.test' },
            )
          ).status,
          403,
        );
        assert.equal((await bucket.list()).objects.length, 0);
      },
    );
    await t.test(
      'reservation is hidden, streaming upload publishes immutable MP3 and full/range/HEAD reads work',
      async () => {
        saved = await reserve();
        assert.equal(
          ((await (await call('content')).json()) as { items: unknown[] }).items
            .length,
          0,
        );
        assert.equal((await call(`content/${saved.id}/file`)).status, 404);
        const response = await call(`content/${saved.id}/file`, 'PUT', bytes);
        assert.equal(response.status, 200, await response.clone().text());
        const full = await call(`content/${saved.id}/file`);
        assert.equal(full.status, 200);
        assert.equal(full.headers.get('Content-Type'), 'audio/mpeg');
        assert.equal(full.headers.get('Content-Length'), '16');
        assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
        assert.equal(full.headers.get('Cache-Control'), 'private, no-store');
        assert.equal(full.headers.get('X-Content-Type-Options'), 'nosniff');
        assert.match(full.headers.get('Content-Disposition')!, /^inline;/);
        assert.deepEqual(new Uint8Array(await full.arrayBuffer()), bytes);
        for (const [range, start, end] of [
          ['bytes=2-5', 2, 5],
          ['bytes=12-', 12, 15],
          ['bytes=-4', 12, 15],
          ['bytes=14-99', 14, 15],
        ] as const) {
          const part = await call(
            `content/${saved.id}/file`,
            'GET',
            undefined,
            alice.cookie,
            { Range: range },
          );
          assert.equal(part.status, 206);
          assert.equal(
            part.headers.get('Content-Range'),
            `bytes ${start}-${end}/16`,
          );
          assert.equal(
            part.headers.get('Content-Length'),
            String(end - start + 1),
          );
          assert.deepEqual(
            new Uint8Array(await part.arrayBuffer()),
            bytes.slice(start, end + 1),
          );
        }
        for (const range of ['bytes=16-', 'bytes=0-2,5-7', 'bytes=8-2']) {
          const invalid = await call(
            `content/${saved.id}/file`,
            'GET',
            undefined,
            alice.cookie,
            { Range: range },
          );
          assert.equal(invalid.status, 416);
          assert.equal(invalid.headers.get('Content-Range'), 'bytes */16');
        }
        const head = await call(`content/${saved.id}/file`, 'HEAD');
        assert.equal(head.status, 200);
        assert.equal(head.headers.get('Content-Length'), '16');
        assert.equal(await head.text(), '');
        const changed = await call(
          `content/${saved.id}/file`,
          'GET',
          undefined,
          alice.cookie,
          { Range: 'bytes=0-2', 'If-Range': '"old"' },
        );
        assert.equal(changed.status, 200);
        await changed.arrayBuffer();
        const download = await call(`content/${saved.id}/file?download=1`);
        assert.match(
          download.headers.get('Content-Disposition')!,
          /^attachment;/,
        );
        await download.arrayBuffer();
        assert.equal(
          (await call(`content/${saved.id}/file`, 'PUT', bytes)).status,
          409,
        );
      },
    );
    await t.test(
      'cross-account read, upload, pin, delete and listing cannot access content',
      async () => {
        for (const [suffix, method, body] of [
          ['/file', 'GET', undefined],
          ['/file', 'HEAD', undefined],
          ['/file', 'PUT', bytes],
          ['', 'PATCH', { pinned: true }],
          ['', 'DELETE', undefined],
        ] as const)
          assert.equal(
            (
              await call(
                `content/${saved.id}${suffix}`,
                method,
                body,
                bob.cookie,
              )
            ).status,
            404,
          );
        assert.equal(
          (
            (await (
              await call('content', 'GET', undefined, bob.cookie)
            ).json()) as { items: unknown[] }
          ).items.length,
          0,
        );
        assert.ok(await bucket.head(`content/${saved.id}`));
      },
    );
    await t.test(
      'size/header enforcement and failed streaming writes leave durable cleanup, never a visible file',
      async () => {
        for (const size of [0, -1, CONTENT_FILE_LIMIT + 1, 1.2])
          assert.equal(
            (
              await call('content', 'POST', {
                kind: 'file',
                name: 'test',
                filename: 'test',
                size,
              })
            ).status,
            413,
          );
        const max = await reserve('boundary.bin', CONTENT_FILE_LIMIT);
        assert.equal((await call(`content/${max.id}`, 'DELETE')).status, 200);
        const failure = await reserve('failure.mp4', 16, 'video/mp4');
        const invalid = await call(
          `content/${failure.id}/file`,
          'PUT',
          bytes,
          alice.cookie,
          { 'Content-Type': 'text/html' },
        );
        assert.equal(invalid.status, 400);
        const failed = await call(
          `content/${failure.id}/file`,
          'PUT',
          bytes,
          alice.cookie,
          { 'X-Test-Storage-Failure': 'put' },
        );
        assert.equal(failed.status, 400, await failed.clone().text());
        assert.equal(
          await db
            .prepare('SELECT id FROM content_items WHERE id=?')
            .bind(failure.id)
            .first(),
          null,
        );
        assert.equal(await bucket.head(`content/${failure.id}`), null);
        for (const length of [15, 17]) {
          const exact = await reserve('exact-length.bin', 16);
          const response = await call(
            `content/${exact.id}/file`,
            'PUT',
            new Uint8Array(length),
            alice.cookie,
            { 'X-Test-Declared-Length': '16' },
          );
          assert.equal(response.status, 400, await response.clone().text());
          assert.equal(
            await db
              .prepare('SELECT id FROM content_items WHERE id=?')
              .bind(exact.id)
              .first(),
            null,
          );
          assert.equal(await bucket.head(`content/${exact.id}`), null);
        }
        const streamed = await reserve('streamed.bin', 2_000_000);
        const large = new Uint8Array(2_000_000);
        large[0] = 12;
        large[large.length - 1] = 34;
        assert.equal(
          (await call(`content/${streamed.id}/file`, 'PUT', large)).status,
          200,
        );
        const tail = await call(
          `content/${streamed.id}/file`,
          'GET',
          undefined,
          alice.cookie,
          { Range: 'bytes=-1' },
        );
        assert.deepEqual(
          new Uint8Array(await tail.arrayBuffer()),
          Uint8Array.of(34),
        );
        const mismatch = await reserve('mismatch.bin', 15);
        assert.equal(
          (await call(`content/${mismatch.id}/file`, 'PUT', bytes)).status,
          400,
        );
        await call(`content/${mismatch.id}`, 'DELETE');
      },
    );
    await t.test(
      'unsafe and mislabeled types always download opaque bytes; MP4 playback uses correct type',
      async () => {
        for (const [name, mime, expected] of [
          ['evil.html', 'text/html', 'application/octet-stream'],
          ['evil.svg', 'image/svg+xml', 'application/octet-stream'],
          ['fake.html', 'video/mp4', 'application/octet-stream'],
          ['movie.mp4', 'video/mp4', 'video/mp4'],
        ] as const) {
          const item = await reserve(name, 16, mime);
          assert.equal(item.mime, expected);
          assert.equal(
            (await call(`content/${item.id}/file`, 'PUT', bytes)).status,
            200,
          );
          const response = await call(`content/${item.id}/file`);
          assert.equal(response.headers.get('Content-Type'), expected);
          assert.match(
            response.headers.get('Content-Disposition')!,
            expected === 'video/mp4' ? /^inline;/ : /^attachment;/,
          );
          assert.match(
            response.headers.get('Content-Security-Policy')!,
            /sandbox/,
          );
          await response.arrayBuffer();
        }
      },
    );
    await t.test(
      'Google links, search and pins preserve provider URLs and reject unsafe hosts',
      async () => {
        const response = await call('content', 'POST', {
          kind: 'link',
          name: 'Synthetic Sheet',
          url: 'https://docs.google.com/spreadsheets/d/fixture/edit#gid=0',
        });
        assert.equal(response.status, 201);
        const link = (await response.json()) as { id: string; url: string };
        assert.match(link.url, /#gid=0$/);
        assert.equal(
          (await call(`content/${link.id}`, 'PATCH', { pinned: true })).status,
          200,
        );
        const filtered = (await (
          await call('content?q=sheet&pinned=true')
        ).json()) as { items: { id: string }[] };
        assert.deepEqual(
          filtered.items.map((i) => i.id),
          [link.id],
        );
        assert.equal(
          (
            await call('content', 'POST', {
              kind: 'link',
              name: 'Bad',
              url: 'https://evil.test/spreadsheets/d/a',
            })
          ).status,
          400,
        );
        assert.equal((await call(`content/${link.id}/file`)).status, 404);
        assert.equal((await call(`content/${link.id}`, 'DELETE')).status, 200);
      },
    );
    await t.test(
      'parallel reservations cannot exceed quota, including deletion bytes and link item limits',
      async () => {
        for (let i = 0; i < 40; i++)
          await db
            .prepare(
              "INSERT INTO content_items(id,owner,kind,name,size,created_at,state) VALUES (?,?,'file','Synthetic quota',?,0,'ready')",
            )
            .bind(
              `quota${i}`,
              bob.owner,
              i === 39 ? CONTENT_FILE_LIMIT - 16 : CONTENT_FILE_LIMIT,
            )
            .run();
        const body = {
          kind: 'file',
          name: 'Quota test',
          filename: 'q.bin',
          size: 12,
        };
        const responses = await Promise.all([
          call('content', 'POST', body, bob.cookie),
          call('content', 'POST', body, bob.cookie),
        ]);
        assert.deepEqual(
          responses.map((r) => r.status).sort((a, b) => a - b),
          [201, 409],
        );
        const usage = (await (
          await call('content', 'GET', undefined, bob.cookie)
        ).json()) as { usedBytes: number };
        assert.ok(usage.usedBytes <= CONTENT_ACCOUNT_LIMIT);
        await db
          .prepare('DELETE FROM content_items WHERE owner=?')
          .bind(bob.owner)
          .run();
        await db
          .prepare(
            'INSERT INTO content_deletion_queue(object_key,owner,size) VALUES (?,?,?)',
          )
          .bind(
            'content/synthetic-pending',
            bob.owner,
            CONTENT_ACCOUNT_LIMIT - 4,
          )
          .run();
        assert.equal(
          (await call('content', 'POST', body, bob.cookie)).status,
          409,
        );
        await db
          .prepare('DELETE FROM content_deletion_queue WHERE owner=?')
          .bind(bob.owner)
          .run();
        for (let i = 0; i < 500; i++)
          await db
            .prepare(
              "INSERT INTO content_items(id,owner,kind,name,url,created_at,state) VALUES (?,?,'link','Synthetic item cap','https://docs.google.com/document/d/fixture',0,'ready')",
            )
            .bind(`cap${i}`, bob.owner)
            .run();
        assert.equal(
          (
            await call(
              'content',
              'POST',
              {
                kind: 'link',
                name: 'Too many',
                url: 'https://docs.google.com/document/d/test',
              },
              bob.cookie,
            )
          ).status,
          409,
        );
        await db
          .prepare('DELETE FROM content_items WHERE owner=?')
          .bind(bob.owner)
          .run();
      },
    );
    await t.test(
      'delete retry retains quota; scheduled cleanup removes abandoned uploads and preserves old ready items',
      async () => {
        const deletion = await call(
          `content/${saved.id}`,
          'DELETE',
          undefined,
          alice.cookie,
          { 'X-Test-Storage-Failure': 'delete' },
        );
        assert.equal(deletion.status, 200);
        assert.equal(
          ((await deletion.json()) as { cleanupPending: boolean })
            .cleanupPending,
          true,
        );
        assert.equal((await call(`content/${saved.id}/file`)).status, 404);
        assert.ok(await bucket.head(`content/${saved.id}`));
        assert.ok(
          await db
            .prepare('SELECT * FROM content_deletion_queue WHERE object_key=?')
            .bind(`content/${saved.id}`)
            .first(),
        );
        const unfinished = await reserve('abandoned.bin', 16);
        await bucket.put(`content/${unfinished.id}`, bytes);
        await db
          .prepare('UPDATE content_items SET expires_at=1 WHERE id=?')
          .bind(unfinished.id)
          .run();
        await db
          .prepare("UPDATE content_items SET created_at=1 WHERE state='ready'")
          .run();
        const worker = await mf.getWorker();
        await worker.scheduled({
          scheduledTime: new Date(),
          cron: '0 8 * * *',
        });
        assert.equal(await bucket.head(`content/${saved.id}`), null);
        assert.equal(await bucket.head(`content/${unfinished.id}`), null);
        assert.equal(
          await db
            .prepare('SELECT id FROM content_items WHERE id=?')
            .bind(unfinished.id)
            .first(),
          null,
        );
        assert.ok(
          (await db
            .prepare(
              "SELECT COUNT(*) AS n FROM content_items WHERE state='ready'",
            )
            .first<{ n: number }>())!.n > 0,
        );
        assert.equal(
          (await db
            .prepare('SELECT COUNT(*) AS n FROM content_deletion_queue')
            .first<{ n: number }>())!.n,
          0,
        );
      },
    );
    await t.test(
      '/api/v1 documents: idempotent reservation, upload status, repeatable upload and cursor pages',
      async () => {
        type Doc = { id: string; name: string; state: string };
        type DocPage = {
          items: Doc[];
          nextCursor: string | null;
          revision: number;
          usedBytes: number;
          itemLimit: number;
        };
        const revision = async () =>
          ((await (await call('v1/revision')).json()) as { revision: number })
            .revision;
        const keyOf = async (id: string) =>
          (
            await db
              .prepare('SELECT object_key FROM content_items WHERE id=?')
              .bind(id)
              .first<{ object_key: string }>()
          )?.object_key;
        const docId = crypto.randomUUID();
        const reservation = {
          id: docId,
          kind: 'file',
          name: 'scan.pdf',
          filename: 'scan.pdf',
          size: 16,
        };
        const start = await revision();
        const first = await call('v1/documents', 'POST', reservation);
        assert.equal(first.status, 201, await first.clone().text());
        const reserved = (await first.json()) as Doc;
        assert.equal(reserved.id, docId);
        assert.equal(reserved.state, 'uploading');
        assert.ok((await revision()) > start);
        // Repeating the reservation returns it instead of making a second one.
        const again = await call('v1/documents', 'POST', reservation);
        assert.equal(again.status, 200);
        assert.equal(((await again.json()) as Doc).state, 'uploading');
        assert.equal(
          (
            await db
              .prepare('SELECT COUNT(*) AS n FROM content_items WHERE id=?')
              .bind(docId)
              .first<{ n: number }>()
          )?.n,
          1,
        );
        // Another account can neither take nor learn about the identifier.
        assert.equal(
          (await call('v1/documents', 'POST', reservation, bob.cookie)).status,
          409,
        );
        assert.equal(
          (await call(`v1/documents/${docId}`, 'GET', undefined, bob.cookie))
            .status,
          404,
        );
        // Upload status, before and after.
        assert.equal(
          ((await (await call(`v1/documents/${docId}`)).json()) as Doc).state,
          'uploading',
        );
        assert.equal((await call(`v1/documents/${docId}/file`)).status, 404);
        const beforeUpload = await revision();
        const put = await call(`v1/documents/${docId}/file`, 'PUT', bytes);
        assert.equal(put.status, 200, await put.clone().text());
        assert.equal(((await put.json()) as Doc).state, 'ready');
        assert.ok((await revision()) > beforeUpload);
        // A client that lost that response can send the upload again.
        const replay = await call(`v1/documents/${docId}/file`, 'PUT', bytes);
        assert.equal(replay.status, 200);
        assert.equal(((await replay.json()) as Doc).state, 'ready');
        assert.equal(
          ((await (await call(`v1/documents/${docId}`)).json()) as Doc).state,
          'ready',
        );
        // The browser route keeps refusing a second upload, and its item
        // shape has no state field.
        assert.equal(
          (await call(`content/${docId}/file`, 'PUT', bytes)).status,
          409,
        );
        const legacy = (await (await call('content')).json()) as {
          items: Record<string, unknown>[];
        };
        assert.ok(legacy.items.some((item) => item.id === docId));
        assert.ok(legacy.items.every((item) => !('state' in item)));
        // The file is not stored under the client's identifier.
        const key = (await keyOf(docId))!;
        assert.notEqual(key, `content/${docId}`);
        assert.equal(await bucket.head(`content/${docId}`), null);
        assert.ok(await bucket.head(key));
        const file = await call(`v1/documents/${docId}/file`);
        assert.equal(file.status, 200);
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
        assert.equal(
          (
            await call(`v1/documents/${docId}/file`, 'GET', undefined, alice.cookie, {
              Range: 'bytes=0-3',
            })
          ).status,
          206,
        );

        // A failed upload removes the reservation. Reserving the same
        // identifier again gets a new storage key, so cleanup of the failed
        // attempt can never delete the retried file.
        const retryId = crypto.randomUUID();
        const retry = { ...reservation, id: retryId, name: 'retry.pdf' };
        assert.equal((await call('v1/documents', 'POST', retry)).status, 201);
        const failedKey = (await keyOf(retryId))!;
        assert.equal(
          (
            await call(`v1/documents/${retryId}/file`, 'PUT', bytes, alice.cookie, {
              'X-Test-Storage-Failure': 'put',
            })
          ).status,
          400,
        );
        assert.equal((await call(`v1/documents/${retryId}`)).status, 404);
        assert.equal((await call('v1/documents', 'POST', retry)).status, 201);
        const retriedKey = (await keyOf(retryId))!;
        assert.notEqual(retriedKey, failedKey);
        assert.equal(
          (await call(`v1/documents/${retryId}/file`, 'PUT', bytes)).status,
          200,
        );
        assert.ok(await bucket.head(retriedKey));

        // An upload must not claim a reservation that replaced the one it
        // read. Otherwise the replacement is marked ready with no file behind
        // it and every later download fails.
        const racedId = crypto.randomUUID();
        const raced = { ...reservation, id: racedId, name: 'raced.pdf' };
        assert.equal((await call('v1/documents', 'POST', raced)).status, 201);
        const replacedKey = (await keyOf(racedId))!;
        const lost = await call(
          `v1/documents/${racedId}/file`,
          'PUT',
          bytes,
          alice.cookie,
          { 'X-Test-Replace-Before-Claim': '1' },
        );
        assert.equal(lost.status, 409, await lost.clone().text());
        const replacementKey = (await keyOf(racedId))!;
        assert.equal(replacementKey, `content/replacement-${racedId}`);
        assert.equal(await bucket.head(replacedKey), null);
        assert.equal(await bucket.head(replacementKey), null);
        // The replacement is untouched and still waiting for its own upload.
        assert.equal(
          ((await (await call(`v1/documents/${racedId}`)).json()) as Doc).state,
          'uploading',
        );
        assert.equal(
          (await call(`v1/documents/${racedId}/file`, 'PUT', bytes)).status,
          200,
        );
        assert.ok(await bucket.head(replacementKey));
        const racedFile = await call(`v1/documents/${racedId}/file`);
        assert.equal(racedFile.status, 200);
        assert.deepEqual(new Uint8Array(await racedFile.arrayBuffer()), bytes);

        // Cursor pages stay complete when an earlier item is deleted.
        const linkIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const id = crypto.randomUUID();
          linkIds.push(id);
          const link = await call('v1/documents', 'POST', {
            id,
            kind: 'link',
            name: `Link ${i}`,
            url: 'https://docs.google.com/document/d/fixture' + i,
          });
          assert.equal(link.status, 201, await link.clone().text());
          assert.equal(((await link.json()) as Doc).state, 'ready');
          await db
            .prepare('UPDATE content_items SET created_at=? WHERE id=?')
            .bind(Date.now() + 60000 * (i + 1), id)
            .run();
        }
        const pageOne = (await (
          await call('v1/documents?limit=2')
        ).json()) as DocPage;
        assert.deepEqual(
          pageOne.items.map((item) => item.name),
          ['Link 2', 'Link 1'],
        );
        assert.ok(pageOne.nextCursor);
        assert.equal(pageOne.revision, await revision());
        assert.ok(pageOne.usedBytes >= 32);
        assert.equal(pageOne.itemLimit, 500);
        const beforeDelete = await revision();
        assert.equal(
          (await call(`v1/documents/${linkIds[2]}`, 'DELETE')).status,
          200,
        );
        assert.ok((await revision()) > beforeDelete);
        const pageTwo = (await (
          await call(`v1/documents?limit=2&cursor=${pageOne.nextCursor}`)
        ).json()) as DocPage;
        assert.equal(pageTwo.items[0].name, 'Link 0');
        assert.equal((await call('v1/documents?cursor=garbage')).status, 400);
        const pinned = await call(`v1/documents/${docId}`, 'PATCH', {
          pinned: true,
        });
        assert.equal(pinned.status, 200);
        assert.equal(
          (
            (await (await call('v1/documents?pinned=true')).json()) as DocPage
          ).items.some((item) => item.id === docId),
          true,
        );

        // The deletion queue drains past one page, and past a stuck entry.
        for (let i = 0; i < 150; i++)
          await db
            .prepare(
              'INSERT INTO content_deletion_queue(object_key,owner,size) VALUES (?,?,1)',
            )
            .bind(`content/synthetic-${String(i).padStart(3, '0')}`, alice.owner)
            .run();
        const worker = await mf.getWorker();
        await worker.scheduled({ scheduledTime: new Date(), cron: '0 8 * * *' });
        assert.equal(
          (await db
            .prepare('SELECT COUNT(*) AS n FROM content_deletion_queue')
            .first<{ n: number }>())!.n,
          0,
        );
        assert.ok(await bucket.head(key));
      },
    );
    await t.test(
      'session revocation immediately prevents Content access',
      async () => {
        await db
          .prepare('DELETE FROM auth_session WHERE user_id=?')
          .bind(alice.owner)
          .run();
        assert.equal((await call('content')).status, 401);
      },
    );
  } finally {
    await mf.dispose();
  }
});
