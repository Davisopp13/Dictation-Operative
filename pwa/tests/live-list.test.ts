import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshPages } from '../lib/live-list';

void test('refresh replaces all visible pages including remote additions and deletions', async () => {
  const offsets: number[] = [];
  const result = await refreshPages(4, async (offset) => {
    offsets.push(offset);
    return offset === 0
      ? { items: ['new', 'kept'], hasMore: true }
      : { items: ['remaining'], hasMore: false };
  });
  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(result, {
    items: ['new', 'kept', 'remaining'],
    hasMore: false,
  });
});
void test('empty clipboard still refreshes and pagination stays bounded', async () => {
  assert.deepEqual(
    await refreshPages(0, async () => ({ items: ['new'], hasMore: true })),
    { items: ['new'], hasMore: true },
  );
  assert.deepEqual(
    await refreshPages(100, async () => ({ items: [], hasMore: true })),
    { items: [], hasMore: false },
  );
});

void test('manual and automatic refresh share one request, report failures, and cancel safely', async (t) => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: win,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: doc,
  });
  t.mock.method(
    globalThis,
    'setInterval',
    () => 123 as unknown as ReturnType<typeof setInterval>,
  );
  t.mock.method(globalThis, 'clearInterval', () => {});
  const { watchVisibleList } = await import('../lib/live-list');
  let calls = 0,
    successes = 0,
    failures = 0;
  let finish: () => void = () => {};
  let signal: AbortSignal | undefined;
  let fail = false;
  const stop = watchVisibleList(
    async (requestSignal) => {
      calls++;
      signal = requestSignal;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      if (fail) throw new Error('offline');
    },
    { success: () => successes++, error: () => failures++ },
  );
  try {
    const first = stop.refresh();
    await stop.refresh();
    win.dispatchEvent(new Event('focus'));
    assert.equal(calls, 1);
    finish();
    await first;
    assert.equal(successes, 1);
    fail = true;
    const failed = stop.refresh();
    finish();
    await failed;
    assert.equal(failures, 1);
    doc.visibilityState = 'hidden';
    await stop.refresh();
    assert.equal(calls, 2);
    doc.visibilityState = 'visible';
    const cancelled = stop.refresh();
    stop();
    assert.equal(signal?.aborted, true);
    finish();
    await cancelled;
    assert.equal(failures, 1);
    win.dispatchEvent(new Event('focus'));
    await stop.refresh();
    assert.equal(calls, 3);
  } finally {
    stop();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
