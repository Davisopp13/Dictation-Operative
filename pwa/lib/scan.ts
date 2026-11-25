/**
 * Document scanning: find a sheet of paper in a photo, flatten it to a
 * rectangle, clean it up, and write the pages into a PDF. Everything here is
 * plain arithmetic on pixel arrays so it runs in the browser without a library
 * and under `node --test` without a DOM.
 */

export type Point = { x: number; y: number };
/** Top left, top right, bottom right, bottom left. */
export type Quad = [Point, Point, Point, Point];
/** RGBA, row by row: the shape of a canvas `ImageData`. */
export type Pixels = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};
export type ScanFilter = 'enhanced' | 'bw' | 'original';

export const SCAN_PAGE_LIMIT = 40;
/** Longest side of a saved page. About 240 dpi for a Letter or A4 sheet. */
export const SCAN_PAGE_PIXELS = 2000;

/** The whole photo less a small margin: the starting point when no page is found. */
export const wholePhoto = (margin = 0.04): Quad => [
  { x: margin, y: margin },
  { x: 1 - margin, y: margin },
  { x: 1 - margin, y: 1 - margin },
  { x: margin, y: 1 - margin },
];

const area = (q: Quad) => {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

/** Corners in clockwise order with no corner folded inward. */
export function isConvex(q: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4],
      c = q[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0)
      return false;
  }
  return true;
}

/**
 * Finds a bright sheet against a darker surface. Returns corners as fractions
 * of the image (0 to 1). `found` is false when nothing page-like stood out
 * (white paper on a white desk, say), and the quad is then the whole photo.
 *
 * Give it a small image: 300 or so pixels on the long side is plenty and
 * keeps this instant.
 */
export function detectPage(image: Pixels): { quad: Quad; found: boolean } {
  const { data, width: w, height: h } = image;
  const miss = { quad: wholePhoto(), found: false };
  if (w < 8 || h < 8) return miss;
  const n = w * h;
  const raw = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4)
    raw[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  // A 3x3 blur keeps print on the page from splitting it into pieces.
  const gray = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0,
        count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += raw[yy * w + xx];
          count++;
        }
      }
      gray[y * w + x] = sum / count;
    }

  // Otsu's threshold: the brightness that best splits the photo in two.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < n; i++) histogram[gray[i]]++;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * histogram[i];
  let below = 0,
    belowSum = 0,
    best = 0,
    threshold = 0,
    darkMean = 0,
    lightMean = 0;
  for (let t = 0; t < 256; t++) {
    below += histogram[t];
    if (!below) continue;
    const above = n - below;
    if (!above) break;
    belowSum += t * histogram[t];
    const m0 = belowSum / below,
      m1 = (total - belowSum) / above;
    const between = below * above * (m0 - m1) * (m0 - m1);
    if (between > best) {
      best = between;
      threshold = t;
      darkMean = m0;
      lightMean = m1;
    }
  }
  if (lightMean - darkMean < 28) return miss;

  // Largest connected bright region.
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  let bestLabel = 0,
    bestSize = 0,
    next = 0;
  for (let start = 0; start < n; start++) {
    if (label[start] || gray[start] <= threshold) continue;
    next++;
    let top = 0,
      size = 0;
    stack[top++] = start;
    label[start] = next;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % w;
      if (x > 0 && !label[i - 1] && gray[i - 1] > threshold) {
        label[i - 1] = next;
        stack[top++] = i - 1;
      }
      if (x < w - 1 && !label[i + 1] && gray[i + 1] > threshold) {
        label[i + 1] = next;
        stack[top++] = i + 1;
      }
      if (i >= w && !label[i - w] && gray[i - w] > threshold) {
        label[i - w] = next;
        stack[top++] = i - w;
      }
      if (i < n - w && !label[i + w] && gray[i + w] > threshold) {
        label[i + w] = next;
        stack[top++] = i + w;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
  }
  if (bestSize < n * 0.1) return miss;

  // The corner of a sheet is its furthest point along each diagonal.
  let tl = 0,
    tr = 0,
    br = 0,
    bl = 0,
    minSum = Infinity,
    maxSum = -Infinity,
    minDiff = Infinity,
    maxDiff = -Infinity;
  for (let i = 0; i < n; i++) {
    if (label[i] !== bestLabel) continue;
    const x = i % w,
      y = (i - x) / w;
    if (x + y < minSum) {
      minSum = x + y;
      tl = i;
    }
    if (x + y > maxSum) {
      maxSum = x + y;
      br = i;
    }
    if (x - y > maxDiff) {
      maxDiff = x - y;
      tr = i;
    }
    if (x - y < minDiff) {
      minDiff = x - y;
      bl = i;
    }
  }
  const point = (i: number): Point => ({
    x: (i % w) / (w - 1),
    y: Math.floor(i / w) / (h - 1),
  });
  const quad: Quad = [point(tl), point(tr), point(br), point(bl)];
  const pixelArea = area(quad) * (w - 1) * (h - 1);
  // A real sheet fills the four corners it was measured from.
  if (!isConvex(quad) || pixelArea < n * 0.1 || bestSize / pixelArea < 0.75)
    return miss;
  return { quad, found: true };
}

