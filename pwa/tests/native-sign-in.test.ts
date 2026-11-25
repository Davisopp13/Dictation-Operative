import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { getAppAuth } from '../lib/app-auth';
import { handleAccountDeletion } from '../lib/account-deletion';
import { bearerToken } from '../lib/bearer';
import { ACCESS_TOKEN_SECONDS, WORKSPACE_RESOURCE } from '../lib/oauth';
import { handleWorkspaceRequest } from '../lib/workspace-request';

const origin = 'https://do.example';
const CLIENT = 'catchall-ios-test';
const REDIRECT = 'com.example.catchall:/oauth';
type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};
type Page = { items: { content: string }[] };

void test('bearer tokens are read strictly', () => {
  const header = (value?: string) =>
    bearerToken(new Headers(value === undefined ? {} : { Authorization: value }));
  assert.equal(header('Bearer abc.def-ghi_jkl'), 'abc.def-ghi_jkl');
  assert.equal(header('bearer abc'), 'abc');
  for (const value of [undefined, '', 'Basic abc', 'Bearer', 'Bearer a b', 'abc'])
    assert.equal(header(value), null);
});

void test('native sign-in: authorization code with PKCE, bearer access to /api/v1', async (t) => {
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
      BETTER_AUTH_SECRET: 'synthetic-native-secret-at-least-32-characters',
    };
    const env = config as unknown as Cloudflare.Env;
    const auth = await getAppAuth(config);

    // An operator registers the app once, in the database. This is the SQL in
    // docs/native-sign-in.md.
    const now = Date.now();
    await db.batch([
      db
        .prepare(
          `INSERT INTO auth_oauth_client (id,client_id,name,redirect_uris,token_endpoint_auth_method,application_type,grant_types,response_types,require_pkce,disabled,dpop_bound_access_tokens,client_credentials_scopes,scopes,created_at,updated_at)
           VALUES (?,?,'Catch-all Desk for iPhone',?,'none','native','["authorization_code","refresh_token"]','["code"]',1,0,0,'[]','["openid","email","offline_access","workspace"]',?,?)`,
        )
        .bind('client-row-1', CLIENT, JSON.stringify([REDIRECT]), now, now),
      db
        .prepare(
          'INSERT INTO auth_oauth_client_resource (id,client_id,resource_id,created_at) VALUES (?,?,?,?)',
        )
        .bind('client-resource-1', CLIENT, WORKSPACE_RESOURCE, now),
    ]);

    // Each call comes from its own address so per-address rate limits, which
    // have their own tests, do not interfere here.
    let address = 0;
    const ip = () => `198.51.100.${(address++ % 250) + 1}`;
    const authCall = (
      path: string,
      init: { body?: unknown; form?: Record<string, string>; cookie?: string } = {},
    ) =>
      auth.handler(
        new Request(origin + '/api/auth/' + path, {
          method: init.body !== undefined || init.form ? 'POST' : 'GET',
          headers: {
            Origin: origin,
            Cookie: init.cookie ?? '',
            'cf-connecting-ip': ip(),
            ...(init.form
              ? { 'Content-Type': 'application/x-www-form-urlencoded' }
              : init.body !== undefined
                ? { 'Content-Type': 'application/json' }
                : {}),
          },
          ...(init.form
            ? { body: new URLSearchParams(init.form) }
            : init.body !== undefined
              ? { body: JSON.stringify(init.body) }
              : {}),
        }),
      );
    const cookieOf = (response: Response) =>
      response.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
    async function signup(name: string) {
      const response = await authCall('sign-up/email', {
        body: {
          username: name,
          name,
          email: `${name}@example.test`,
          password: 'synthetic-native-password',
        },
      });
      assert.equal(response.status, 200, await response.clone().text());
      const data = (await response.json()) as { user: { id: string } };
      return {
        id: data.user.id,
        email: `${name}@example.test`,
        cookie: cookieOf(response),
      };
    }
    const pkce = () => {
      const verifier = randomBytes(32).toString('base64url');
      return {
        verifier,
        challenge: createHash('sha256').update(verifier).digest('base64url'),
      };
    };
    const authorizeQuery = (
      challenge: string,
      overrides: Record<string, string | undefined> = {},
    ) => {
      const values: Record<string, string | undefined> = {
        response_type: 'code',
        client_id: CLIENT,
        redirect_uri: REDIRECT,
        scope: 'openid email offline_access workspace',
        state: 'state-' + randomBytes(4).toString('hex'),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: WORKSPACE_RESOURCE,
        ...overrides,
      };
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(values))
        if (value !== undefined) query.set(key, value);
      return query;
    };
    const exchange = (code: string, verifier: string, withResource = true) =>
      authCall('oauth2/token', {
        form: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT,
          client_id: CLIENT,
          code_verifier: verifier,
          ...(withResource ? { resource: WORKSPACE_RESOURCE } : {}),
        },
      });
    /** The whole browser leg for an already signed-in user, ending in tokens. */
    async function signInNative(
      account: { cookie: string },
      overrides: Record<string, string | undefined> = {},
    ): Promise<Tokens> {
      const { verifier, challenge } = pkce();
      const authorize = await authCall(
        'oauth2/authorize?' + authorizeQuery(challenge, overrides),
        { cookie: account.cookie },
      );
      assert.equal(authorize.status, 302);
      const location = authorize.headers.get('location')!;
      let back: URL;
      if (location.startsWith('/oauth/consent')) {
        // The first sign-in from this app asks; the answer is remembered.
        const consent = await authCall('oauth2/consent', {
          cookie: account.cookie,
          body: {
            accept: true,
            oauth_query: new URL(location, origin).search.slice(1),
          },
        });
        assert.equal(consent.status, 200, await consent.clone().text());
        back = new URL(((await consent.json()) as { url: string }).url);
      } else back = new URL(location);
      assert.equal(back.protocol + back.pathname, REDIRECT, location);
      const tokenResponse = await exchange(
        back.searchParams.get('code')!,
        verifier,
        !('resource' in overrides),
      );
      assert.equal(tokenResponse.status, 200, await tokenResponse.clone().text());
      return (await tokenResponse.json()) as Tokens;
    }
    const api = (
      path: string,
      options: {
        token?: string;
        cookie?: string;
        method?: string;
        body?: unknown;
        origin?: string;
      } = {},
    ) =>
      handleWorkspaceRequest(
        new Request(origin + '/api/' + path, {
          method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
          headers: {
            ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}),
            ...(options.cookie ? { Cookie: options.cookie } : {}),
            ...(options.origin ? { Origin: options.origin } : {}),
            ...(options.body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
          },
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
        }),
        env,
      );

    const alice = await signup('nativealice'),
      bob = await signup('nativebob');
    let tokens: Tokens;

    await t.test(
      'a signed-out user is sent to sign in, and signing in continues the request',
      async () => {
        const { verifier, challenge } = pkce();
        const authorize = await authCall(
          'oauth2/authorize?' + authorizeQuery(challenge),
        );
        assert.equal(authorize.status, 302);
        const login = new URL(authorize.headers.get('location')!, origin);
        assert.equal(login.pathname, '/login');
        assert.ok(login.searchParams.get('sig'));
        // The login form posts the page's query along with the credentials.
        const signIn = await authCall('sign-in/username', {
          body: {
            username: 'nativealice',
            password: 'synthetic-native-password',
            oauth_query: login.search.slice(1),
          },
        });
        assert.equal(signIn.status, 200, await signIn.clone().text());
        const next = (await signIn.json()) as { redirect: boolean; url: string };
        assert.equal(next.redirect, true);
        const consentPage = new URL(next.url, origin);
        assert.equal(consentPage.pathname, '/oauth/consent');
        const session = cookieOf(signIn);
        // Declining returns to the app with an error and no code.
        const declined = await authCall('oauth2/consent', {
          cookie: session,
          body: { accept: false, oauth_query: consentPage.search.slice(1) },
        });
        const refused = new URL(((await declined.json()) as { url: string }).url);
        assert.equal(refused.protocol + refused.pathname, REDIRECT);
        assert.equal(refused.searchParams.get('error'), 'access_denied');
        assert.equal(refused.searchParams.get('code'), null);
        // Allowing returns a code that only the matching verifier can redeem.
        const consent = await authCall('oauth2/consent', {
          cookie: session,
          body: { accept: true, oauth_query: consentPage.search.slice(1) },
        });
        const back = new URL(((await consent.json()) as { url: string }).url);
        assert.equal(back.protocol + back.pathname, REDIRECT);
        assert.equal(back.searchParams.get('iss'), origin + '/api/auth');
        const code = back.searchParams.get('code')!;
        const wrong = await exchange(code, pkce().verifier);
        assert.ok(wrong.status >= 400, 'a wrong verifier must not get tokens');
        assert.equal(((await wrong.json()) as Tokens).access_token, undefined);
        // That failed attempt used the code up.
        assert.ok((await exchange(code, verifier)).status >= 400);
      },
    );

    await t.test(
      'requests without PKCE, with another redirect, or for another client are refused',
      async () => {
        const { challenge } = pkce();
        const refused = async (overrides: Record<string, string | undefined>) => {
          const response = await authCall(
            'oauth2/authorize?' + authorizeQuery(challenge, overrides),
            { cookie: alice.cookie },
          );
          const location = response.headers.get('location') ?? '';
          // Never a consent screen, and never a code.
          assert.ok(!location.startsWith('/oauth/consent'), location);
          assert.ok(!location.includes('code='), location);
          return { status: response.status, location };
        };
        const noPkce = await refused({
          code_challenge: undefined,
          code_challenge_method: undefined,
        });
        assert.ok(
          noPkce.status >= 400 || noPkce.location.includes('error='),
          JSON.stringify(noPkce),
        );
        await refused({ code_challenge_method: 'plain' });
        // An unregistered return address is never redirected to.
        const elsewhere = await refused({
          redirect_uri: 'com.attacker.app:/oauth',
        });
        assert.ok(!elsewhere.location.startsWith('com.attacker.app:'));
        await refused({ client_id: 'unknown-client' });
        await refused({ response_type: 'token' });
      },
    );

    await t.test(
      'tokens are short-lived, audience-bound and carry the workspace scope',
      async () => {
        tokens = await signInNative(alice);
        // Alice allowed this app in the previous test, so she was not asked
        // again. Asking for more than she allowed does ask again.
        assert.equal(
          (await db
            .prepare(
              'SELECT COUNT(*) AS n FROM auth_oauth_consent WHERE user_id=? AND client_id=?',
            )
            .bind(alice.id, CLIENT)
            .first<{ n: number }>())!.n,
          1,
        );
        assert.equal(tokens.token_type, 'Bearer');
        assert.equal(tokens.expires_in, ACCESS_TOKEN_SECONDS);
        assert.ok(tokens.refresh_token);
        const [header, payload] = tokens.access_token
          .split('.')
          .slice(0, 2)
          .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()));
        assert.equal(header.typ, 'at+jwt');
        assert.equal(payload.sub, alice.id);
        assert.equal(payload.azp, CLIENT);
        assert.ok(payload.aud.includes(WORKSPACE_RESOURCE));
        assert.ok(payload.scope.split(' ').includes('workspace'));
        // Tokens and signing keys are not stored in the clear.
        const stored = await db
          .prepare('SELECT token FROM auth_oauth_refresh_token')
          .all<{ token: string }>();
        assert.ok(stored.results.length > 0);
        for (const row of stored.results)
          assert.notEqual(row.token, tokens.refresh_token);
        const key = await db
          .prepare('SELECT private_key FROM auth_jwks')
          .first<{ private_key: string }>();
        assert.ok(key && !key.private_key.includes('"d"'));
      },
    );

    await t.test(
      'a bearer token reaches the same workspace as the browser session, without an Origin',
      async () => {
        const created = await api('v1/text', {
          token: tokens.access_token,
          body: { id: crypto.randomUUID(), content: 'Saved from the phone' },
        });
        assert.equal(created.status, 201, await created.clone().text());
        // The browser, with its cookie, sees it through the browser API.
        const web = (await (
          await api('library', { cookie: alice.cookie })
        ).json()) as Page;
        assert.deepEqual(
          web.items.map((item) => item.content),
          ['Saved from the phone'],
        );
        // And the phone sees what the browser saves.
        await api('clips', {
          cookie: alice.cookie,
          origin,
          body: { id: crypto.randomUUID(), content: 'Saved in the browser' },
        });
        const phone = (await (
          await api('v1/text', { token: tokens.access_token })
        ).json()) as Page;
        assert.equal(phone.items.length, 2);
        assert.equal(
          (await api('v1/revision', { token: tokens.access_token })).status,
          200,
        );
      },
    );

    await t.test('accounts are isolated from each other', async () => {
      const other = await signInNative(bob);
      const page = (await (
        await api('v1/text', { token: other.access_token })
      ).json()) as Page;
      assert.equal(page.items.length, 0);
      const mine = (await (
        await api('v1/text', { token: tokens.access_token })
      ).json()) as { items: { id: string }[] };
      assert.equal(
        (await api('v1/text/' + mine.items[0].id, { token: other.access_token }))
          .status,
        404,
      );
    });

    await t.test(
      'a bearer token works only on /api/v1 and is never mixed with cookies',
      async () => {
        // The browser API does not accept bearer tokens.
        assert.equal(
          (await api('library', { token: tokens.access_token })).status,
          401,
        );
        assert.equal(
          (
            await api('clips', {
              token: tokens.access_token,
              body: { id: crypto.randomUUID(), content: 'x' },
            })
          ).status,
          403,
        );
        // A bad token is refused even alongside a valid session cookie.
        const mixed = await api('v1/text', {
          token: tokens.access_token + 'x',
          cookie: alice.cookie,
        });
        assert.equal(mixed.status, 401);
        assert.match(mixed.headers.get('WWW-Authenticate')!, /^Bearer /);
        // A cookie session on /api/v1 still needs a same-origin write.
        assert.equal(
          (
            await api('v1/text', {
              cookie: alice.cookie,
              body: { id: crypto.randomUUID(), content: 'x' },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await api('v1/text', {
              cookie: alice.cookie,
              origin: 'https://evil.example',
              body: { id: crypto.randomUUID(), content: 'x' },
            })
          ).status,
          403,
        );
      },
    );

    await t.test(
      'altered, unsigned, wrong-audience, under-scoped and expired tokens are refused',
      async () => {
        const [header, payload, signature] = tokens.access_token.split('.');
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
        const forge = (change: object, head = header) =>
          [
            head,
            Buffer.from(JSON.stringify({ ...decoded, ...change })).toString(
              'base64url',
            ),
            signature,
          ].join('.');
        const unsigned =
          Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString(
            'base64url',
          ) +
          '.' +
          payload +
          '.';
        for (const [name, token] of [
          ['another user', forge({ sub: bob.id })],
          ['a later expiry', forge({ exp: decoded.exp + 86400 })],
          ['alg none', unsigned],
          ['a truncated signature', `${header}.${payload}.${signature.slice(0, -4)}`],
          ['not a token', 'not-a-token'],
        ])
          assert.equal((await api('v1/text', { token })).status, 401, name);
        // Without a resource the provider issues an opaque token, which is
        // not a credential for this API.
        const opaque = await signInNative(alice, { resource: undefined });
        assert.notEqual(opaque.access_token.split('.').length, 3);
        assert.equal(
          (await api('v1/text', { token: opaque.access_token })).status,
          401,
        );
        // A token that was not granted the workspace scope.
        const identityOnly = await signInNative(alice, {
          scope: 'openid email',
        });
        assert.equal(identityOnly.access_token.split('.').length, 3);
        assert.equal(
          (await api('v1/text', { token: identityOnly.access_token })).status,
          401,
        );
        // The ID token is not an access token.
        const withId = (await signInNative(alice)) as Tokens & {
          id_token: string;
        };
        assert.equal(
          (await api('v1/text', { token: withId.id_token })).status,
          401,
        );
        // Sixteen minutes later the access token has expired.
        t.mock.timers.enable({
          apis: ['Date'],
          now: Date.now() + (ACCESS_TOKEN_SECONDS + 60) * 1000,
        });
        try {
          assert.equal(
            (await api('v1/text', { token: tokens.access_token })).status,
            401,
          );
        } finally {
          t.mock.timers.reset();
        }
        assert.equal(
          (await api('v1/text', { token: tokens.access_token })).status,
          200,
        );
      },
    );

    await t.test(
      'refresh rotates, a reused refresh token is refused, and revoking ends the sign-in',
      async () => {
        const refresh = (token: string) =>
          authCall('oauth2/token', {
            form: {
              grant_type: 'refresh_token',
              refresh_token: token,
              client_id: CLIENT,
              resource: WORKSPACE_RESOURCE,
            },
          });
        const session = await signInNative(alice);
        const first = await refresh(session.refresh_token!);
        assert.equal(first.status, 200, await first.clone().text());
        const renewed = (await first.json()) as Tokens;
        assert.notEqual(renewed.refresh_token, session.refresh_token);
        assert.equal(
          (await api('v1/text', { token: renewed.access_token })).status,
          200,
        );
        // Presenting the old refresh token again is treated as theft.
        const replay = await refresh(session.refresh_token!);
        assert.ok(replay.status >= 400);
        assert.equal(((await replay.json()) as Tokens).access_token, undefined);
        // Signing out in the app revokes its refresh token.
        const other = await signInNative(alice);
        const revoked = await authCall('oauth2/revoke', {
          form: {
            token: other.refresh_token!,
            client_id: CLIENT,
            token_type_hint: 'refresh_token',
          },
        });
        assert.equal(revoked.status, 200);
        const after = await refresh(other.refresh_token!);
        assert.ok(after.status >= 400);
        assert.equal(((await after.json()) as Tokens).access_token, undefined);
      },
    );

    await t.test(
      'signing out of the browser does not break the app or the database',
      async () => {
        const browser = await authCall('sign-in/username', {
          body: {
            username: 'nativealice',
            password: 'synthetic-native-password',
          },
        });
        const cookie = cookieOf(browser);
        const phone = await signInNative({ cookie });
        const signOut = await authCall('sign-out', { cookie, body: {} });
        assert.equal(signOut.status, 200, await signOut.clone().text());
        assert.equal((await api('library', { cookie })).status, 401);
        assert.equal(
          (await api('v1/text', { token: phone.access_token })).status,
          200,
        );
      },
    );

    await t.test(
      'clients cannot be created or read through the API, and the session token route is off',
      async () => {
        for (const [path, body] of [
          [
            'oauth2/create-client',
            { redirect_uris: ['https://attacker.example/cb'] },
          ],
          [
            'oauth2/register',
            { redirect_uris: ['https://attacker.example/cb'] },
          ],
        ] as const) {
          const response = await authCall(path, { cookie: alice.cookie, body });
          assert.ok(response.status >= 400, path);
        }
        assert.ok(
          (await authCall('oauth2/get-clients', { cookie: alice.cookie }))
            .status >= 400,
        );
        assert.equal(
          (await db
            .prepare('SELECT COUNT(*) AS n FROM auth_oauth_client')
            .first<{ n: number }>())!.n,
          1,
        );
        // The jwt plugin's own route would mint a token for any session.
        assert.equal(
          (await authCall('token', { cookie: alice.cookie })).status,
          404,
        );
        const session = await authCall('get-session', { cookie: alice.cookie });
        assert.equal(session.headers.get('set-auth-jwt'), null);
      },
    );

    await t.test(
      'an account mapped to an earlier workspace owner reaches that workspace',
      async () => {
        const carol = await signup('nativecarol');
        await db
          .prepare('INSERT INTO auth_legacy_owner (user_id,owner) VALUES (?,?)')
          .bind(carol.id, 'legacy-carol-owner')
          .run();
        const carolTokens = await signInNative(carol);
        await api('v1/text', {
          token: carolTokens.access_token,
          body: { id: crypto.randomUUID(), content: 'Legacy workspace' },
        });
        assert.equal(
          (await db
            .prepare(
              "SELECT COUNT(*) AS n FROM clips WHERE owner='legacy-carol-owner'",
            )
            .first<{ n: number }>())!.n,
          1,
        );
      },
    );

    await t.test(
      'deleting the account ends bearer access at once and removes its tokens',
      async () => {
        const dave = await signup('nativedave');
        const daveTokens = await signInNative(dave);
        assert.equal(
          (await api('v1/text', { token: daveTokens.access_token })).status,
          200,
        );
        const deleted = await handleAccountDeletion(
          new Request(origin + '/api/auth/account-deletion', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: origin,
              Cookie: dave.cookie,
            },
            body: JSON.stringify({ confirmEmail: dave.email }),
          }),
          config,
        );
        assert.equal(deleted.status, 200, await deleted.clone().text());
        // The token is still correctly signed and unexpired.
        assert.equal(
          (await api('v1/text', { token: daveTokens.access_token })).status,
          401,
        );
        for (const table of [
          'auth_oauth_refresh_token',
          'auth_oauth_access_token',
          'auth_oauth_consent',
        ])
          assert.equal(
            (await db
              .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`)
              .bind(dave.id)
              .first<{ n: number }>())!.n,
            0,
            table,
          );
        const refresh = await authCall('oauth2/token', {
          form: {
            grant_type: 'refresh_token',
            refresh_token: daveTokens.refresh_token!,
            client_id: CLIENT,
            resource: WORKSPACE_RESOURCE,
          },
        });
        assert.ok(refresh.status >= 400);
        // Everyone else is still signed in.
        assert.equal(
          (await api('v1/text', { token: tokens.access_token })).status,
          200,
        );
      },
    );
  } finally {
    await mf.dispose();
  }
});
