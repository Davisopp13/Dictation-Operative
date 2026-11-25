# Native sign-in

How a native app signs a user in and calls [`/api/v1`](api-v1.md). It uses the
Better Auth OAuth provider (`@better-auth/oauth-provider`, pinned to the same
1.7.4 as `better-auth`) configured in `lib/app-auth.ts`.

## Status

Local only. Migration `0008_oauth_provider.sql` is not applied to production
and no native client is registered anywhere.

## The flow

OAuth 2.1 authorization code with S256 PKCE, for a public client (no secret).

1. The app opens the system browser (on iPhone, `ASWebAuthenticationSession`)
   at
   `GET /api/auth/oauth2/authorize` with `response_type=code`, `client_id`,
   `redirect_uri`, `scope=openid email offline_access workspace`, `state`,
   `code_challenge`, `code_challenge_method=S256`, and
   `resource=urn:catchall-desk:workspace-api`.
2. A signed-out user lands on the normal `/login` page and signs in with a
   password or Google. The sign-in then continues the request by itself.
3. The first time, the user sees `/oauth/consent` and chooses Allow or Don't
   allow. The answer is remembered for that app and those permissions.
4. The browser returns to `redirect_uri` with `code`, `state`, and `iss`. The
   app checks `state` and `iss`.
5. The app posts to `POST /api/auth/oauth2/token`
   (`application/x-www-form-urlencoded`) with `grant_type=authorization_code`,
   `code`, `redirect_uri`, `client_id`, `code_verifier`, and the same
   `resource`. It receives `access_token`, `refresh_token`, `id_token`, and
   `expires_in`.
6. The app calls `/api/v1/...` with `Authorization: Bearer <access_token>`.

Renew: `POST /api/auth/oauth2/token` with `grant_type=refresh_token`,
`refresh_token`, `client_id`, and `resource`. Every renewal returns a new
refresh token and retires the old one. Presenting a retired refresh token again
is treated as theft and ends that sign-in.

Sign out: `POST /api/auth/oauth2/revoke` with `token=<refresh token>`,
`client_id`, and `token_type_hint=refresh_token`, then discard both tokens.

The `resource` parameter is required at both the authorize and token steps.
Without it the server issues an opaque token, which `/api/v1` refuses.

Store the refresh token in the Keychain (Keystore on Android). Never put either
token in a URL.

## What `/api/v1` accepts

`lib/bearer.ts` checks every bearer token locally, with no database lookup for
the token itself:

- signed by this server's key, with type `at+jwt`
- issuer `<BETTER_AUTH_URL>/api/auth`
- audience includes `urn:catchall-desk:workspace-api`
- not expired
- scope includes `workspace`
- the user in `sub` still exists

The user is then mapped to the same workspace owner a browser session for that
user gets, including accounts tied to an earlier workspace owner.

Rules that keep bearer and cookie sign-in apart:

- A bearer token is accepted only under `/api/v1/`. The browser routes ignore
  it.
- A request under `/api/v1/` that presents a bearer token is judged on that
  token alone. An invalid token is a 401 even when a valid session cookie is
  also sent.
- A bearer request needs no `Origin`. A cookie request to `/api/v1/` still needs
  a same-origin `Origin` for every write.

A refused token gets `401` with `WWW-Authenticate: Bearer error="invalid_token"`.
The app should renew once and, if that fails, sign in again.

## Lifetimes and what revocation does

| Token | Lifetime | Can it be recalled? |
| --- | --- | --- |
| Access token | 15 minutes | No. It is valid until it expires, unless the account is deleted. |
| Refresh token | 30 days, renewed on each use | Yes, by the revoke endpoint or by a reused-token detection. |

So signing out in the app, or revoking a refresh token, stops new access tokens
at once but an access token already issued keeps working for up to 15 minutes.
Deleting the account is immediate, because every request looks the user up.

Signing out of the web session does not sign the app out; they are separate
sign-ins. There is not yet a "signed-in apps" list on the web to revoke an app
from another device.

## Registering an app

Clients cannot be created, read, or changed through the API
(`clientPrivileges` always refuses, and dynamic registration is off). An
operator registers each app once with SQL. Replace the three placeholders:

```sql
INSERT INTO auth_oauth_client
  (id, client_id, name, redirect_uris, token_endpoint_auth_method,
   application_type, grant_types, response_types, require_pkce, disabled,
   dpop_bound_access_tokens, client_credentials_scopes, scopes,
   created_at, updated_at)
VALUES
  ('<random id>', '<client id>', 'Catch-all Desk for iPhone',
   '["<redirect uri>"]', 'none', 'native',
   '["authorization_code","refresh_token"]', '["code"]', 1, 0, 0, '[]',
   '["openid","email","offline_access","workspace"]',
   unixepoch() * 1000, unixepoch() * 1000);

INSERT INTO auth_oauth_client_resource (id, client_id, resource_id, created_at)
VALUES ('<random id>', '<client id>', 'urn:catchall-desk:workspace-api',
        unixepoch() * 1000);
```

Running this against production changes production data and needs its own
approval.

Choosing the redirect URI:

- An `https` universal link on a domain you control is the safer choice,
  because only your app can receive it. It needs an
  `apple-app-site-association` file served from that domain.
- A custom scheme must be reverse-domain with a single slash, such as
  `com.example.catchall:/oauth`. Another app on the device can claim the same
  scheme. PKCE stops it redeeming a code meant for your app, but it could start
  its own request. The consent screen is what protects the user in that case,
  so do not set `skip_consent` for a custom-scheme client.

The redirect URI is matched exactly.

## Operations

- **Deploy order:** apply `0008` before deploying a Worker that includes this.
- **Signing key:** created on first use in `auth_jwks`, with the private half
  encrypted under `BETTER_AUTH_SECRET`. Rotating that secret invalidates every
  access token and makes the stored key unreadable; the key row must then be
  deleted so a new one is created. Refresh tokens are hashed, not encrypted,
  and survive.
- **Rate limits:** the provider adds its own, for example 20 token requests per
  minute per address, enforced through the existing `auth_throttle` table.
- **Upgrades:** after upgrading `better-auth` or the provider, run
  `node --import tsx scripts/print-oauth-schema.ts` and compare its output with
  the OAuth section of `db/auth-schema.ts`.
- **Not exposed:** the root-level `/.well-known/oauth-authorization-server`
  document. A first-party app hardcodes its endpoints. Discovery is available
  under `/api/auth/.well-known/`.

## Not done

- Sign in with Apple, and linking it to an existing workspace.
- Password reset and email verification, which need an email provider.
- A web page listing signed-in apps with a way to sign one out.
- Registering the real iPhone client, which needs its bundle identifier and
  redirect URI.
- Any test in a real `ASWebAuthenticationSession`.
