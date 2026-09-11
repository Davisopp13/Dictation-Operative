'use client';
import Image from 'next/image';
import type { ReactNode } from 'react';
import type { FeedItem } from '@/lib/clipboard-feed';
export type ImageFeed = {
  items: FeedItem<ReactNode>[];
  loading: boolean;
  hasMore: boolean;
  busy: boolean;
  loadMore: () => Promise<void>;
};
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardPaste,
  Copy,
  Download,
  ImagePlus,
  LoaderCircle,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api, errorMessage } from '@/lib/client';
import { refreshPages } from '@/lib/live-list';
import { useClipboardSync } from './clipboard-sync';
import {
  imagePayload,
  readClipboard,
  writeClipboard,
} from '@/lib/sync/clipboard';
import type { ClipboardImage } from '@/lib/images';
import type { Payload } from '@/lib/sync/protocol';

export function ClipboardImages({
  query,
  locked,
  renderFeed,
}: {
  renderFeed?: (feed: ImageFeed) => ReactNode;
  query: string;
  locked: boolean;
}) {
  const { watch: watchClipboard } = useClipboardSync();
  const [images, setImages] = useState<ClipboardImage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const announce = useCallback((message: string) => {
    setNotice(message);
    toast.add({ title: message, type: 'success' });
  }, []);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ClipboardImage | null>(null);
  const [deleting, setDeleting] = useState<ClipboardImage | null>(null);
  const [refresh, setRefresh] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const activeQuery = useRef(query);

  useEffect(() => {
    const controller = new AbortController();
    activeQuery.current = query;
    const timeout = setTimeout(
      () => {
        setLoading(true);
        void api<{ images: ClipboardImage[]; hasMore: boolean }>(
          `images?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        )
          .then((data) => {
            setImages(data.images);
            setHasMore(data.hasMore);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(errorMessage(e));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 220 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query, refresh]);

  const visibleImageCount = useRef(0);
  useEffect(() => {
    visibleImageCount.current = images.length;
  }, [images.length]);
  useEffect(() => {
    if (loading || locked || busy) return;
    return watchClipboard('images', async (signal) => {
      const result = await refreshPages<ClipboardImage>(
        visibleImageCount.current,
        async (offset) => {
          const page = await api<{
            images: ClipboardImage[];
            hasMore: boolean;
          }>(`images?q=${encodeURIComponent(query)}&offset=${offset}`, {
            signal,
          });
          return { items: page.images, hasMore: page.hasMore };
        },
      );
      if (!signal.aborted) {
        setImages(result.items);
        setHasMore(result.hasMore);
      }
    });
  }, [query, refresh, loading, locked, busy, watchClipboard]);

  const run = useCallback(
    async (task: () => Promise<void>) => {
      if (locked || working.current) return;
      working.current = true;
      setBusy(true);
      setError('');
      setNotice('');
      try {
        await task();
      } catch (e) {
        setError(errorMessage(e));
        toast.add({ title: errorMessage(e), type: 'error' });
      } finally {
        working.current = false;
        setBusy(false);
      }
    },
    [locked],
  );

  const save = useCallback(async (payload: Payload, name: string) => {
    if (payload.mime !== 'image/png')
      throw new Error('Copy an image first, then choose Paste image.');
    // Decode before upload so broken PNG files are caught as well as size limits.
    const blob = new Blob([payload.bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
    await api<ClipboardImage>(
      `images?name=${encodeURIComponent(name.slice(0, 120))}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: blob,
      },
    );
    setRefresh((n) => n + 1);
  }, []);

  const upload = useCallback(
    (files: File[]) =>
      run(async () => {
        let saved = 0;
        const failures: string[] = [];
        for (const file of files) {
          try {
            await save(await imagePayload(file), file.name || 'Pasted image');
            saved++;
          } catch (e) {
            failures.push(`${file.name || 'Image'}: ${errorMessage(e)}`);
          }
        }
        if (saved)
          announce(
            `${saved === 1 ? 'Image' : `${saved} images`} saved to Clipboard.`,
          );
        if (failures.length) {
          setError(failures.join(' '));
          toast.add({
            title:
              'Some images could not be saved. Check the image details above.',
            type: 'error',
          });
        }
      }),
    [run, save, announce],
  );

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input,textarea,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file);
      if (!files.length || locked || working.current) return;
      event.preventDefault();
      void upload(files);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [upload, locked]);

  const copy = (item: ClipboardImage) =>
    run(async () => {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
        throw new Error(
          'Image copying is unavailable in this browser. Use Download instead.',
        );
      const payload: Promise<Payload> = fetch(`/api/images/${item.id}`, {
        cache: 'no-store',
      }).then(async (response) => {
        if (!response.ok)
          throw new Error('Could not load this image. Try again.');
        return {
          mime: 'image/png',
          bytes: new Uint8Array(await response.arrayBuffer()),
        };
      });
      // Start the clipboard write during the click for Safari's user activation.
      const write = writeClipboard('image/png', payload);
      await Promise.all([write, payload]);
      announce('Image copied. Paste it into another app.');
    });

  const renderCard = (item: ClipboardImage) => (
    <article className="clipboard-image-card" key={item.id}>
      <button
        className="clipboard-image-preview"
        onClick={() => setPreview(item)}
        aria-label={`Preview ${item.name}`}
      >
        <Image
          unoptimized
          src={`/api/images/${item.id}`}
          alt={item.name}
          loading="lazy"
          width={item.width}
          height={item.height}
        />
      </button>
      <div className="clipboard-image-details">
        <strong>{item.name}</strong>
        <p>
          {item.width} × {item.height} · {(item.size / 1024 / 1024).toFixed(1)}{' '}
          MiB
        </p>
        <div className="actions">
          <Button
            variant="outline"
            className="control"
            disabled={locked || busy}
            onClick={() => void copy(item)}
          >
            <Copy /> Copy
          </Button>
          <a
            className="control"
            href={`/api/images/${item.id}?download=1`}
            download
            aria-label={`Download ${item.name}`}
          >
            <Download size={16} />
          </a>
          <Button
            variant="ghost"
            className="control"
            disabled={locked || busy}
            onClick={() => setDeleting(item)}
            aria-label={`Delete ${item.name}`}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </article>
  );
  const loadMore = useCallback(
    () =>
      run(async () => {
        const data = await api<{
          images: ClipboardImage[];
          hasMore: boolean;
        }>(`images?q=${encodeURIComponent(query)}&offset=${images.length}`);
        if (activeQuery.current !== query) return;
        setImages((current) => [...current, ...data.images]);
        setHasMore(data.hasMore);
      }),
    [run, query, images.length],
  );

  return (
    <section
      className={renderFeed ? 'clipboard-combined' : 'clipboard-images panel'}
      aria-label={renderFeed ? 'Saved items' : 'Clipboard images'}
    >
      <div className="clipboard-images-heading">
        <div>
          <h2>{renderFeed ? 'Add images' : 'Images'}</h2>
          <p>
            Paste a screenshot or upload PNG, JPEG, or WebP. Up to 8 MiB per
            image; saved as PNG.
          </p>
        </div>
        <div className="actions">
          <Button
            variant="outline"
            className="control"
            disabled={locked || busy}
            onClick={() =>
              void run(async () => {
                try {
                  await save(await readClipboard(), 'Pasted image');
                } catch (e) {
                  if (
                    e instanceof DOMException &&
                    ['NotAllowedError', 'SecurityError'].includes(e.name)
                  )
                    throw new Error(
                      'Clipboard access was blocked. Press ⌘V or Ctrl+V while Clipboard is open, or use Upload images.',
                    );
                  throw e;
                }
                announce('Image saved to Clipboard.');
              })
            }
          >
            <ClipboardPaste /> Paste image
          </Button>
          <Button
            className="control"
            disabled={locked || busy}
            onClick={() => input.current?.click()}
          >
            <ImagePlus /> Upload images
          </Button>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            aria-label="Upload images"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length) void upload(files);
            }}
          />
        </div>
      </div>
      {busy && (
        <output className="actions">
          <LoaderCircle size={16} className="animate-spin" /> Working…
        </output>
      )}
      {notice && <output>{notice}</output>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {renderFeed ? (
        // The consumer attaches loadMore to a click handler; it never calls it during render.
        // eslint-disable-next-line react/react-compiler
        renderFeed({
          items: images.map((item) => ({
            id: `image:${item.id}`,
            time: item.createdAt,
            content: renderCard(item),
          })),
          loading,
          hasMore,
          busy,
          loadMore,
        })
      ) : loading ? (
        <output>Loading images…</output>
      ) : images.length ? (
        <div className="clipboard-image-grid">{images.map(renderCard)}</div>
      ) : (
        <p>
          {query
            ? 'No images match this search.'
            : 'Your saved images will appear here. Press ⌘V or Ctrl+V while Clipboard is open to paste.'}
        </p>
      )}
      {!renderFeed && hasMore && !loading && (
        <Button
          variant="outline"
          disabled={locked || busy}
          onClick={() => void loadMore()}
        >
          Load more images
        </Button>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogTitle>{preview?.name}</DialogTitle>
          <DialogDescription>Saved Clipboard image</DialogDescription>
          {preview && (
            <>
              <Image
                unoptimized
                width={preview.width}
                height={preview.height}
                className="clipboard-image-full"
                src={`/api/images/${preview.id}`}
                alt={preview.name}
              />
              <Button
                disabled={locked || busy}
                onClick={() => void copy(preview)}
              >
                <Copy /> Copy image
              </Button>
              <a
                className="text-link"
                href={`/api/images/${preview.id}?download=1`}
                download
              >
                Download PNG
              </a>
              {notice && <output>{notice}</output>}
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Delete this image?</DialogTitle>
          <DialogDescription>
            “{deleting?.name}” will be permanently removed from your Clipboard.
          </DialogDescription>
          <div className="actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || locked}
              onClick={() =>
                void run(async () => {
                  if (!deleting) return;
                  await api(`images/${deleting.id}`, { method: 'DELETE' });
                  setDeleting(null);
                  setRefresh((n) => n + 1);
                  announce('Image deleted.');
                })
              }
            >
              Delete image
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
