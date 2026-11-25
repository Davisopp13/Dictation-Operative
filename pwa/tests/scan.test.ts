import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPage,
  enhance,
  flatten,
  isConvex,
  jpegInfo,
  pageSize,
  pdfFromJpegs,
  scanFilename,
  type Pixels,
  type Point,
  type Quad,
} from '../lib/scan';

/** A photo of a sheet: `paper` inside the four corners, `desk` outside. */
function photo(
  width: number,
  height: number,
  corners: Quad,
  paper = 235,
  desk = 60,
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  const inside = (p: Point) =>
    corners.every((a, i) => {
      const b = corners[(i + 1) % 4];
      return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
    });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value = inside({ x, y }) ? paper : desk;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  return { data, width, height };
}
const tilted: Quad = [
  { x: 70, y: 40 },
  { x: 250, y: 60 },
  { x: 230, y: 200 },
  { x: 40, y: 180 },
];

void test('finds the corners of a tilted sheet on a darker desk', () => {
  const { quad, found } = detectPage(photo(300, 240, tilted));
  assert.equal(found, true);
  quad.forEach((corner, i) => {
    assert.ok(
      Math.abs(corner.x * 299 - tilted[i].x) <= 3 &&
        Math.abs(corner.y * 239 - tilted[i].y) <= 3,
      `corner ${i} at ${corner.x * 299},${corner.y * 239}`,
    );
  });
});

void test('print on the page does not break detection', () => {
  const image = photo(300, 240, tilted);
  // Dark "lines of text" across the sheet.
  for (let y = 80; y < 170; y += 12)
    for (let x = 90; x < 210; x++)
      image.data.set([30, 30, 30, 255], (y * 300 + x) * 4);
  assert.equal(detectPage(image).found, true);
});

void test('falls back to the whole photo when no sheet stands out', () => {
  const flat = photo(200, 150, tilted, 200, 190);
  const result = detectPage(flat);
  assert.equal(result.found, false);
  assert.ok(isConvex(result.quad));
  // A small bright speck is not a page either.
  const speck: Quad = [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
    { x: 10, y: 30 },
  ];
  assert.equal(detectPage(photo(200, 150, speck)).found, false);
});

void test('flattening straightens the sheet and leaves the desk out', () => {
  const source = photo(300, 240, tilted);
  const size = pageSize(tilted);
  assert.ok(size.width > 170 && size.width < 200, String(size.width));
  assert.ok(size.height > 130 && size.height < 160, String(size.height));
  const page = flatten(source, tilted, size.width, size.height);
  let dark = 0;
  for (let i = 0; i < page.data.length; i += 4) if (page.data[i] < 150) dark++;
  // Only edge pixels may blend with the desk.
  assert.ok(dark < (size.width + size.height) * 4, `${dark} dark pixels`);
  assert.equal(page.data[3], 255);
});

void test('flattening keeps content where it belongs', () => {
  // Left half red, right half blue, viewed square on.
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 100; x++)
      data.set(x < 50 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 100 + x) * 4);
  const square: Quad = [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  ];
  const page = flatten({ data, width: 100, height: 100 }, square, 40, 40);
  const at = (x: number, y: number) =>
    Array.from(page.data.slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 3));
  assert.deepEqual(at(5, 20), [255, 0, 0]);
  assert.deepEqual(at(35, 20), [0, 0, 255]);
});

void test('a folded-in corner is refused instead of producing a garbled page', () => {
  const bowtie: Quad = [tilted[0], tilted[2], tilted[1], tilted[3]];
  assert.equal(isConvex(bowtie), false);
  assert.throws(
    () => flatten(photo(300, 240, tilted), bowtie, 10, 10),
    /outline the page/,
  );
});

void test('page size never exceeds the limit and keeps the shape', () => {
  const big: Quad = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 4000 },
    { x: 0, y: 4000 },
  ];
  assert.deepEqual(pageSize(big, 2000), { width: 1500, height: 2000 });
});

void test('enhance turns shadowed paper white and keeps ink dark', () => {
  const width = 240,
    height = 240;
  const make = () => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        // Paper that falls from bright to shadowed left to right.
        const paper = 230 - (x / width) * 90;
        const ink = y % 20 < 2 && x % 40 < 30;
        const value = ink ? paper * 0.2 : paper;
        data.set([value, value, value, 255], (y * width + x) * 4);
      }
    return { data, width, height };
  };
  const pixel = (image: Pixels, x: number, y: number) =>
    image.data[(y * width + x) * 4];
  for (const filter of ['enhanced', 'bw'] as const) {
    const image = enhance(make(), filter);
    assert.ok(pixel(image, 35, 10) > 240, `${filter} bright paper`);
    assert.ok(pixel(image, 235, 10) > 240, `${filter} shadowed paper`);
    assert.ok(pixel(image, 210, 20) < 90, `${filter} ink in shadow`);
  }
  const untouched = make();
  assert.deepEqual(enhance(make(), 'original').data, untouched.data);
});

/** The smallest thing `jpegInfo` accepts: a header and a frame segment. */
function fakeJpeg(width: number, height: number, components = 3) {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x4a,
    0x46, // an APP0 segment to skip
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    components,
    1,
    0x11,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  ]);
}

void test('reads size and channels from a JPEG header', () => {
  assert.deepEqual(jpegInfo(fakeJpeg(1500, 2000)), {
    width: 1500,
    height: 2000,
    components: 3,
  });
  assert.throws(() => jpegInfo(new Uint8Array([1, 2, 3])), /not a JPEG/);
});

void test('the PDF has one page per scan and a correct cross-reference table', () => {
  const pages = [fakeJpeg(1500, 2000), fakeJpeg(2000, 1000, 1)];
  const pdf = pdfFromJpegs(pages);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));
  assert.match(text, /\/Type \/Pages \/Count 2 \/Kids \[3 0 R 6 0 R\]/);
  assert.match(text, /\/MediaBox \[0 0 594 792\]/);
  assert.match(text, /\/MediaBox \[0 0 792 396\]/);
  assert.match(text, /\/ColorSpace \/DeviceRGB/);
  assert.match(text, /\/ColorSpace \/DeviceGray/);
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
  assert.ok(text.startsWith('xref\n0 9\n', start));
  const entries = text
    .slice(start)
    .split('\n')
    .slice(3, 11)
    .map((line) => Number(line.slice(0, 10)));
  entries.forEach((offset, i) =>
    assert.ok(text.startsWith(`${i + 1} 0 obj\n`, offset), `object ${i + 1}`),
  );
  // Each image is embedded byte for byte.
  for (const [i, jpeg] of pages.entries()) {
    const header = text.indexOf('stream\n', entries[4 + i * 3]) + 7;
    assert.deepEqual(pdf.slice(header, header + jpeg.length), jpeg);
    assert.match(
      text.slice(entries[4 + i * 3], header),
      new RegExp(`/Length ${jpeg.length} `),
    );
  }
  assert.throws(() => pdfFromJpegs([]), /at least one page/);
});

void test('scan names become safe PDF filenames', () => {
  assert.equal(scanFilename('  Lease / page: 1?.pdf '), 'Lease page 1.pdf');
  assert.equal(scanFilename(''), 'Scan.pdf');
  assert.equal(scanFilename('x'.repeat(300)).length, 104);
});
