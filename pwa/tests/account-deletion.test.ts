import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { getAppAuth } from '../lib/app-auth';
import { handleAccountDeletion } from '../lib/account-deletion';
import {
  createPile,
  updatePile,
  readPileDeletionImpact,
  deletePile,
} from '../lib/piles';

const origin = 'https://do.example';
const workspaceTables = [
  'clips',
  'clipboard_images',
  'content_items',
  'preferences',
  'workspace_tools',
  'usage',
  'workspace_revision',
  'piles',
  'pile_members',
  'pile_operations',
  'item_deletions',
];

void test('account deletion removes one account completely and nothing else', async (t) => {
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
    const config = {
      DB: db,
      IMAGES: bucket as unknown as R2Bucket,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: 'synthetic-deletion-secret-at-least-32-characters',
    };
    const auth = await getAppAuth(config);
    let address = 10;
    async function signup(name: string) {
      const response = await auth.handler(
        new Request(origin + '/api/auth/sign-up/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: origin,
            'cf-connecting-ip': `192.0.2.${address++}`,
          },
          body: JSON.stringify({
            username: name,
            name,
            email: `${name}@example.test`,
            password: 'synthetic-deletion-password',
          }),
        }),
      );
      assert.equal(response.status, 200, await response.clone().text());
      const data = (await response.json()) as { user: { id: string } };
      return {
        id: data.user.id,
        email: `${name}@example.test`,
        cookie: response.headers
          .getSetCookie()
          .map((c) => c.split(';')[0])
          .join('; '),
      };
    }
    // One of everything an account can own, with real files behind it.
    async function fill(owner: string, tag: string) {
      await bucket.put(`clipboard/${tag}.png`, 'image bytes');
      await bucket.put(`content/${tag}`, 'document bytes');
      await db.batch([
        db
          .prepare(
            "INSERT INTO clips (id,owner,title,kind,content,original,context,segments,versions,collection,tags,pinned,revision,created_at,updated_at,clipboard_item) VALUES (?,?,'T','note','c','c','','[]','[]','','[]',1,1,1,1,0)",
          )
          .bind(`clip-${tag}-0001`, owner),
        db
          .prepare(
            "INSERT INTO clipboard_images (id,owner,name,object_key,size,width,height,created_at,pinned) VALUES (?,?,'I',?,11,1,1,1,1)",
          )
          .bind(`image-${tag}-0001`, owner, `clipboard/${tag}.png`),
        db
          .prepare(
            "INSERT INTO content_items (id,owner,kind,name,filename,size,object_key,created_at,state,pinned) VALUES (?,?,'file','D','d.pdf',14,?,1,'ready',1)",
          )
          .bind(`doc-${tag}-0001`, owner, `content/${tag}`),
        db
          .prepare(
            "INSERT INTO preferences (owner,encrypted_key,consent,clipboard_daily_cleanup) VALUES (?,'legacy-ciphertext',1,1)",
          )
          .bind(owner),
        db
          .prepare(
            "INSERT INTO workspace_tools (owner,data,revision) VALUES (?,'{}',2)",
          )
          .bind(owner),
        db
          .prepare('INSERT INTO usage (owner,window,count) VALUES (?,1,1)')
          .bind(owner),
      ]);
      await db.batch([
        db
          .prepare(
            'INSERT INTO piles(id,owner,name,updated_at) VALUES (?,?,?,0)',
          )
          .bind(`pile-${tag}-0001`, owner, 'Errands'),
        db
          .prepare(
            "INSERT INTO pile_members VALUES (?,?,'text',?,0,1,'operation-0001')",
          )
          .bind(`pile-${tag}-0001`, owner, `clip-${tag}-0001`),
        db
          .prepare(
            "INSERT INTO pile_operations VALUES (?, 'operation-0001', ?, '{}', '{}')",
          )
          .bind(owner, `pile-${tag}-0001`),
        db
          .prepare(
            "INSERT INTO item_deletions VALUES (?,'text','gone-0001','cleared',0)",
          )
          .bind(owner),
      ]);
      // Real P1 receipts, including a deleted pile whose receipts outlive it.
      const created = await createPile(db, owner, {
        operationId: crypto.randomUUID(),
        name: 'P1 private name',
        members: [{ kind: 'document', id: `doc-${tag}-0001` }],
      });
      const pileId = created.pile!.id;
      await updatePile(db, owner, pileId, {
        operationId: crypto.randomUUID(),
        revision: 1,
        color: 'mint',
      });
      const impact = await readPileDeletionImpact(db, owner, pileId);
      await deletePile(db, owner, pileId, {
        operationId: crypto.randomUUID(),
        revision: impact.pile.revision,
        impactToken: impact.impactToken,
        mode: 'pin',
      });
      await createPile(db, owner, {
        operationId: crypto.randomUUID(),
        name: 'Surviving P1 pile',
      });
    }
    const rows = async (table: string, owner: string) =>
      (await db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner=?`)
        .bind(owner)
        .first<{ n: number }>())!.n;
    const total = async (owner: string) => {
      let n = 0;
      for (const table of workspaceTables) n += await rows(table, owner);
      return n;
    };
    const call = (
      account: { cookie: string } | null,
      body?: unknown,
      requestOrigin = origin,
      store: unknown = bucket,
    ) =>
      handleAccountDeletion(
        new Request(origin + '/api/auth/account-deletion', {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: requestOrigin,
            Cookie: account?.cookie ?? '',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { ...config, IMAGES: store as R2Bucket },
      );
    const signedIn = async (account: { cookie: string }) =>
      !!(await auth.api.getSession({
        headers: new Headers({ Cookie: account.cookie }),
      }));

    const alice = await signup('deletealice'),
      bob = await signup('deletebob');
    await fill(alice.id, 'alice');
    await fill(bob.id, 'bob');
    const before = await total(bob.id);

    await t.test('needs a signed-in, same-origin request', async () => {
      assert.equal((await call(null)).status, 401);
      assert.equal(
        (await call(null, { confirmEmail: alice.email })).status,
        401,
      );
      assert.equal(
        (
          await call(
            alice,
            { confirmEmail: alice.email },
            'https://evil.example',
          )
        ).status,
        403,
      );
      assert.ok((await total(alice.id)) > 0);
    });

    await t.test('reports what would be deleted', async () => {
      const response = await call(alice);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        email: alice.email,
        needsReauthentication: false,
        text: 1,
        images: 1,
        documents: 1,
      });
    });

    await t.test(
      'refuses an old sign-in and a wrong confirmation',
      async () => {
        const created = (await db
          .prepare('SELECT created_at FROM auth_session WHERE user_id=?')
          .bind(alice.id)
          .first<{ created_at: number }>())!.created_at;
        await db
          .prepare('UPDATE auth_session SET created_at=? WHERE user_id=?')
          .bind(Date.now() - 11 * 60 * 1000, alice.id)
          .run();
        const stale = await call(alice, { confirmEmail: alice.email });
        assert.equal(stale.status, 403);
        assert.equal(
          ((await stale.json()) as { code: string }).code,
          'REAUTHENTICATION_REQUIRED',
        );
        await db
          .prepare('UPDATE auth_session SET created_at=? WHERE user_id=?')
          .bind(created, alice.id)
          .run();
        for (const confirmEmail of [undefined, '', bob.email, 'delete'])
          assert.equal((await call(alice, { confirmEmail })).status, 400);
        // Five attempts in ten minutes is the limit, even with the right email.
        const limited = await call(alice, { confirmEmail: alice.email });
        assert.equal(limited.status, 429);
        assert.ok(Number(limited.headers.get('Retry-After')) > 0);
        await db.prepare('DELETE FROM auth_throttle').run();
        // A request cannot name the account to delete.
        assert.equal(
          (await call(alice, { confirmEmail: bob.email, userId: bob.id }))
            .status,
          400,
        );
        assert.ok((await total(alice.id)) > 0);
        assert.equal(await signedIn(alice), true);
      },
    );

    await t.test(
      'deletes the workspace, the files and the sign-in, and signs out everywhere',
      async () => {
        // A second device signed in to the same account.
        const second = await auth.handler(
          new Request(origin + '/api/auth/sign-in/username', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: origin,
              'cf-connecting-ip': '192.0.2.200',
            },
            body: JSON.stringify({
              username: 'deletealice',
              password: 'synthetic-deletion-password',
            }),
          }),
        );
        assert.equal(second.status, 200);
        const otherDevice = {
          cookie: second.headers
            .getSetCookie()
            .map((c) => c.split(';')[0])
            .join('; '),
        };
        let erased = false;
        const afterAuthentication = new Proxy(db, {
          get(target, prop) {
            if (prop === 'batch')
              return async (statements: D1PreparedStatement[]) => {
                if (!erased) {
                  erased = true;
                  const response = await call(alice, {
                    confirmEmail: ` ${alice.email.toUpperCase()} `,
                  });
                  assert.equal(
                    response.status,
                    200,
                    await response.clone().text(),
                  );
                  assert.deepEqual(await response.json(), {
                    deleted: true,
                    filesPending: false,
                  });
                }
                return target.batch(statements);
              };
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        await assert.rejects(
          createPile(
            afterAuthentication,
            alice.id,
            { operationId: crypto.randomUUID(), name: 'In-flight create' },
            alice.id,
          ),
          { status: 401 },
        );
        assert.equal(await total(alice.id), 0);
        for (const [table, column] of [
          ['auth_user', 'id'],
          ['auth_session', 'user_id'],
          ['auth_account', 'user_id'],
        ])
          assert.equal(
            (await db
              .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`)
              .bind(alice.id)
              .first<{ n: number }>())!.n,
            0,
            table,
          );
        assert.equal(await bucket.head('clipboard/alice.png'), null);
        assert.equal(await bucket.head('content/alice'), null);
        for (const queue of [
          'clipboard_image_deletion_queue',
          'content_deletion_queue',
        ])
          assert.equal(
            (await db
              .prepare(`SELECT COUNT(*) AS n FROM ${queue}`)
              .first<{ n: number }>())!.n,
            0,
            queue,
          );
        assert.equal(await signedIn(alice), false);
        assert.equal(await signedIn(otherDevice), false);
        assert.equal((await call(alice)).status, 401);
      },
    );

    await t.test('leaves every other account untouched', async () => {
      assert.equal(await total(bob.id), before);
      assert.ok(await bucket.head('clipboard/bob.png'));
      assert.ok(await bucket.head('content/bob'));
      assert.equal(await signedIn(bob), true);
    });

    await t.test(
      'the same email can sign up again and gets an empty workspace',
      async () => {
        const again = await signup('deletealice');
        assert.notEqual(again.id, alice.id);
        assert.equal(await total(again.id), 0);
        assert.equal(await total(alice.id), 0);
      },
    );

    await t.test(
      'an account mapped to an earlier workspace owner deletes that workspace',
      async () => {
        const carol = await signup('deletecarol');
        await db
          .prepare('INSERT INTO auth_legacy_owner (user_id,owner) VALUES (?,?)')
          .bind(carol.id, 'legacy-carol-owner')
          .run();
        await fill('legacy-carol-owner', 'carol');
        assert.equal(
          (await call(carol, { confirmEmail: carol.email })).status,
          200,
        );
        await assert.rejects(
          createPile(
            db,
            'legacy-carol-owner',
            { operationId: crypto.randomUUID(), name: 'Late mapped create' },
            carol.id,
          ),
          { status: 401 },
        );
        assert.equal(await total('legacy-carol-owner'), 0);
        assert.equal(
          (await db
            .prepare(
              'SELECT COUNT(*) AS n FROM auth_legacy_owner WHERE user_id=?',
            )
            .bind(carol.id)
            .first<{ n: number }>())!.n,
          0,
        );
        assert.equal(await bucket.head('content/carol'), null);
      },
    );

    await t.test(
      'a storage outage still deletes the account and leaves the files queued',
      async () => {
        const dave = await signup('deletedave');
        await fill(dave.id, 'dave');
        const failing = {
          delete: () => Promise.reject(new Error('Synthetic R2 outage')),
        };
        const response = await call(
          dave,
          { confirmEmail: dave.email },
          origin,
          failing,
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          deleted: true,
          filesPending: true,
        });
        assert.equal(await total(dave.id), 0);
        assert.equal(await signedIn(dave), false);
        // The daily job will retry exactly these files.
        assert.ok(
          await db
            .prepare(
              "SELECT 1 FROM clipboard_image_deletion_queue WHERE object_key='clipboard/dave.png'",
            )
            .first(),
        );
        assert.ok(
          await db
            .prepare(
              "SELECT 1 FROM content_deletion_queue WHERE object_key='content/dave'",
            )
            .first(),
        );
        assert.ok(await bucket.head('content/dave'));
      },
    );
  } finally {
    await mf.dispose();
  }
});
