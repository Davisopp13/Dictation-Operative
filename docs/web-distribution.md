# Web distribution

The Cloudflare Worker now supports application accounts with Better Auth 1.7.4,
Drizzle and the existing D1 database. `/login` offers username/password signup
(with an email address) and Google once its credentials are configured. Private
APIs still resolve a server-verified identity before accessing user-owned data.

## Deployment and current rollout

Status (September 11, 2026): `dictationoperative.com` is attached as a Cloudflare
Worker custom domain. Web version `6cf052e0-5b34-4d3b-ac55-8cf4737331f1` and relay
version `e93e4170-b160-4b85-8bfc-6c8dfc7a8135` are deployed. The app's canonical
auth origin and relay CORS allowlist include the new domain. `BETTER_AUTH_SECRET`
and `SHARED_GROQ_CREDENTIAL_OWNER` remain configured. The **DO Web** Google client
is created and its credentials are stored as `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` Worker secrets. A real Google callback succeeded and the
existing owner's workspace mapping was verified in production.

The production URL is https://dictationoperative.com/.
The old https://do-voice-workspace.davisopp.workers.dev/ address is retained to
support existing links. Worker-level Access is now scoped to **Previews only**;
production on both hostnames reaches the app's login directly. The production
Access variables have been removed. Private APIs continue to require app sessions.
This is the web workspace; native Mac installation and native AI requests are
separate. The shared service key is never synced to native clients.

Required application secret: `BETTER_AUTH_SECRET`, at least 32 random characters.
Public variable: `BETTER_AUTH_URL`, the exact HTTPS origin above. Do not rotate the
auth secret casually: it protects cookies and stored OAuth credentials.
The original `CREDENTIAL_ENCRYPTION_KEY` must remain unchanged.

Apply the additive `0004_demonic_toxin.sql` migration before deploying the app:

```sh
cd pwa
npm run db:migrate
npm run deploy
```

The custom domain's managed HTTPS certificate is active. Both password signup
and Google sign-in are available at `/login`.

## Google setup

Current contact: `davisopp@docodelab.com` is saved as the developer contact and
published on the site's privacy page. The public Google support-email field still
contains the original Gmail account, pending the user's Workspace sign-in. The
Workspace identity has `roles/oauthconfig.editor` on this project so it can update
branding. A Chrome login handoff is waiting for the user to finish password/2FA.
After that, select the Workspace identity, change the support email, save, and
set the audience publishing status to production. Currently the audience is
External / Testing, with only `openid`, `email`, and `profile` requested. Google
exempts these basic sign-in scopes from the test-user restriction, but production
status should still be completed for the distribution rollout.

Use the Google Cloud project `dictation-operative` (Dictation Operative). Configure
Google Auth Platform branding and external users, then create an OAuth client of
type **Web application**, named **DO Web**. Only basic sign-in scopes are needed.
Set the authorized JavaScript origin to:

```text
https://dictationoperative.com
```

Set the authorized redirect URI exactly to:

```text
https://dictationoperative.com/api/auth/callback/google
```

For localhost testing, also allow `http://localhost:3000` and
`http://localhost:3000/api/auth/callback/google`. Store the client ID and secret
using `wrangler secret put GOOGLE_CLIENT_ID` and
`wrangler secret put GOOGLE_CLIENT_SECRET`. Never paste secrets into Git or chat.
The Google button stays hidden until both are present. Complete a real Google
sign-in before opening the site publicly. Configure the Google audience/publishing
status for the intended users rather than leaving an unintended test allowlist.

## Preserve the existing workspace

While still signed in through Cloudflare Access, visit
`https://dictationoperative.com/login` in the same
browser. Create a new password account or sign in with Google using the same
email address, then open the workspace. The app verifies BOTH the Access JWT
and new application session and creates a unique `auth_legacy_owner` mapping.
The existing owner identifier, encrypted credential binding, browser pairing
namespace and relay account ownership remain intact. No data is moved or decrypted
for this mapping. An email supplied during signup alone cannot claim old data.
This migration was completed for the existing Google identity on September 11,
2026. For any additional legacy account, temporarily restore the scoped Access
gate and its verified-JWT configuration before using this migration procedure.

