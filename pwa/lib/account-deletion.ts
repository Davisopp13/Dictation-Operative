import {
  authReady,
  consumeAuthLimit,
  getAppAuth,
  resolveWorkspaceOwner,
  type AuthConfig,
} from './app-auth';
import { deleteQueuedImage } from './clipboard-cleanup';
import { deleteQueuedContent, type ContentStore } from './content';
import { readBounded } from './request';

const FRESH_SIGN_IN_MS = 10 * 60 * 1000;
/** Files removed while the request waits. The rest stay queued for the daily job. */
const INLINE_FILE_DELETIONS = 100;
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });

export type AccountDeletionConfig = AuthConfig & { IMAGES?: ContentStore };

/**
 * Permanently deletes the signed-in account and its workspace.
 *
 * Every database row goes in one transaction, so a failure leaves the account
 * fully intact and the request can simply be repeated. File deletion is
 * recorded in that same transaction by the deletion-queue triggers; files are
 * then removed here up to a small bound, and the daily job removes the rest.
 *
 * The account is always the one that owns the session. Nothing in the request
 * selects it.
 */
export async function handleAccountDeletion(
  request: Request,
  config: AccountDeletionConfig,
) {
  if (!authReady(config))
    return json({ message: 'Sign-in is not configured.' }, 503);
  if (request.method !== 'GET' && request.method !== 'POST')
    return json({ message: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });

  const origin = new URL(request.url).origin;
  const allowed = [
    config.BETTER_AUTH_URL!,
    ...(config.AUTH_ADDITIONAL_ORIGINS?.split(',') ?? []),
  ].map((value) => new URL(value.trim()).origin);
  if (
    !allowed.includes(origin) ||
    (request.method === 'POST' && request.headers.get('Origin') !== origin)
  )
    return json(
      { message: 'Please use the account page to delete your account.' },
      403,
    );

  const auth = await getAppAuth(config);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return json(
      { message: 'Sign in to manage your account.', code: 'UNAUTHORIZED' },
      401,
    );
  const db = config.DB;
  const user = session.user;
  const owner = await resolveWorkspaceOwner(db, user, null);
  const needsReauthentication =
    Date.now() - session.session.createdAt.getTime() > FRESH_SIGN_IN_MS;

  if (request.method === 'GET') {
    const counts = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM clips WHERE owner=?) AS text,
                (SELECT COUNT(*) FROM clipboard_images WHERE owner=?) AS images,
                (SELECT COUNT(*) FROM content_items WHERE owner=? AND state='ready') AS documents`,
      )
      .bind(owner, owner, owner)
      .first<{ text: number; images: number; documents: number }>();
    return json({ email: user.email, needsReauthentication, ...counts });
  }

  const limit = await consumeAuthLimit(db, `account-deletion:${user.id}`, {
    window: 600,
    max: 5,
  });
  if (!limit.allowed)
    return json({ message: 'Too many attempts. Please try again later.' }, 429, {
      'Retry-After': String(limit.retryAfter),
    });
  if (needsReauthentication)
    return json(
      {
        message:
          'Sign in again, then delete your account within 10 minutes of signing in.',
        code: 'REAUTHENTICATION_REQUIRED',
      },
      403,
    );
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    return json({ message: 'A JSON request is required.' }, 415);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await readBounded(request, 1024)));
  } catch {
    return json({ message: 'The request is invalid or too large.' }, 400);
  }
  const confirmation =
    body && typeof body === 'object' && 'confirmEmail' in body
      ? body.confirmEmail
      : undefined;
  if (
    typeof confirmation !== 'string' ||
    confirmation.trim().toLowerCase() !== user.email.toLowerCase()
  )
    return json(
      { message: 'Type your account email exactly to confirm.', code: 'CONFIRMATION_REQUIRED' },
      400,
    );

  // File keys are read first only to remove them promptly afterwards. The
  // triggers, not this list, are what guarantee every file is queued.
  const imageKeys = await db
    .prepare('SELECT object_key FROM clipboard_images WHERE owner=? LIMIT ?')
    .bind(owner, INLINE_FILE_DELETIONS)
    .all<{ object_key: string }>();
  const documentKeys = await db
    .prepare(
      // A file still being written is left to the daily job, so removing its
      // queue entry now cannot race the upload and strand the finished file.
      "SELECT object_key FROM content_items WHERE owner=? AND object_key<>'' AND state<>'writing' LIMIT ?",
    )
    .bind(owner, INLINE_FILE_DELETIONS)
    .all<{ object_key: string }>();

  const remove = (sql: string, ...values: string[]) =>
    db.prepare(sql).bind(...values);
  await db.batch([
    // The workspace.
    remove('DELETE FROM clips WHERE owner=?', owner),
    remove('DELETE FROM clipboard_images WHERE owner=?', owner),
    remove('DELETE FROM content_items WHERE owner=?', owner),
    remove('DELETE FROM piles WHERE owner=?', owner),
    remove('DELETE FROM pile_operations WHERE owner=?', owner),
    remove('DELETE FROM item_deletions WHERE owner=?', owner),
    remove('DELETE FROM preferences WHERE owner=?', owner),
    remove('DELETE FROM workspace_tools WHERE owner=?', owner),
    remove('DELETE FROM usage WHERE owner=?', owner),
    remove('DELETE FROM shared_ai_usage WHERE key=?', `user:${owner}`),
    // After the item deletes above, whose triggers would recreate this row.
    remove('DELETE FROM workspace_revision WHERE owner=?', owner),
    // The account. Sessions go with it, which signs out every device.
    remove('DELETE FROM auth_session WHERE user_id=?', user.id),
    remove('DELETE FROM auth_account WHERE user_id=?', user.id),
    remove('DELETE FROM auth_legacy_owner WHERE user_id=?', user.id),
    remove('DELETE FROM auth_verification WHERE identifier=?', user.email),
    remove(
      'DELETE FROM auth_throttle WHERE key IN (?,?)',
      `account-deletion:${user.id}`,
      `password-setup:${user.id}`,
    ),
    remove('DELETE FROM auth_user WHERE id=?', user.id),
  ]);

  let filesPending = false;
  if (config.IMAGES) {
    for (const { object_key: key } of imageKeys.results) {
      try {
        await deleteQueuedImage(db, config.IMAGES, key);
      } catch {
        filesPending = true;
      }
    }
    for (const { object_key: key } of documentKeys.results) {
      try {
        await deleteQueuedContent(db, config.IMAGES, key);
      } catch {
        filesPending = true;
      }
    }
  } else filesPending = true;
  if (
    imageKeys.results.length === INLINE_FILE_DELETIONS ||
    documentKeys.results.length === INLINE_FILE_DELETIONS
  )
    filesPending = true;
  console.log(
    JSON.stringify({ event: 'account_deleted', filesPending }),
  );
  return json({ deleted: true, filesPending });
}
