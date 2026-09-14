import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeClipboardFeed, type FeedItem } from '../lib/clipboard-feed';
const item = (id: string, time: number): FeedItem<string> => ({
  id,
  time,
  content: id,
});
void test('All interleaves text and images newest first without losing either type', () => {
  const text = [item('text:new', 50), item('text:old', 10)];
  const images = [item('image:new', 60), item('image:old', 20)];
  assert.deepEqual(
    mergeClipboardFeed(text, images, false, false).map((x) => x.id),
    ['image:new', 'text:new', 'image:old', 'text:old'],
  );
  assert.deepEqual(
    text.map((x) => x.time),
    [50, 10],
  );
});
void test('pagination withholds older items until both source pages cover their time range', () => {
  const text = [item('text:1', 100), item('text:2', 90)];
  const images = [item('image:1', 95), item('image:2', 20)];
  assert.deepEqual(
    mergeClipboardFeed(text, images, true, false).map((x) => x.time),
    [100, 95, 90],
  );
  assert.deepEqual(
    mergeClipboardFeed([...text, item('text:3', 40)], images, false, false).map(
      (x) => x.time,
    ),
    [100, 95, 90, 40, 20],
  );
  assert.deepEqual(
    mergeClipboardFeed(images, text, false, true).map((x) => x.time),
    [100, 95, 90],
  );
});
void test('empty source and tied timestamps retain all items in deterministic order', () => {
  assert.deepEqual(
    mergeClipboardFeed([], [item('image:1', 10)], false, false).map(
      (x) => x.id,
    ),
    ['image:1'],
  );
  assert.equal(
    mergeClipboardFeed([item('text:1', 10)], [item('image:1', 10)], true, true)
      .length,
    2,
  );
  assert.deepEqual(mergeClipboardFeed([], [], false, false), []);
});
