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

/** Foreground polling; one request at a time, cancelled on navigation/unmount. */
export function watchVisibleList(
  refresh: (signal: AbortSignal) => Promise<void>,
  status: { start?: () => void; success?: () => void; error?: () => void } = {},
) {
  const controller = new AbortController();
  let running = false;
  const tick = async () => {
    if (
      running ||
      controller.signal.aborted ||
      document.visibilityState !== 'visible'
    )
      return;
    running = true;
    status.start?.();
    try {
      await refresh(controller.signal);
      if (!controller.signal.aborted) status.success?.();
    } catch {
      if (!controller.signal.aborted) status.error?.();
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
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
  return Object.assign(stop, { refresh: tick });
}
