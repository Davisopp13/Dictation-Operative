import { AppError } from './domain';

export function positiveLimit(value: string | number | undefined, fallback: number) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
export async function sharedAllowance(db: D1Database, owner: string, limit: number) {
  const day = Math.floor(Date.now() / 86400000);
  const row = await db.prepare('SELECT count FROM shared_ai_usage WHERE key=? AND day=?')
    .bind(`user:${owner}`, day).first<{ count: number }>();
  return { dailyLimit: limit, remaining: Math.max(0, limit - (row?.count ?? 0)), resetsAt: (day + 1) * 86400000 };
}

export async function limitSharedAI(db: D1Database, owner: string, perUser: number, total: number) {
  const day = Math.floor(Date.now() / 86400000);
  for (const [key, limit, message] of [
    [`user:${owner}`, perUser, 'You have used today’s included AI requests. Your allowance resets at midnight UTC.'],
    ['global', total, 'Today’s shared AI allowance has been reached. Please try again after midnight UTC.'],
  ] as const) {
    // Each reservation is atomic across isolates. A failed provider attempt still
    // counts; do not refund on uncertain outcomes that may have incurred a cost.
    const row = await db.prepare(`INSERT INTO shared_ai_usage (key,day,count) VALUES (?,?,1)
      ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN day=excluded.day THEN MIN(count+1,?) ELSE 1 END, day=excluded.day
      RETURNING count`).bind(key, day, limit + 1).first<{ count: number }>();
    if (!row || row.count > limit) throw new AppError(message, 429);
  }
}