Browser pairing keys and unfinished offline recordings are scoped to the old
website origin. Recover unfinished recordings there before moving, and enroll the
new domain as a new browser device. Server-side workspace data uses the same mapped
account on both domains.

Verify the old clipboard, preferences and paired devices before removing the
Cloudflare Access gate. Repeat for other existing beta users. Afterwards, the
application session and mapping are sufficient. New users receive independent
workspaces. If an existing user missed migration, restore a trusted Access login
for them; do not map accounts solely from an unverified email claim.

Once migration is verified, remove the outer Access requirement on the Worker
hostname (retain the app's authentication). Check from a fresh signed-out browser:
login/signup visible, private API returns 401, each account sees only its data,
and Google returns to the right workspace. The old Access variables can then be
removed after the transition; keeping their JWT verification is safe but retains
the legacy sign-in route for any still-valid Access sessions.

Cutover validation passed on both production hostnames: `/login` and `/privacy`
return 200 without Cloudflare redirects; `/api/settings` returns 401 anonymously.
Two temporary production password accounts passed signup, username login, secure
cookie, session revocation, private-library and included-AI-default checks, and
were removed afterwards. Access remains active for previews on application
`f75cf3ef-60f9-483f-8440-7bdd4f4f4d50`. To restore the outer gate, change that
Worker's Access scope from Previews only back to All traffic. Keep application
sessions active; restoring legacy JWT login additionally requires the former
Access team domain and audience variables.

## Shared Groq connection

All web users can use one server-side connection. There are two supported sources:

- `GROQ_API_KEY`: a dedicated Worker secret, if configured; it takes precedence.
- `SHARED_GROQ_CREDENTIAL_OWNER`: a Worker secret naming the existing preferences
  owner whose encrypted key is reused. The server decrypts it with the existing
  encryption secret and original owner's authenticated data. No export is needed.

This rollout uses the second source, as requested, to reuse the existing key.
The source account cannot disconnect that key through the app while it supplies
included AI. To stop sharing, remove the shared source binding first. Replacing
the source account's key changes the included connection. To rotate independently,
configure a dedicated `GROQ_API_KEY`.

Cloud-processing consent stays per account and defaults off. Settings hide the
key form for included AI and display the allowance. Shared requests always use
`openai/gpt-oss-120b` for writing and `whisper-large-v3-turbo` for transcription;
user model preferences cannot select a different model on the shared key.

Initial configurable limits: **50 requests per account per UTC day**, **1,000
requests total per UTC day**, and the existing **10 requests per minute per
account**. Change `SHARED_AI_DAILY_LIMIT` and `SHARED_AI_GLOBAL_DAILY_LIMIT` in
Wrangler variables. Transcription and writing each count separately; failed or
uncertain attempts can count. D1 atomically reserves requests across isolates.
These are request limits, not a guaranteed dollar budget. Provider rate limits and
availability also apply; the user's Groq billing tier has not been changed.

## Validation and limitations

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` cover the change.
Distribution tests use real D1 SQLite for signup, password hashing, username login,
secure cookies, session revocation, origin protection, legacy identity mapping,
concurrent limits, shared-secret isolation and encrypted-key reuse. OAuth initiation
is tested with synthetic credentials; a real Google callback needs production setup.
The local Workers runtime is also tested through the HTTP signup and signout routes.

Email verification and password-reset delivery are not configured. The signup UI
states this limitation. Automatic Google/password account merging is disabled to
avoid linking an unverified signup by email. Users should keep their chosen sign-in
method and save passwords in a password manager. Add verified email delivery and
recovery before a broader password-account launch that requires self-service recovery.

No Groq plan upgrade, payment method or provider spending settings were changed.
For paid usage, configure a provider-side spending limit in Groq Console separately.
