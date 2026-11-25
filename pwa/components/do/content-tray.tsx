'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  File,
  Link as LinkIcon,
  Pin,
  Trash2,
  Download,
  Eye,
  Upload,
  Play,
  Search,
  LoaderCircle,
  RefreshCw,
  ScanLine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { DocumentScanner } from '@/components/do/document-scanner';
import { api, errorMessage, workspaceRevision } from '@/lib/client';
import { watchVisibleList, refreshPages } from '@/lib/live-list';
import {
  CONTENT_FILE_LIMIT,
  CONTENT_ACCOUNT_LIMIT,
  contentPlayback,
  contentPreview,
  declaredContentType,
  contentProvider,
  type ContentItem,
  type ContentPage,
} from '@/lib/content-model';

const megabytes = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;
const fileSize = (n: number) =>
  n < 1000
    ? `${n} B`
    : n < 1_000_000
      ? `${(n / 1000).toFixed(1)} KB`
      : megabytes(n);
/**
 * `active` is false while another workspace view is showing. The tray stays
 * mounted then, so a running upload finishes instead of being aborted, but it
 * stops polling and reports results through a toast.
 */
export function ContentTray({ active = true }: { active?: boolean }) {
  const [page, setPage] = useState<ContentPage | null>(null);
  const [query, setQuery] = useState(''),
    [pinned, setPinned] = useState(false);
  const [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [listError, setListError] = useState(''),
    [notice, setNotice] = useState('');
  const [linkOpen, setLinkOpen] = useState(false),
    [linkTitle, setLinkTitle] = useState(''),
    [linkURL, setLinkURL] = useState(''),
    [scanOpen, setScanOpen] = useState(false);
  const [preview, setPreview] = useState<ContentItem | null>(null),
    [deleting, setDeleting] = useState<ContentItem | null>(null);
  const visible = useRef(0),
    working = useRef(false),
    alive = useRef(true),
    shown = useRef(active),
    operation = useRef<AbortController | null>(null);
  useEffect(() => {
    shown.current = active;
  }, [active]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    visible.current = 0;
  }, [query, pinned]);
  useEffect(() => {
    if (!active) return;
    const initial = new AbortController();
    const reload = async (signal: AbortSignal) => {
      let metadata: ContentPage | undefined;
      const result = await refreshPages(visible.current, async (offset) => {
        const data = await api<ContentPage>(
          `content?q=${encodeURIComponent(query)}&pinned=${pinned}&offset=${offset}`,
          { signal },
        );
        metadata = data;
        return { items: data.items, hasMore: data.hasMore };
      });
      if (!signal.aborted && metadata) {
        visible.current = result.items.length;
        setPage({ ...metadata, items: result.items, hasMore: result.hasMore });
        setListError('');
        setLoading(false);
      }
    };
    const timer = setTimeout(
      () => {
        setLoading(true);
        void reload(initial.signal).catch((e) => {
          if (!initial.signal.aborted) {
            setListError(errorMessage(e));
            setLoading(false);
          }
        });
      },
      query ? 220 : 0,
    );
    const stop = watchVisibleList(
      reload,
      {
        error: () =>
          setListError(
            'Documents could not refresh. Check your connection and choose Refresh.',
          ),
      },
      workspaceRevision,
    );
    return () => {
      initial.abort();
      clearTimeout(timer);
      stop();
    };
  }, [query, pinned, refresh, active]);

  const run = useCallback(
    async (
      label: string,
      action: (signal: AbortSignal) => Promise<void>,
    ): Promise<boolean> => {
      if (working.current) return false;
      working.current = true;
      setBusy(label);
      setError('');
      setNotice('');
      const controller = new AbortController();
      operation.current = controller;
      try {
        await action(controller.signal);
        return true;
      } catch (e) {
        if (alive.current && !controller.signal.aborted) {
          setError(errorMessage(e));
          if (!shown.current)
            toast.add({ title: errorMessage(e), type: 'error' });
        }
        return false;
      } finally {
        working.current = false;
        if (alive.current) {
          setBusy('');
          setRefresh((n) => n + 1);
        }
      }
    },
    [],
  );

  /** Resolves true once every file is saved. */
  const upload = (files: File[]) =>
    run('Uploading files…', async (signal) => {
      let saved = 0;
      for (const file of files) {
        if (!file.size || file.size > CONTENT_FILE_LIMIT)
          throw new Error(
            `${file.name}: choose a file between 1 byte and 50 MB. ${saved ? `${saved} file(s) already saved.` : ''}`,
          );
        setBusy(`Uploading ${file.name}…`);
        const item = await api<ContentItem>('content', {
          method: 'POST',
          signal,
          body: JSON.stringify({
            kind: 'file',
            name: file.name.slice(0, 120),
            filename: file.name.slice(0, 180),
            mime: declaredContentType(file),
            size: file.size,
          }),
        });
        try {
          await api(`content/${item.id}/file`, {
            method: 'PUT',
            signal,
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
          });
        } catch (e) {
          // Aborted requests may still be settling on the Worker; it independently
          // expires abandoned reservations and retries byte cleanup.
          if (!signal.aborted) {
            try {
              await api(`content/${item.id}`, { method: 'DELETE', signal });
            } catch {
              /* server cleanup retry */
            }
          }
          throw new Error(
            `${file.name}: ${errorMessage(e)}${saved ? ` ${saved} file(s) already saved.` : ''}`,
          );
        }
        saved++;
      }
      if (alive.current) {
        const summary = `${saved} ${saved === 1 ? 'file' : 'files'} added to Documents.`;
        setNotice(summary);
        if (!shown.current) toast.add({ title: summary, type: 'success' });
      }
    });
  const loadMore = () =>
    void run('Loading more…', async (signal) => {
      const data = await api<ContentPage>(
        `content?q=${encodeURIComponent(query)}&pinned=${pinned}&offset=${page?.items.length ?? 0}`,
        { signal },
      );
      if (!alive.current) return;
      setPage((current) => {
        const items = [...(current?.items ?? []), ...data.items];
        visible.current = items.length;
        return { ...data, items };
      });
    });
  return (
    <section className="content-tray" aria-label="Documents" aria-busy={!!busy}>
      <div className="content-add-actions">
        <label className="content-file-control">
          <span>Add files</span>
          <input
            aria-label="Add files to Documents"
            type="file"
            multiple
            disabled={!!busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void upload(files);
            }}
          />
        </label>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() => setLinkOpen(true)}
        >
          <LinkIcon aria-hidden="true" /> Add Google link
        </Button>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() => setScanOpen(true)}
        >
          <ScanLine aria-hidden="true" /> Scan a document
        </Button>
      </div>
      <p className="subtle content-policy">
        50 MB per file · 2 GB per account · 500 items. Documents stay until you
        delete it, including unpinned items. Clipboard daily cleanup does not
        apply.
      </p>
      <p className="subtle content-policy">
        Files are private to your signed-in account and readable by the
        Catch-all Desk server. They use saved cloud storage, separate from
        encrypted device Sync. Google links open the originals with Google’s
        permissions.
      </p>
      <div className="content-quota">
        <label htmlFor="content-storage">
          Documents storage: {megabytes(page?.usedBytes ?? 0)} /{' '}
          {megabytes(CONTENT_ACCOUNT_LIMIT)}
          {page ? ` · ${page.itemCount} / ${page.itemLimit} items` : ''}
        </label>
        <progress
          id="content-storage"
          max={CONTENT_ACCOUNT_LIMIT}
          value={page?.usedBytes ?? 0}
        />
        {!!page?.pendingBytes && (
          <p className="subtle">
            {megabytes(page.pendingBytes)} reserved for unfinished uploads or
            waiting for file deletion. This counts toward your limit until
            cleanup completes. Abandoned uploads expire after one hour; cleanup
            and deletion retries run daily.
          </p>
        )}
      </div>
      <div className="content-filters">
        <label className="content-search" htmlFor="content-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search Documents</span>
          <Input
            id="content-search"
            type="search"
            placeholder="Search titles and filenames"
            maxLength={200}
            value={query}
            disabled={!!busy}
            onChange={(e) => {
              setPage(null);
              setLoading(true);
              setQuery(e.target.value);
            }}
          />
        </label>
        <label className="content-pinned">
          <input
            type="checkbox"
            checked={pinned}
            disabled={!!busy}
            onChange={(e) => {
              setPage(null);
              setLoading(true);
              setPinned(e.target.checked);
            }}
          />{' '}
          Pinned only
        </label>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw aria-hidden="true" /> Refresh
        </Button>
      </div>
      {(error || listError) && (
        <p className="content-error" role="alert">
          {error || listError}
        </p>
      )}
      <output className={`content-status${busy ? ' is-busy' : ''}`}>
        {busy ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden="true" /> {busy}
          </>
        ) : (
          notice
        )}
      </output>
      {loading && !page && <output>Loading Documents…</output>}
      {page && !page.items.length && !loading && (query || pinned) && (
        <div className="content-empty">
          <File aria-hidden="true" />
          <h2>No matching documents</h2>
          <p>Try another search, or turn off Pinned only.</p>
        </div>
      )}
      <ul className="content-list">
        {!query && !pinned && (
          <li className="content-drop">
            {/* The label opens the file picker by keyboard and click; dropping
                a file on it is an extra way in for a mouse. */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <label
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const files = Array.from(event.dataTransfer.files);
                if (files.length && !busy) void upload(files);
              }}
            >
              <Upload aria-hidden="true" />
              <strong>Drop files here</strong>
              <span>A PDF, an MP3, or another file. Up to 50 MB each.</span>
              <input
                className="sr-only"
                aria-label="Choose files to add to Documents"
                type="file"
                multiple
                disabled={!!busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length) void upload(files);
                }}
              />
            </label>
          </li>
        )}
        {page?.items.map((item) => (
          <li
            key={item.id}
            className={`content-card${item.pinned ? ' is-pinned' : ''}`}
          >
            <div className="content-card-icon">
              {item.kind === 'link' ? (
                <LinkIcon aria-hidden="true" />
              ) : (
                <File aria-hidden="true" />
              )}
            </div>
            <div className="content-card-details">
              <span className="content-card-kind">
                {item.pinned
                  ? 'Pinned'
                  : item.kind === 'link'
                    ? 'Google link'
                    : (item.filename.split('.').pop() ?? 'File').toUpperCase()}
              </span>
              <h2>{item.name}</h2>
              <p className="subtle">
                {item.kind === 'link'
                  ? contentProvider(item.url)
                  : `${fileSize(item.size)} · ${item.filename}`}{' '}
                · {new Date(item.createdAt).toLocaleDateString()}
              </p>
              <div className="actions">
                {item.kind === 'link' ? (
                  <a
                    className="text-link content-link"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open {contentProvider(item.url)} ↗
                  </a>
                ) : (
                  <>
                    {contentPlayback(item.mime) && (
                      <Button
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => setPreview(item)}
                      >
                        <Play aria-hidden="true" /> Play
                      </Button>
                    )}
                    {contentPreview(item.mime) === 'image' && (
                      <Button
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => setPreview(item)}
                      >
                        <Eye aria-hidden="true" /> View
                      </Button>
                    )}
                    <a
                      className="text-link content-link"
                      href={`/api/content/${item.id}/file?download=1`}
                      download
                    >
                      <Download size={16} aria-hidden="true" /> Download
                    </a>
                  </>
                )}
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  aria-pressed={item.pinned}
                  aria-label={`${item.pinned ? 'Unpin' : 'Pin'} ${item.name}`}
                  onClick={() =>
                    void run('Saving pin…', async (signal) => {
                      await api(`content/${item.id}`, {
                        method: 'PATCH',
                        signal,
                        body: JSON.stringify({ pinned: !item.pinned }),
                      });
                    })
                  }
                >
                  <Pin aria-hidden="true" /> {item.pinned ? 'Unpin' : 'Pin'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  aria-label={`Delete ${item.name}`}
                  onClick={() => setDeleting(item)}
                >
                  <Trash2 aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {page?.hasMore && (
        <Button variant="outline" disabled={!!busy} onClick={loadMore}>
          Load more
        </Button>
      )}
      <DocumentScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onSave={(file) => upload([file])}
      />
      <Dialog
        open={linkOpen}
        onOpenChange={(open) => {
          if (!busy) setLinkOpen(open);
        }}
      >
        <DialogContent className="content-dialog">
          <DialogTitle>Add a Google link</DialogTitle>
          <DialogDescription>
            Keep the original in Google Drive. This saves a shortcut and does
            not change who can open it.
          </DialogDescription>
          <form
            className="content-link-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run('Adding link…', async (signal) => {
                await api('content', {
                  method: 'POST',
                  signal,
                  body: JSON.stringify({
                    kind: 'link',
                    name: linkTitle,
                    url: linkURL,
                  }),
                });
                if (alive.current) {
                  setLinkOpen(false);
                  setLinkTitle('');
                  setLinkURL('');
                  setNotice('Link added to Documents.');
                }
              });
            }}
          >
            <label htmlFor="content-link-title">Title</label>
            <Input
              id="content-link-title"
              value={linkTitle}
              required
              maxLength={120}
              disabled={!!busy}
              onChange={(e) => setLinkTitle(e.target.value)}
            />
            <label htmlFor="content-link-url">
              Google Docs or Sheets HTTPS link
            </label>
            <Input
              id="content-link-url"
              type="url"
              value={linkURL}
              required
              maxLength={2048}
              placeholder="https://docs.google.com/document/d/…"
              disabled={!!busy}
              onChange={(e) => setLinkURL(e.target.value)}
            />
            {error && (
              <p role="alert" className="content-error">
                {error}
              </p>
            )}
            <Button type="submit" aria-disabled={!!busy}>
              {busy ? 'Adding…' : 'Add link'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="content-dialog">
          <DialogTitle>{preview?.name}</DialogTitle>
          <DialogDescription>
            {preview && contentPreview(preview.mime) === 'image'
              ? 'Shown as saved. Download for the original file.'
              : 'Playback depends on your browser and the file’s codec. Download if this format cannot play.'}
          </DialogDescription>
          {preview &&
            (contentPreview(preview.mime) === 'image' ? (
              // The name is the only description the user gave this image.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={preview.id}
                className="content-player content-image"
                alt={preview.name}
                src={`/api/content/${preview.id}/file`}
              />
            ) : contentPlayback(preview.mime) === 'video' ? (
              // User-provided media has no caption track. Do not fabricate one.
              // oxlint-disable-next-line jsx-a11y/media-has-caption
              <video
                key={preview.id}
                className="content-player"
                controls
                preload="metadata"
                playsInline
                aria-label={`Play ${preview.name}`}
                src={`/api/content/${preview.id}/file`}
              >
                Your browser cannot play this video.
              </video>
            ) : (
              // oxlint-disable-next-line jsx-a11y/media-has-caption
              <audio
                key={preview.id}
                className="content-player"
                controls
                preload="metadata"
                aria-label={`Play ${preview.name}`}
                src={`/api/content/${preview.id}/file`}
              >
                Your browser cannot play this audio.
              </audio>
            ))}
          {preview && (
            <a
              className="text-link"
              href={`/api/content/${preview.id}/file?download=1`}
              download
            >
              Download original file
            </a>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!busy && !open) setDeleting(null);
        }}
      >
        <DialogContent className="content-dialog">
          <DialogTitle>Delete {deleting?.name}?</DialogTitle>
          <DialogDescription>
            {deleting?.kind === 'link'
              ? 'This removes the shortcut from Documents. The original Google document stays in Drive.'
              : 'This removes the file from Documents across your signed-in devices. Download a copy first if you need it. File deletion retries automatically if storage is temporarily unavailable.'}
          </DialogDescription>
          {error && (
            <p role="alert" className="content-error">
              {error}
            </p>
          )}
          <div className="actions">
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => setDeleting(null)}
            >
              Keep item
            </Button>
            <Button
              disabled={!!busy}
              onClick={() => {
                const item = deleting;
                if (!item) return;
                void run('Deleting…', async (signal) => {
                  const result = await api<{ cleanupPending: boolean }>(
                    `content/${item.id}`,
                    { method: 'DELETE', signal },
                  );
                  if (alive.current) {
                    setDeleting(null);
                    setNotice(
                      result.cleanupPending
                        ? 'Item removed. File deletion is queued for retry; its bytes still count toward your limit.'
                        : 'Item deleted from Documents.',
                    );
                  }
                });
              }}
            >
              Delete item
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
