export type FeedItem<T> = { id: string; time: number; content: T };

// Only show the time range fetched from both sources. Otherwise an older item
// could appear ahead of newer items still on the other source's next page.
export function mergeClipboardFeed<T>(
  text: FeedItem<T>[],
  images: FeedItem<T>[],
  moreText: boolean,
  moreImages: boolean,
): FeedItem<T>[] {
  const cutoff = Math.max(
    moreText && text.length ? text[text.length - 1].time : -Infinity,
    moreImages && images.length ? images[images.length - 1].time : -Infinity,
  );
  return [...text, ...images]
    .filter((item) => item.time >= cutoff)
    .sort((a, b) => b.time - a.time || b.id.localeCompare(a.id));
}
