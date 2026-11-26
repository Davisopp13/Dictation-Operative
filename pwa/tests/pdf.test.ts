import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageViewport, printRange } from '../lib/pdf';
import type { PDFPageProxy } from 'pdfjs-dist';

void test('print ranges reject invalid input and bound browser print work', () => {
  assert.deepEqual(printRange(2, 4, 10), [2, 3, 4]);
  assert.deepEqual(printRange(1, 1, 1), [1]);
  for (const [first, last] of [
    [0, 1],
    [3, 2],
    [1, 11],
    [1.5, 2],
    [1, NaN],
  ])
    assert.throws(() => printRange(first, last, 10), /Choose a page range/);
  assert.throws(() => printRange(1, 21, 100), /20 pages/);
});

void test('untrusted PDF page sizes cannot request an unbounded canvas', () => {
  for (const [width, height] of [
    [612, 792],
    [100000, 100000],
    [1, 1000000],
  ]) {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({
        width: width * scale,
        height: height * scale,
      }),
    } as PDFPageProxy;
    const viewport = pageViewport(page, 4);
    assert.ok(viewport.width * viewport.height <= 4_000_001);
    assert.ok(Math.max(viewport.width, viewport.height) <= 8192);
  }
});
