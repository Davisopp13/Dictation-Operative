import { isAPIError } from 'better-auth/api';
import { authReady, consumeAuthLimit, getAppAuth, type AuthConfig } from './app-auth';
import { readBounded } from './request';

const FRESH_SIGN_IN_MS = 10 * 60 * 1000;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

/** Add a credential to the authenticated user; never select an account by email. */
export async function handlePasswordSetup(request: Request, config: AuthConfig) {
  if (!authReady(config)) return json({ message: 'Sign-in is not configured.' }, 503);
  if (request.method !== 'GET' && request.method !== 'POST')
    return json({ message: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });

  const origin = new URL(request.url).origin;
  const allowed = [config.BETTER_AUTH_URL!, ...(config.AUTH_ADDITIONAL_ORIGINS?.split(',') ?? [])]
    .map((value) => new URL(value.trim()).origin);
  if (!allowed.includes(origin) || (request.method === 'POST' && request.headers.get('Origin') !== origin))
    return json({ message: 'Please use this account page to add a password.' }, 403);

  const auth = await getAppAuth(config);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ message: 'Sign in to manage your account.', code: 'UNAUTHORIZED' }, 401);

  const accounts = await config.DB.prepare(
    'SELECT provider_id, CASE WHEN password IS NOT NULL AND password != \'\' THEN 1 ELSE 0 END AS has_password FROM auth_account WHERE user_id=?',
  ).bind(session.user.id).all<{ provider_id: string; has_password: number }>();
  const hasPassword = accounts.results.some((account) => account.provider_id === 'credential' && account.has_password === 1);
  const googleConnected = accounts.results.some((account) => account.provider_id === 'google');
  const needsReauthentication = Date.now() - session.session.createdAt.getTime() > FRESH_SIGN_IN_MS;
  if (request.method === 'GET')
    return json({ email: session.user.email, hasPassword, googleConnected, needsReauthentication });

  const limit = await consumeAuthLimit(config.DB, `password-setup:${session.user.id}`, { window: 600, max: 5 });
  if (!limit.allowed)
    return json({ message: 'Too many attempts. Please try again later.' }, 429, { 'Retry-After': String(limit.retryAfter) });
  if (hasPassword) return json({ message: 'A password is already set for this account.', code: 'PASSWORD_ALREADY_SET' }, 409);
  if (needsReauthentication)
    return json({ message: 'Sign in again with Google, then add your password within 10 minutes.', code: 'REAUTHENTICATION_REQUIRED' }, 403);
  if (!googleConnected || !session.user.emailVerified)
    return json({ message: 'A verified Google account is required to add a password here.' }, 403);
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    return json({ message: 'A JSON request is required.' }, 415);

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await readBounded(request, 4096)));
  } catch {
    return json({ message: 'The password request is invalid or too large.' }, 400);
  }
  const password = body && typeof body === 'object' && 'newPassword' in body ? body.newPassword : undefined;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    return json({ message: 'Use a password between 12 and 128 characters.' }, 400);
  try {
    // Better Auth hashes the password and adds the credential to this session's
    // user, preserving the Google account and the workspace owner mapping.
    await auth.api.setPassword({ headers: request.headers, body: { newPassword: password } });
    return json({ status: true });
  } catch (error) {
    if (isAPIError(error) && error.body?.code === 'PASSWORD_ALREADY_SET')
      return json({ message: 'A password is already set for this account.', code: 'PASSWORD_ALREADY_SET' }, 409);
    // The provider/account unique constraint also protects concurrent attempts.
    return json({ message: 'Could not add the password. Refresh the page and try again.' }, 400);
  }
}
