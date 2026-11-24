import type { ImageStore } from './images';
import { bumpRevision } from './revision';

export const CLIPBOARD_RETENTION_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** Only queue entries committed with metadata deletion can remove image bytes. */
export async function deleteQueuedImage(
  db: D1Database,
  images: Pick<ImageStore, 'delete'>,
  key: string,
) {
  const queued = await db
    .prepare(
      'SELECT object_key FROM clipboard_image_deletion_queue WHERE object_key=?',
    )
    .bind(key)
    .first();
  if (!queued) return;
  await images.delete(key);
  await db
    .prepare('DELETE FROM clipboard_image_deletion_queue WHERE object_key=?')
    .bind(key)
    .run();
}

/** Daily server job. Every deletion rechecks current pins and account opt-in. */
export async function runClipboardCleanup(
  db: D1Database,
  images: Pick<ImageStore, 'delete'>,
  now = Date.now(),
) {
  const cutoff = now - CLIPBOARD_RETENTION_MS;
  let textDeleted = 0;
  let imagesDeleted = 0;
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    // D1 batch is transactional. The image deletion trigger records the R2 key
    // atomically; a concurrent pin either commits first and survives, or sees 404.
    const [text, image] = await db.batch([
      db
        .prepare(`DELETE FROM clips WHERE id IN (
        SELECT id FROM clips WHERE clipboard_item=1 AND pinned=0 AND created_at<?
        AND owner IN (SELECT owner FROM preferences WHERE clipboard_daily_cleanup=1)
        LIMIT ?
      ) RETURNING owner`)
        .bind(cutoff, PAGE_SIZE),
      db
        .prepare(`DELETE FROM clipboard_images WHERE id IN (
        SELECT id FROM clipboard_images WHERE pinned=0 AND created_at<?
        AND owner IN (SELECT owner FROM preferences WHERE clipboard_daily_cleanup=1)
        LIMIT ?
      ) RETURNING id`)
        .bind(cutoff, PAGE_SIZE),
    ]);
    textDeleted += text.results.length;
    imagesDeleted += image.results.length;
    // Image deletions bump the workspace revision through a trigger. Text
    // deletions are bumped here so other devices notice the cleanup.
    const owners = [
      ...new Set(
        (text.results as { owner: string }[]).map((row) => row.owner),
      ),
    ];
    if (owners.length)
      await db.batch(owners.map((owner) => bumpRevision(db, owner, now)));
    if (text.results.length < PAGE_SIZE && image.results.length < PAGE_SIZE) {
      complete = true;
      break;
    }
  }

  // Drain even for accounts that turned cleanup off: these rows describe files
  // whose metadata was already deleted. Failures retain a durable retry record.
  let cursor = '';
  let failed = 0;
  let queueComplete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const keys = await db
      .prepare(
        'SELECT object_key FROM clipboard_image_deletion_queue WHERE object_key>? ORDER BY object_key LIMIT ?',
      )
      .bind(cursor, PAGE_SIZE)
      .all<{ object_key: string }>();
    for (const { object_key: key } of keys.results) {
      try {
        await deleteQueuedImage(db, images, key);
      } catch {
        failed++;
      }
      cursor = key;
    }
    if (keys.results.length < PAGE_SIZE) {
      queueComplete = true;
      break;
    }
  }
  console.log(
    JSON.stringify({
      event: 'clipboard_cleanup',
      textDeleted,
      imagesDeleted,
      failed,
      complete,
      queueComplete,
    }),
  );
  if (failed || !complete || !queueComplete)
    throw new Error(
      'Clipboard cleanup has pending work; queued image deletions will retry on the next daily run.',
    );
  return { textDeleted, imagesDeleted };
}