/** Solves the 8 unknowns of the projection that sends the unit square to `q`. */
function projection(q: Quad, width: number, height: number): number[] {
  const from: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i],
      { x, y } = q[i];
    m.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    m.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++)
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-10)
      throw new Error('Drag the corners so they outline the page.');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      if (!factor) continue;
      for (let k = col; k < 9; k++) m[row][k] -= factor * m[col][k];
    }
  }
  return m.map((row, i) => row[8] / row[i]);
}

/** How large the flattened page should be, from the lengths of its edges. */
export function pageSize(
  q: Quad,
  longest = SCAN_PAGE_PIXELS,
): { width: number; height: number } {
  const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = (length(q[0], q[1]) + length(q[3], q[2])) / 2,
    height = (length(q[0], q[3]) + length(q[1], q[2])) / 2;
  const scale = Math.min(1, longest / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Pulls the four-cornered region `q` (in source pixels) out of `source` and
 * straightens it into a `width` by `height` rectangle.
 */
export function flatten(
  source: Pixels,
  q: Quad,
  width: number,
  height: number,
): Pixels {
  if (!isConvex(q))
    throw new Error('Drag the corners so they outline the page.');
  const [a, b, c, d, e, f, g, h] = projection(q, width, height);
  const { data: from, width: sw, height: sh } = source;
  const out = new Uint8ClampedArray(width * height * 4);
  let o = 0;
  for (let v = 0; v < height; v++) {
    const cy = v + 0.5;
    for (let u = 0; u < width; u++) {
      const cx = u + 0.5;
      const z = g * cx + h * cy + 1;
      let x = (a * cx + b * cy + c) / z - 0.5,
        y = (d * cx + e * cy + f) / z - 0.5;
      x = x < 0 ? 0 : x > sw - 1 ? sw - 1 : x;
      y = y < 0 ? 0 : y > sh - 1 ? sh - 1 : y;
      const x0 = x | 0,
        y0 = y | 0,
        x1 = x0 < sw - 1 ? x0 + 1 : x0,
        y1 = y0 < sh - 1 ? y0 + 1 : y0,
        fx = x - x0,
        fy = y - y0;
      const p00 = (y0 * sw + x0) * 4,
        p10 = (y0 * sw + x1) * 4,
        p01 = (y1 * sw + x0) * 4,
        p11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const upper = from[p00 + k] + (from[p10 + k] - from[p00 + k]) * fx,
          lower = from[p01 + k] + (from[p11 + k] - from[p01 + k]) * fx;
        out[o + k] = upper + (lower - upper) * fy;
      }
      out[o + 3] = 255;
      o += 4;
    }
  }
  return { data: out, width, height };
}

/**
 * Cleans a flattened page in place. `enhanced` evens out shadows and makes the
 * paper white while keeping colour; `bw` does the same in crisp grey for
 * text. Both work by estimating how bright blank paper is in each
 * neighbourhood and scaling to it.
 */
export function enhance(image: Pixels, filter: ScanFilter): Pixels {
  if (filter === 'original') return image;
  const { data, width: w, height: h } = image;
  const cell = Math.max(8, Math.round(Math.max(w, h) / 24));
  const cols = Math.ceil(w / cell),
    rows = Math.ceil(h / cell);
  const paper = new Float32Array(cols * rows);
  const histogram = new Uint32Array(256);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      histogram.fill(0);
      let count = 0;
      const yEnd = Math.min(h, (r + 1) * cell),
        xEnd = Math.min(w, (c + 1) * cell);
      for (let y = r * cell; y < yEnd; y++)
        for (let x = c * cell, p = (y * w + x) * 4; x < xEnd; x++, p += 4) {
          histogram[
            (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8
          ]++;
          count++;
        }
      // The 85th percentile: paper, not the ink on it.
      let seen = 0,
        level = 255;
      const target = count * 0.15;
      while (level > 0 && (seen += histogram[level]) < target) level--;
      paper[r * cols + c] = Math.max(level, 80);
    }
  // Smooth the grid so cell edges do not show.
  const smooth = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let sum = 0,
        count = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr,
            cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          sum += paper[rr * cols + cc];
          count++;
        }
      smooth[r * cols + c] = sum / count;
    }
  for (let y = 0; y < h; y++) {
    const gy = Math.min(rows - 1, Math.max(0, (y + 0.5) / cell - 0.5)),
      r0 = gy | 0,
      r1 = Math.min(rows - 1, r0 + 1),
      fy = gy - r0;
    for (let x = 0, p = y * w * 4; x < w; x++, p += 4) {
      const gx = Math.min(cols - 1, Math.max(0, (x + 0.5) / cell - 0.5)),
        c0 = gx | 0,
        c1 = Math.min(cols - 1, c0 + 1),
        fx = gx - c0;
      const upper =
          smooth[r0 * cols + c0] +
          (smooth[r0 * cols + c1] - smooth[r0 * cols + c0]) * fx,
        lower =
          smooth[r1 * cols + c0] +
          (smooth[r1 * cols + c1] - smooth[r1 * cols + c0]) * fx;
      const gain = 255 / (upper + (lower - upper) * fy);
      if (filter === 'bw') {
        const level =
          ((data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8) * gain;
        // Stretch so mid-grey ink goes black and near-white paper goes white.
        const value = ((level - 105) / 125) * 255;
        data[p] = data[p + 1] = data[p + 2] = value;
      } else {
        data[p] *= gain;
        data[p + 1] *= gain;
        data[p + 2] *= gain;
      }
    }
  }
  return image;
}

