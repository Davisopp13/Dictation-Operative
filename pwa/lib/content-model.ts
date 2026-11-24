/** Decimal MB/GB, shared by UI and API. These limits apply to Content only. */
export const CONTENT_FILE_LIMIT = 50_000_000;
export const CONTENT_ACCOUNT_LIMIT = 2_000_000_000;
export const CONTENT_ITEM_LIMIT = 500;
export type ContentItem = {
  id: string;
  kind: 'file' | 'link';
  name: string;
  filename: string;
  mime: string;
  size: number;
  url: string;
  pinned: boolean;
  createdAt: number;
};
export type ContentPage = {
  items: ContentItem[];
  hasMore: boolean;
  usedBytes: number;
  pendingBytes: number;
  itemCount: number;
  fileLimit: number;
  accountLimit: number;
  itemLimit: number;
};
/**
 * The only types a file keeps its real media type for. Anything else is
 * stored and served as opaque bytes. SVG and HTML are deliberately absent:
 * both can carry script.
 */
export type ContentPreview = 'audio' | 'video' | 'image' | 'pdf';
const knownTypes: Record<
  string,
  { extension: RegExp; preview: ContentPreview }
> = {
  'audio/mpeg': { extension: /\.mp3$/i, preview: 'audio' },
  'video/mp4': { extension: /\.mp4$/i, preview: 'video' },
  'application/pdf': { extension: /\.pdf$/i, preview: 'pdf' },
  'image/png': { extension: /\.png$/i, preview: 'image' },
  'image/jpeg': { extension: /\.jpe?g$/i, preview: 'image' },
  'image/webp': { extension: /\.webp$/i, preview: 'image' },
  'image/gif': { extension: /\.gif$/i, preview: 'image' },
};
/**
 * The media type to record for an upload. The declared type must be a known
 * one and the filename must carry its extension; a mismatch is opaque bytes.
 * This is a display hint only. The bytes are never inspected.
 */
export function contentType(declared: unknown, filename: string): string {
  const known = typeof declared === 'string' ? knownTypes[declared] : undefined;
  return known?.extension.test(filename)
    ? (declared as string)
    : 'application/octet-stream';
}
/** What kind of preview a client can offer for a stored media type. */
export function contentPreview(mime: string): ContentPreview | null {
  return knownTypes[mime]?.preview ?? null;
}
export function contentPlayback(mime: string): 'audio' | 'video' | null {
  const preview = contentPreview(mime);
  return preview === 'audio' || preview === 'video' ? preview : null;
}
/**
 * Whether the file is served for display in place. PDFs are not: every file
 * response carries a sandbox policy, under which browsers refuse to run their
 * PDF viewer. A client renders a PDF from the downloaded bytes instead.
 */
export function contentInline(mime: string): boolean {
  const preview = contentPreview(mime);
  return preview !== null && preview !== 'pdf';
}
/** The media type a client should declare when it reserves an upload. */
export function declaredContentType(file: { name: string; type: string }) {
  if (file.type) return file.type;
  for (const [mime, known] of Object.entries(knownTypes))
    if (known.extension.test(file.name)) return mime;
  return 'application/octet-stream';
}
export function contentLink(value: string): string {
  if (value.length > 2048)
    throw new Error('Links must be 2,048 characters or shorter.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a complete HTTPS link.');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Use an HTTPS link without embedded credentials.');
  if (
    !/^\/((document|spreadsheets)\/d\/[^/]+)(\/|$)/.test(url.pathname) ||
    url.hostname !== 'docs.google.com' ||
    url.port
  )
    throw new Error('Add a Google Docs or Google Sheets document link.');
  return url.href;
}
export function contentProvider(url: string) {
  return url.includes('/spreadsheets/') ? 'Google Sheets' : 'Google Docs';
}
