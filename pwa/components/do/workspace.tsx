'use client';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
} from 'react';
import {
  CircleHelp,
  Clipboard,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  Pin,
  Plus,
  SlidersHorizontal,
  WifiOff,
} from 'lucide-react';
import Image from 'next/image';
import { LogoOnBrand, Wordmark } from './wordmark';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Toaster, toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  WorkspaceToolsProvider,
  WorkspaceToolsDialog,
  useWorkspaceTools,
} from './workspace-tools';
import { Recovery } from './recovery';
import { ContentTray } from './content-tray';
import { LibrarySurface } from './library';
import { DeleteClipboardText } from './delete-clipboard-text';
import { QuickStartDialog } from './quick-start';
import { ScreenTitle } from './screen-title';
import { SettingsPage, type SettingsState } from '@/components/do/settings';
import { SyncDialog } from '@/components/do/sync';
import { ClipEditor } from '@/components/do/editor';
import { api, post, errorMessage, download } from '@/lib/client';
import { refreshPages } from '@/lib/live-list';
import { ClipboardSyncProvider, useClipboardSync } from './clipboard-sync';
import { type Clip, type ClipSummary } from '@/lib/domain';
import { parseBackup } from '@/lib/backup';
import {
  readWorkspaceNavigation,
  rememberWorkspacePage,
  saveStartPage,
  type WorkspacePage as View,
} from '@/lib/workspace-navigation';
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}
function subscribeInstalled(callback: () => void) {
  const query = window.matchMedia('(display-mode: standalone)');
  query.addEventListener('change', callback);
  window.addEventListener('appinstalled', callback);
  return () => {
    query.removeEventListener('change', callback);
    window.removeEventListener('appinstalled', callback);
  };
}
const nav = [
  ['clipboard', 'Clipboard', Clipboard],
  ['content', 'Documents', FileText],
] as const;
const subscribeHydration = () => () => {};
function ago(time: number) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hr ago`;
  return new Date(time).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
export default function Home({
  account,
  email,
}: {
  account: string;
  email: string;
}) {
  // Read browser navigation before mounting the workspace so a saved start
  // page never briefly shows the other page.
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  return (
    <WorkspaceToolsProvider account={account}>
      <ClipboardSyncProvider>
        {hydrated ? (
          <HomeContent key={account} account={account} email={email} />
        ) : (
          <output className="subtle block p-6">Opening workspace…</output>
        )}
      </ClipboardSyncProvider>
    </WorkspaceToolsProvider>
  );
}
function HomeContent({ account, email }: { account: string; email: string }) {
  const [initialNavigation] = useState(() => readWorkspaceNavigation(account));
  const [openedAt] = useState(() => Date.now());
  const organization = useWorkspaceTools();
  const { watch: watchClipboard } = useClipboardSync();
  const [toolsOpen, setToolsOpen] = useState(false),
    [collectionFilter, setCollectionFilter] = useState(''),
    [tagFilter, setTagFilter] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [startPage, setStartPage] = useState<View>(initialNavigation.startPage);
  const [clipboardFilter, setClipboardFilter] = useState<
    'all' | 'pinned' | 'images'
  >('all');
  // Documents mounts on first visit and then stays mounted, hidden, so a
  // running upload is not cancelled by switching to Clipboard.
  const [documentsOpened, setDocumentsOpened] = useState(
    initialNavigation.view === 'content',
  );
  // Settings is a screen, but not one a visit can start on.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // On a phone, adding is its own full-screen step opened from the tab bar.
  const [addOpen, setAddOpen] = useState(false);
  const [view, setActiveView] = useState<View>(initialNavigation.view),
    [query, setQuery] = useState(''),
    [clips, setClips] = useState<ClipSummary[]>([]),
    [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [settings, setSettings] = useState<SettingsState>({}),
    [editor, setEditor] = useState<Clip | null>(null),
    [, setSurfacedMessage] = useState(''),
    [importOpen, setImportOpen] = useState(false),
    [backup, setBackup] = useState<Clip[]>([]),
    [importError, setImportError] = useState(''),
    [importProgress, setImportProgress] = useState(''),
    [installOpen, setInstallOpen] = useState(false),
    [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null),
    [copyText, setCopyText] = useState<string | null>(null),
    [updateReady, setUpdateReady] = useState(false);
  // Text that arrived from another device while this tab was open. `known`
  // holds every identifier this tab has already shown or saved itself.
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const markKnown = useCallback((ids: string[]) => {
    known.current = new Set([...(known.current ?? []), ...ids]);
  }, []);
  const settle = useCallback((id: string) => {
    setFresh((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);
  // One feedback layer. The top banner and the editor's inline messages were
  // two unrelated mechanisms; both now speak through the toast viewport.
  const setMessage = useCallback((text: string) => {
    setSurfacedMessage(text);
    if (text) toast.add({ title: text, type: 'success' });
  }, []);
  const setError = useCallback((text: string) => {
    if (text) toast.add({ title: text, type: 'error' });
  }, []);
  const latest = useRef({
    query,
    view,
    collectionFilter,
    tagFilter,
    clipboardFilter,
  });
  useEffect(() => {
    latest.current = {
      query,
      view,
      collectionFilter,
      tagFilter,
      clipboardFilter,
    };
  }, [query, view, collectionFilter, tagFilter, clipboardFilter]);
  // Navigation never locks: a slow export or save must not freeze the workspace.
  const locked = busy;
  useEffect(() => {
    rememberWorkspacePage(account, initialNavigation.view);
  }, [account, initialNavigation.view]);
  const viewFilters = useRef<
    Partial<Record<View, { query: string; collection: string; tag: string }>>
  >({});
  const setView = useCallback(
    (next: View) => {
      setSettingsOpen(false);
      setAddOpen(false);
      if (next === view) return;
      viewFilters.current[view] = {
        query,
        collection: collectionFilter,
        tag: tagFilter,
      };
      const saved = viewFilters.current[next];
      setQuery(saved?.query ?? '');
      setCollectionFilter(saved?.collection ?? '');
      setTagFilter(saved?.tag ?? '');
      setLoading(true);
      setClips([]);
      if (next === 'clipboard') setClipboardFilter('all');
      if (next === 'content') setDocumentsOpened(true);
      setActiveView(next);
      rememberWorkspacePage(account, next);
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [account, view, query, collectionFilter, tagFilter],
  );

  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const installed = useSyncExternalStore(
    subscribeInstalled,
    () => window.matchMedia('(display-mode: standalone)').matches,
    () => false,
  );
  const refreshLibrary = useCallback(() => setRefresh((n) => n + 1), []);
  useEffect(() => {
    void api<SettingsState>('settings')
      .then(setSettings)
      .catch((e) => setError(errorMessage(e)));
    const install = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', install);
    const installedEvent = () => {
      setInstallPrompt(null);
    };
    window.addEventListener('appinstalled', installedEvent);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((registration) => {
          if (registration.waiting) setUpdateReady(true);
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
              if (
                worker.state === 'installed' &&
                navigator.serviceWorker.controller
              )
                setUpdateReady(true);
            });
          });
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', install);
      window.removeEventListener('appinstalled', installedEvent);
    };
  }, [setError]);
  useEffect(() => {
    if (view === 'content' || (view === 'clipboard' && clipboardFilter === 'images')) {
      return;
    }
    const abort = new AbortController();
    const timeout = setTimeout(
      () => {
        setLoading(true);
        void api<{ items: ClipSummary[]; hasMore: boolean }>(
          `library?q=${encodeURIComponent(query)}&collection=${encodeURIComponent(collectionFilter)}&tag=${encodeURIComponent(tagFilter)}&pinned=${view === 'clipboard' && clipboardFilter === 'pinned'}`,
          { signal: abort.signal },
        )
          .then((result) => {
            // Whatever a load the user asked for shows is not news.
            markKnown(result.items.map((item) => item.id));
            setClips(result.items);
            setHasMore(result.hasMore);
          })
          .catch((e) => {
            if (e.name !== 'AbortError') setError(errorMessage(e));
          })
          .finally(() => {
            if (!abort.signal.aborted) setLoading(false);
          });
      },
      query ? 220 : 0,
    );
    return () => {
      abort.abort();
      clearTimeout(timeout);
    };
  }, [
    query,
    view,
    refresh,
    collectionFilter,
    tagFilter,
    clipboardFilter,
    setError,
    markKnown,
  ]);
  const visibleClipCount = useRef(0);
  useEffect(() => {
    visibleClipCount.current = clips.length;
  }, [clips.length]);
  useEffect(() => {
    if (
      loading ||
      locked ||
      editor ||
      view !== 'clipboard' ||
      clipboardFilter === 'images'
    )
      return;
    return watchClipboard('text', async (signal) => {
      const result = await refreshPages<ClipSummary>(
        visibleClipCount.current,
        (offset) =>
          api(
            `library?q=${encodeURIComponent(query)}&collection=${encodeURIComponent(collectionFilter)}&tag=${encodeURIComponent(tagFilter)}&pinned=${view === 'clipboard' && clipboardFilter === 'pinned'}&offset=${offset}`,
            { signal },
          ),
      );
      if (!signal.aborted) {
        // A background refresh found text this tab has never shown, saved
        // after the tab was opened: it arrived from another device.
        const seen = known.current;
        if (seen) {
          const arrived = result.items.filter(
            (item) => !seen.has(item.id) && item.createdAt >= openedAt,
          );
          if (arrived.length)
            setFresh(
              (current) =>
                new Set([...current, ...arrived.map((item) => item.id)]),
            );
        }
        markKnown(result.items.map((item) => item.id));
        setClips(result.items);
        setHasMore(result.hasMore);
      }
    });
  }, [
    query,
    view,
    refresh,
    collectionFilter,
    tagFilter,
    loading,
    locked,
    editor,
    watchClipboard,
    clipboardFilter,
    openedAt,
    markKnown,
  ]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function openClip(id: string) {
    settle(id);
    await run(async () => setEditor(await api<Clip>('clips/' + id)));
  }
  async function copyClip(item: ClipSummary) {
    settle(item.id);
    await run(async () => {
      const full = await api<Clip>('clips/' + item.id);
      try {
        await navigator.clipboard.writeText(full.content);
        setMessage('Copied to your clipboard.');
      } catch {
        setCopyText(full.content);
      }
    });
  }
  function onClipDeleted(id: string) {
    setEditor((current) => (current?.id === id ? null : current));
    setClips((current) => current.filter((c) => c.id !== id));
    refreshLibrary();
    setMessage('Text deleted from Clipboard.');
  }
  async function pinClip(item: ClipSummary) {
    await run(async () => {
      await api<Clip>('clips/' + item.id, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'pin',
          pinned: !item.pinned,
          revision: item.revision,
        }),
      });
      refreshLibrary();
    });
  }
  async function readBackup(file: File | undefined) {
    setImportError('');
    setBackup([]);
    if (!file) return;
    try {
      if (file.size > 20000000)
        throw new Error('Choose a backup smaller than 20 MB.');
      setBackup(parseBackup(JSON.parse(await file.text())));
    } catch (e) {
      setImportError(errorMessage(e));
    }
  }
  async function restoreBackup() {
    setBusy(true);
    setImportError('');
    let imported = 0;
    // Restored text is not news from another device.
    known.current = null;
    try {
      for (let i = 0; i < backup.length; i++) {
        setImportProgress(`Restoring ${i + 1} of ${backup.length}…`);
        const result = await post<{ imported: boolean }>('import', {
          clip: backup[i],
        });
        if (result.imported) imported++;
      }
      setMessage(
        `Imported ${imported} items. Existing items were kept unchanged.`,
      );
      setBackup([]);
      setImportOpen(false);
      refreshLibrary();
    } catch (e) {
      setImportError(
        `${imported} items restored so far. ${errorMessage(e)} You can retry this backup safely.`,
      );
      refreshLibrary();
    } finally {
      setBusy(false);
      setImportProgress('');
    }
  }
  async function exportLibrary() {
    await run(async () => {
      const all: Clip[] = [];
      let offset = 0,
        more = true;
      while (more) {
        const page = await api<{ items: ClipSummary[]; hasMore: boolean }>(
          'library?offset=' + offset,
        );
        for (const item of page.items)
          all.push(await api<Clip>('clips/' + item.id));
        offset += page.items.length;
        more = page.hasMore;
      }
      download(
        'do-library-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(
          {
            app: 'DO',
            version: 1,
            exportedAt: new Date().toISOString(),
            clips: all,
          },
          null,
          2,
        ),
        'application/json',
      );
      setMessage(
        `Exported ${all.length} items with originals and versions.`,
      );
    });
  }
  async function loadMore() {
    const expected = { ...latest.current };
    await run(async () => {
      const r = await api<{ items: ClipSummary[]; hasMore: boolean }>(
        `library?q=${encodeURIComponent(query)}&collection=${encodeURIComponent(collectionFilter)}&tag=${encodeURIComponent(tagFilter)}&pinned=${view === 'clipboard' && clipboardFilter === 'pinned'}&offset=${clips.length}`,
      );
      if (
        expected.collectionFilter !== latest.current.collectionFilter ||
        expected.tagFilter !== latest.current.tagFilter ||
        expected.query !== latest.current.query ||
        expected.view !== latest.current.view ||
        expected.clipboardFilter !== latest.current.clipboardFilter
      )
        return;
      markKnown(r.items.map((item) => item.id));
      setClips((current) => [
        ...current,
        ...r.items.filter((c) => !current.some((old) => old.id === c.id)),
      ]);
      setHasMore(r.hasMore);
    });
  }
  // One saved text. Pinned text is a yellow sticky note; text that just
  // arrived from another device is mint until it is opened or copied.
  const card = (item: ClipSummary) => {
    const arrived = fresh.has(item.id) && !item.pinned;
    return (
      <article
        className={`clip-card${item.pinned ? ' is-pinned' : arrived ? ' is-fresh' : ''}`}
        key={item.id}
      >
        <div className="clip-card-top">
          <span className="clip-card-kind">
            {item.pinned
              ? 'Pinned'
              : arrived
                ? 'Just arrived'
                : item.collection
                  ? `Text · ${item.collection}`
                  : 'Text'}
          </span>
          <time dateTime={new Date(item.createdAt).toISOString()}>
            {ago(item.updatedAt)}
          </time>
        </div>
        <h3>
          <button
            type="button"
            className="clip-open"
            disabled={locked}
            onClick={() => void openClip(item.id)}
          >
            {item.title}
          </button>
        </h3>
        <p>{item.content}</p>
        {item.tags.length > 0 && (
          <span className="clip-card-tags">
            {item.tags.map((t) => '#' + t).join(' · ')}
          </span>
        )}
        <div className="clip-card-actions">
          <button
            type="button"
            className="card-button card-button-solid"
            disabled={locked}
            onClick={() => void copyClip(item)}
            aria-label={`Copy ${item.title}`}
          >
            <Copy aria-hidden="true" /> Copy
          </button>
          <button
            type="button"
            className="card-button"
            disabled={locked}
            aria-pressed={item.pinned}
            onClick={() => void pinClip(item)}
            aria-label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
          >
            <Pin
              aria-hidden="true"
              fill={item.pinned ? 'currentColor' : 'none'}
            />
            {item.pinned ? 'Unpin' : 'Pin'}
          </button>
          <DeleteClipboardText
            clip={item}
            locked={locked}
            onDelete={onClipDeleted}
          />
        </div>
      </article>
    );
  };
  const openSettings = () => {
    setAddOpen(false);
    setSettingsOpen(true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const current = settingsOpen ? 'settings' : view;
  return (
    <div className="desk">
      <Toaster />
      <aside className="desk-sidebar">
        <div className="desk-sidebar-brand">
          <LogoOnBrand />
          <span>Text, images, documents</span>
        </div>
        <nav className="desk-nav" aria-label="Main navigation">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              className="desk-nav-item"
              aria-current={current === id ? 'page' : undefined}
              onClick={() => setView(id)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="desk-sidebar-spacer" />
        <div className="desk-nav desk-nav-secondary">
          <button
            type="button"
            className="desk-nav-item"
            aria-current={current === 'settings' ? 'page' : undefined}
            onClick={openSettings}
          >
            <SlidersHorizontal aria-hidden="true" />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="desk-nav-item"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp aria-hidden="true" />
            <span>Quick start</span>
          </button>
        </div>
        {!installed && (
          <div className="desk-install">
            <strong>Keep your desk one tap away</strong>
            <span>
              Install Catch-all Desk on this device so it opens like an app.
            </span>
            <button type="button" onClick={() => setInstallOpen(true)}>
              Install
            </button>
          </div>
        )}
      </aside>
      <main className="desk-main">
        <div className="desk-mobile-top">
          <Wordmark />
          <div>
            <button
              type="button"
              className="icon-button"
              aria-label="Quick start"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Settings"
              aria-pressed={settingsOpen}
              onClick={openSettings}
            >
              <SlidersHorizontal aria-hidden="true" />
            </button>
          </div>
        </div>
        <Recovery
          disabled={locked}
          onSaved={(clip) => {
            markKnown([clip.id]);
            setEditor(clip);
            refreshLibrary();
          }}
        />
        {!online && (
          <output className="desk-banner">
            <WifiOff size={18} aria-hidden="true" /> You’re offline. Reconnect
            to load, save, or sync your items.
          </output>
        )}
        {updateReady && (
          <div className="desk-banner">
            A new version of Catch-all Desk is ready.
            <Button
              variant="outline"
              className="control"
              disabled={locked || !!editor}
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          </div>
        )}
        {settingsOpen && (
          <SettingsPage
            account={account}
            email={email}
            settings={settings}
            onSettings={setSettings}
            startPage={startPage}
            onStartPageChange={(next) => {
              saveStartPage(account, next);
              setStartPage(next);
            }}
            locked={locked}
            onSync={() => setSyncOpen(true)}
            onCollections={() => setToolsOpen(true)}
            onExport={() => void exportLibrary()}
            onImport={() => setImportOpen(true)}
          />
        )}
        {documentsOpened && (
          <div hidden={settingsOpen || view !== 'content'}>
            <ScreenTitle
              title="Documents"
              subtitle="Files and Google links that stay until you delete them."
              accent="page"
            />
            <ContentTray
              key={account}
              active={!settingsOpen && view === 'content'}
            />
          </div>
        )}
        {view !== 'content' && (
          <div hidden={settingsOpen}>
            <LibrarySurface
              dailyCleanup={!!settings.clipboardDailyCleanup}
              clipboardFilter={clipboardFilter}
              setClipboardFilter={(filter) => {
                if (filter === clipboardFilter) return;
                setClips([]);
                setHasMore(false);
                setLoading(filter !== 'images');
                if (filter === 'images') {
                  setCollectionFilter('');
                  setTagFilter('');
                }
                setClipboardFilter(filter);
              }}
              collectionFilter={collectionFilter}
              setCollectionFilter={setCollectionFilter}
              tagFilter={tagFilter}
              setTagFilter={setTagFilter}
              organization={organization}
              query={query}
              setQuery={setQuery}
              clips={clips}
              card={card}
              loading={loading}
              hasMore={hasMore}
              loadMore={loadMore}
              locked={locked}
              addOpen={addOpen}
              onAddClose={() => setAddOpen(false)}
              onClipboardSaved={(id) => {
                markKnown([id]);
                setAddOpen(false);
                setClipboardFilter('all');
                setQuery('');
                setCollectionFilter('');
                setTagFilter('');
                refreshLibrary();
              }}
            />
          </div>
        )}
      </main>
      <nav className="desk-tabbar" aria-label="Mobile navigation">
        <button
          type="button"
          className="desk-tab"
          aria-current={current === 'clipboard' && !addOpen ? 'page' : undefined}
          onClick={() => setView('clipboard')}
        >
          <Clipboard aria-hidden="true" />
          <span>Clipboard</span>
        </button>
        <button
          type="button"
          className="desk-tab-add"
          aria-label="Add to Clipboard"
          onClick={() => {
            setView('clipboard');
            setAddOpen(true);
          }}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="desk-tab"
          aria-current={current === 'content' ? 'page' : undefined}
          onClick={() => setView('content')}
        >
          <FileText aria-hidden="true" />
          <span>Documents</span>
        </button>
      </nav>
      <QuickStartDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <SyncDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        account={account}
        draft={editor?.content ?? ''}
      />
      <WorkspaceToolsDialog
        key={String(toolsOpen)}
        open={toolsOpen}
        onOpenChange={setToolsOpen}
      />
      <ClipEditor
        key={editor?.id ?? 'closed'}
        clip={editor}
        onSync={() => setSyncOpen(true)}
        onClose={() => setEditor(null)}
        onUpdate={(updated) => {
          setEditor(updated);
          refreshLibrary();
        }}
        onDelete={onClipDeleted}
      />
      <Dialog
        open={importOpen}
        onOpenChange={(value) => {
          if (!busy) {
            setImportOpen(value);
            setImportError('');
            setBackup([]);
          }
        }}
      >
        <DialogContent className="settings-dialog">
          <DialogTitle>Bring your text back</DialogTitle>
          <DialogDescription>
            Choose a text backup exported from this workspace. Originals,
            versions and pins will be preserved. Existing items are never
            overwritten.
          </DialogDescription>
          <label htmlFor="backup-file" className="field-label">
            Text backup (.json)
          </label>
          <Input
            id="backup-file"
            className="field"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => void readBackup(event.target.files?.[0])}
          />
          {backup.length > 0 && (
            <p>{backup.length} items ready to import.</p>
          )}
          {importError && (
            <Alert variant="destructive" className="error-message" role="alert">
              <AlertDescription>{importError}</AlertDescription>
            </Alert>
          )}
          {importProgress && (
            <output className="subtle">{importProgress}</output>
          )}
          <Button
            className="control"
            disabled={busy || !backup.length}
            onClick={() => void restoreBackup()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Download />}{' '}
            Import backup
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent className="settings-dialog">
          <DialogTitle>Keep Catch-all Desk one tap away</DialogTitle>
          <DialogDescription>
            Add it to your home screen for an app-like workspace.
          </DialogDescription>
          <div className="install-brand">
            <Image
              src="/icons/icon-192.png"
              alt="Catch-all Desk app icon"
              width={70}
              height={70}
              unoptimized
            />
            <strong>Catch-all Desk</strong>
          </div>
          {installPrompt ? (
            <Button
              className="control"
              onClick={() =>
                void run(async () => {
                  await installPrompt.prompt();
                  await installPrompt.userChoice;
                  setInstallPrompt(null);
                  setInstallOpen(false);
                })
              }
            >
              Install Catch-all Desk
            </Button>
          ) : (
            <>
              <p>
                <strong>On iPhone or iPad</strong>
                <br />
                <span className="subtle">
                  Open this site in Safari, tap Share, then choose Add to Home
                  Screen.
                </span>
              </p>
              <p>
                <strong>On desktop or Android</strong>
                <br />
                <span className="subtle">
                  Open the browser menu and choose Install app or Add to Home
                  Screen when available.
                </span>
              </p>
            </>
          )}
          <p className="subtle text-sm">
            Your saved Clipboard and Documents need a connection. The installed
            app opens the same private workspace as this site.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={copyText !== null}
        onOpenChange={(value) => {
          if (!value) setCopyText(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Copy your words</DialogTitle>
          <DialogDescription>Select and copy the text below.</DialogDescription>
          <Textarea
            aria-label="Text to copy"
            className="field"
            readOnly
            value={copyText ?? ''}
            onFocus={(e) => e.target.select()}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