/** Width, height and channel count from a JPEG's frame header. */
export function jpegInfo(bytes: Uint8Array): {
  width: number;
  height: number;
  components: number;
} {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error('The scanned page is not a JPEG image.');
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Markers with no length: restart markers, start and end of image.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const frame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (frame)
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    i += 2 + length;
  }
  throw new Error('The scanned page could not be read.');
}

/**
 * A PDF with one JPEG per page, each filling its page. The JPEG bytes are
 * embedded as they are, so nothing is recompressed.
 */
export function pdfFromJpegs(pages: Uint8Array[]): Uint8Array<ArrayBuffer> {
  if (!pages.length) throw new Error('Scan at least one page first.');
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (number: number, body: string) => {
    offsets[number] = length;
    write(`${number} 0 obj\n${body}\nendobj\n`);
  };
  const points = (n: number) => String(Math.round(n * 100) / 100);

  write('%PDF-1.4\n');
  // Four high bytes tell transfer tools this file is binary.
  write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages
      .map((_, i) => `${3 + i * 3} 0 R`)
      .join(' ')}] >>`,
  );
  pages.forEach((jpeg, i) => {
    const { width, height, components } = jpegInfo(jpeg);
    if (!width || !height) throw new Error('A scanned page is empty.');
    // The long side is 11 inches; the other follows the page's own shape.
    const scale = 792 / Math.max(width, height);
    const w = points(width * scale),
      h = points(height * scale);
    const page = 3 + i * 3;
    object(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`,
    );
    const drawing = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(
      page + 1,
      `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
    );
    offsets[page + 2] = length;
    write(
      `${page + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${
        components === 1 ? '/DeviceGray' : '/DeviceRGB'
      } /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    write(jpeg);
    write('\nendstream\nendobj\n');
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  write(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++)
    write(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  write(
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  const out = new Uint8Array(new ArrayBuffer(length));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A safe PDF filename from whatever the person typed as the scan's name. */
export function scanFilename(name: string): string {
  const clean = name
    .trim()
    .replace(/\.pdf$/i, '')
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${clean || 'Scan'}.pdf`;
}
