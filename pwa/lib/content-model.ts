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
export function contentPlayback(mime: string): 'audio' | 'video' | null {
  return mime === 'audio/mpeg'
    ? 'audio'
    : mime === 'video/mp4'
      ? 'video'
      : null;
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
