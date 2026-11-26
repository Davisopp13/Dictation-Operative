import type { ImageStore } from './images';

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
    const eligible = (table: string, kind: string) => `SELECT id FROM ${table}
      WHERE ${kind === 'text' ? 'clipboard_item=1 AND ' : ''}pinned=0 AND created_at<?
      AND owner IN (SELECT owner FROM preferences WHERE clipboard_daily_cleanup=1)
      AND NOT EXISTS(SELECT 1 FROM pile_members m WHERE m.owner=${table}.owner AND m.kind='${kind}' AND m.item_id=${table}.id AND m.active=1)
      ORDER BY id LIMIT ?`;
    // Tombstone and deletion use exactly the same predicate in one transaction.
    const tombstone = (table: string, kind: string) =>
      db
        .prepare(`INSERT OR REPLACE INTO item_deletions(owner,kind,item_id,reason,deleted_at)
      SELECT owner,'${kind}',id,'cleared',? FROM ${table} WHERE id IN (${eligible(table, kind)})`)
        .bind(now, cutoff, PAGE_SIZE);
    const [, text, , image] = await db.batch([
      tombstone('clips', 'text'),
      db
        .prepare(
          `DELETE FROM clips WHERE id IN (${eligible('clips', 'text')}) RETURNING owner`,
        )
        .bind(cutoff, PAGE_SIZE),
      tombstone('clipboard_images', 'image'),
      db
        .prepare(
          `DELETE FROM clipboard_images WHERE id IN (${eligible('clipboard_images', 'image')}) RETURNING id`,
        )
        .bind(cutoff, PAGE_SIZE),
    ]);
    textDeleted += text.results.length;
    imagesDeleted += image.results.length;
    // Migration 0009 invalidates text and image reads in the deletion transaction.
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
