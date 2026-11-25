import { AppError } from './domain';

/**
 * Keyset pagination for /api/v1 lists. A cursor names the last item of the
 * previous page by its sort time and identifier, so deleting items between
 * requests can never shift later items past the reader, as offsets do.
 * Cursors are opaque to clients.
 */
export type Cursor = { time: number; id: string };

export function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify([cursor.time, cursor.id]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 300) throw new Error();
    const parsed: unknown = JSON.parse(
      atob(value.replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !Number.isSafeInteger(parsed[0]) ||
      typeof parsed[1] !== 'string' ||
      parsed[1].length > 120
    )
      throw new Error();
    return { time: parsed[0], id: parsed[1] };
  } catch {
    throw new AppError('Invalid cursor. Start the list again.');
  }
}

export function pageLimit(value: string | null, fallback = 50, max = 100) {
  if (value === null) return fallback;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max)
    throw new AppError(`Choose a page size from 1 to ${max}.`);
  return limit;
}

/** Splits `limit + 1` fetched rows into one page and the cursor after it. */
export function page<T>(
  rows: T[],
  limit: number,
  key: (row: T) => Cursor,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor:
      rows.length > limit ? encodeCursor(key(items[items.length - 1])) : null,
  };
}
