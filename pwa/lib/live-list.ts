/** Refresh every loaded page so remote deletions cannot leave stale tail items. */
export async function refreshPages<T>(
  visibleCount: number,
  load: (offset: number) => Promise<{ items: T[]; hasMore: boolean }>,
): Promise<{ items: T[]; hasMore: boolean }> {
  const items: T[] = [];
  let hasMore = true;
  do {
    const page = await load(items.length);
    items.push(...page.items);
    hasMore = page.hasMore && page.items.length > 0;
  } while (hasMore && items.length < visibleCount);
  return { items, hasMore };
}

/**
 * Foreground polling; one request at a time, cancelled on navigation/unmount.
 *
 * With `revision`, each five-second tick reads the workspace revision and
 * reloads the list only when it has moved. Waking the tab, coming back online,
 * and the returned `refresh()` always reload. If the revision cannot be read
 * the list is reloaded anyway, so a revision outage never hides new items.
 */
export function watchVisibleList(
  refresh: (signal: AbortSignal) => Promise<void>,
  status: { start?: () => void; success?: () => void; error?: () => void } = {},
  revision?: (signal: AbortSignal) => Promise<number>,
) {
  const controller = new AbortController();
  let running = false;
  let seen: number | null = null;
  const tick = async (force = true) => {
    if (
      running ||
      controller.signal.aborted ||
      document.visibilityState !== 'visible'
    )
      return;
    running = true;
    status.start?.();
    try {
      let current: number | null = null;
      if (revision) {
        try {
          current = await revision(controller.signal);
        } catch {
          current = null;
        }
      }
      if (force || current === null || current !== seen) {
        await refresh(controller.signal);
        // Read before the reload, so a change that raced with it is seen as
        // new on the next tick.
        seen = current;
      }
      if (!controller.signal.aborted) status.success?.();
    } catch {
      if (!controller.signal.aborted) status.error?.();
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick(false);
  }, 5000);
  const wake = () => {
    void tick();
  };
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  const stop = () => {
    controller.abort();
    clearInterval(timer);
    window.removeEventListener('focus', wake);
    window.removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', wake);
  };
  return Object.assign(stop, { refresh: () => tick() });
}
