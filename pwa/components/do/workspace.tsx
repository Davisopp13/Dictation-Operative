'use client';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
} from 'react';
import {
  Clipboard,
  Settings,
  Pin,
  Download,
  LoaderCircle,
  WifiOff,
  Smartphone,
  Copy,
  BookOpen,
  FolderOpen,
} from 'lucide-react';
import Image from 'next/image';
import { Wordmark } from './wordmark';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { SidebarProvider, Sidebar } from '@/components/ui/sidebar';
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
import { ThemeToggle } from './theme';
import { MobileMenu } from './mobile-menu';
import { QuickStartDialog } from './quick-start';
import { SettingsDialog, type SettingsState } from '@/components/do/settings';
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
  ['content', 'Documents', FolderOpen],
] as const;
const subscribeHydration = () => () => {};
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
  const [view, setActiveView] = useState<View>(initialNavigation.view),
    [query, setQuery] = useState(''),
    [clips, setClips] = useState<ClipSummary[]>([]),
    [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [settings, setSettings] = useState<SettingsState>({}),
    [settingsOpen, setSettingsOpen] = useState(false),
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
    await run(async () => setEditor(await api<Clip>('clips/' + id)));
  }
  async function copyClip(item: ClipSummary) {
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
      setClips((current) => [
        ...current,
        ...r.items.filter((c) => !current.some((old) => old.id === c.id)),
      ]);
      setHasMore(r.hasMore);
    });
  }
  // The whole card stays clickable, but the button no longer wraps the
  // heading and the time — it names the thought and stretches over the card.
  const card = (item: ClipSummary) => (
    <article className="thought-card" key={item.id}>
      <div className="thought-main">
        <div className="thought-meta">
          <span>
            {item.kind === 'combined'
              ? 'Draft'
              : item.kind === 'prompt'
                ? 'AI prompt'
                : item.kind}
          </span>
          <time dateTime={new Date(item.createdAt).toISOString()}>
            {new Date(item.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </time>
        </div>
        <h3>
          <button
            type="button"
            className="thought-open"
            disabled={locked}
            onClick={() => void openClip(item.id)}
          >
            {item.title}
          </button>
        </h3>
        <p>{item.content}</p>
        {(item.collection || item.tags.length > 0) && (
          <span className="subtle text-sm">
            {[item.collection, ...item.tags.map((t) => '#' + t)]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>
      <div className="thought-actions">
        <Button
          variant="ghost"
          size="icon"
          className="icon-control"
          disabled={locked}
          onClick={() => void pinClip(item)}
          aria-label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
        >
          <Pin
            className={item.pinned ? 'text-primary' : ''}
            fill={item.pinned ? 'currentColor' : 'none'}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="icon-control"
          disabled={locked}
          onClick={() => void copyClip(item)}
          aria-label={`Copy ${item.title}`}
        >
          <Copy />
        </Button>
        <DeleteClipboardText
          clip={item}
          locked={locked}
          onDelete={onClipDeleted}
        />
      </div>
    </article>
  );
  return (
    <SidebarProvider>
      <Toaster />
      <Sidebar collapsible="none" className="app-sidebar">
        <div className="brand">
          <Wordmark />
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map(([id, label, Icon]) => (
            <Button
              key={id}
              className="nav-button"
              variant={view === id ? 'secondary' : 'ghost'}
              aria-busy={busy || undefined}
              aria-current={view === id ? 'page' : undefined}
              onClick={() => setView(id)}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </nav>
        <div className="side-bottom">
          <Button variant="ghost" className="nav-button mb-4" onClick={() => setHelpOpen(true)}>
            <BookOpen /> Help · Quick start
          </Button>
          <span className="mini-label">
            Paste, upload, or scan in. Copy, share, or print out.
          </span>
          {!installed && (
            <Button
              variant="outline"
              className="control w-full mt-4"
              onClick={() => setInstallOpen(true)}
            >
              <Smartphone /> Install app
            </Button>
          )}
          <p className="mt-5">
            Catchall Desk<br />
            Your private workspace across devices
          </p>
        </div>
      </Sidebar>
      <main className="workspace">
        <header className="topbar">
          <span className="brand mobile-brand">
            <Wordmark />
          </span>
          <div className="actions m-0 desktop-header-actions">
            <ThemeToggle />
            <Button
              variant="outline"
              className="control"
              disabled={locked}
              onClick={() => setToolsOpen(true)}
            >
              Collections
            </Button>

            {!installed && (
              <Button
                className="control mobile-install"
                variant="ghost"
                onClick={() => setInstallOpen(true)}
                aria-label="Install Catchall Desk"
              >
                <Smartphone />
              </Button>
            )}
            <Button
              variant="outline"
              className="control"
              onClick={() => setSyncOpen(true)}
            >
              Sync
            </Button>
            <Button
              variant="outline"
              className="control"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings /> Settings
            </Button>
          </div>
          <MobileMenu
            locked={locked}
            installed={installed}
            onTools={() => setToolsOpen(true)}
            onSync={() => setSyncOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            onInstall={() => setInstallOpen(true)}
            onHelp={() => setHelpOpen(true)}
          />
        </header>
        <Recovery
          disabled={locked}
          onSaved={(clip) => {
            setEditor(clip);
            refreshLibrary();
          }}
        />
        <div className="content">
          {!online && (
            <output className="banner">
              <WifiOff size={18} /> You’re offline. Reconnect to load, save,
              or sync your items.
            </output>
          )}
          {updateReady && (
            <div className="banner">
              A new version of Catchall Desk is ready.
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
          <div className="intro">
            <div className="eyebrow">
              {view === 'clipboard'
                ? 'Ready to use again'
                : 'Within reach, across devices'}
            </div>
            <h1>{view === 'clipboard' ? 'Clipboard' : 'Documents'}</h1>
            <p className="subtle">
              {view === 'clipboard'
                ? 'All your saved text and images. Pin an item to keep it handy, or copy it to use in another app.'
                : 'Files and Google links you deliberately keep handy. Open them from any device signed into this account.'}
            </p>
          </div>
          {documentsOpened && (
            <div hidden={view !== 'content'}>
              <ContentTray key={account} active={view === 'content'} />
            </div>
          )}
          {view !== 'content' && (
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
              setImportOpen={setImportOpen}
              exportLibrary={exportLibrary}
              locked={locked}
              accountEmail={email}
              onClipboardSaved={() => {
                setClipboardFilter('all');
                setQuery('');
                setCollectionFilter('');
                setTagFilter('');
                refreshLibrary();
              }}
            />
          )}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.map(([id, label, Icon]) => (
          <Button
            key={id}
            variant={view === id ? 'secondary' : 'ghost'}
            aria-busy={busy || undefined}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => setView(id)}
          >
            <span className="mobile-nav-icon">
              <Icon />
            </span>
            <span>{label}</span>
          </Button>
        ))}
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
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettings={setSettings}
        startPage={startPage}
        onStartPageChange={(next) => {
          saveStartPage(account, next);
          setStartPage(next);
        }}
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
          <DialogTitle>Keep Catchall Desk one tap away</DialogTitle>
          <DialogDescription>
            Add it to your home screen for an app-like workspace.
          </DialogDescription>
          <div className="install-brand">
            <Image
              src="/icons/icon-192.png"
              alt="Catchall Desk app icon"
              width={70}
              height={70}
              unoptimized
            />
            <strong>Catchall Desk</strong>
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
              Install Catchall Desk
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
    </SidebarProvider>
  );
}
