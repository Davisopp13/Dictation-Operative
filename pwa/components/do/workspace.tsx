'use client';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
} from 'react';
import {
  Mic,
  Clipboard,
  Layers,
  Settings,
  Pin,
  Download,
  LoaderCircle,
  WifiOff,
  Smartphone,
  Copy,
  BookOpen,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { SidebarProvider, Sidebar } from '@/components/ui/sidebar';
import { Checkbox } from '@/components/ui/checkbox';
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
import { CaptureSurface } from './capture';
import { LibrarySurface } from './library';
import { DeleteClipboardText } from './delete-clipboard-text';
import { formatNames, type ComposeFormat } from './compose';
import { ThemeToggle } from './theme';
import { MobileMenu } from './mobile-menu';
import { QuickStartDialog } from './quick-start';
import { SettingsDialog, type SettingsState } from '@/components/do/settings';
import { SyncDialog } from '@/components/do/sync';
import { ClipEditor } from '@/components/do/editor';
import { api, post, errorMessage, download } from '@/lib/client';
import { refreshPages } from '@/lib/live-list';
import { ClipboardSyncProvider, useClipboardSync } from './clipboard-sync';
import {
  combineTexts,
  type Clip,
  type ClipSummary,
  type ClipKind,
} from '@/lib/domain';
import { parseBackup } from '@/lib/backup';
import { installWebTools } from '@/lib/webmcp';
type View = 'capture' | 'clipboard' | 'compose';
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
  ['capture', 'Capture', Mic],
  ['clipboard', 'Clipboard', Clipboard],
  ['compose', 'Compose', Layers],
] as const;
export default function Home({
  account,
  email,
}: {
  account: string;
  email: string;
}) {
  return (
    <WorkspaceToolsProvider account={account}>
      <ClipboardSyncProvider>
        <HomeContent account={account} email={email} />
      </ClipboardSyncProvider>
    </WorkspaceToolsProvider>
  );
}
function HomeContent({ account, email }: { account: string; email: string }) {
  const organization = useWorkspaceTools();
  const { watch: watchClipboard } = useClipboardSync();
  const [toolsOpen, setToolsOpen] = useState(false),
    [templateId, setTemplateId] = useState(''),
    [collectionFilter, setCollectionFilter] = useState(''),
    [tagFilter, setTagFilter] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [clipboardFilter, setClipboardFilter] = useState<
    'all' | 'pinned' | 'images'
  >('all');
  const [view, setActiveView] = useState<View>('capture'),
    [mode, setMode] = useState<ClipKind>('note'),
    [query, setQuery] = useState(''),
    [clips, setClips] = useState<ClipSummary[]>([]),
    [recent, setRecent] = useState<ClipSummary[]>([]),
    [recentLoading, setRecentLoading] = useState(true),
    [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [settings, setSettings] = useState<SettingsState>({
      connected: false,
      consent: false,
      secureStorage: true,
    }),
    [settingsLoaded, setSettingsLoaded] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [editor, setEditor] = useState<Clip | null>(null),
    [, setSurfacedMessage] = useState(''),
    [incoming, setIncoming] = useState(''),
    [text, setText] = useState(''),
    [textOpen, setTextOpen] = useState(false),
    [selected, setSelected] = useState<ClipSummary[]>([]),
    [format, setFormat] = useState<ComposeFormat>('join'),
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
  const createId = useRef(''),
    composeId = useRef(''),
    latest = useRef({
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
  const locked = busy || recording;
  // Navigation only locks during an active recording: leaving the screen stops
  // capture. A slow export or save must never freeze the whole workspace.
  const navLocked = recording;
  const viewFilters = useRef<
    Partial<Record<View, { query: string; collection: string; tag: string }>>
  >({});
  const setView = useCallback(
    (next: View) => {
      if (recording || next === view) return;
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
      setActiveView(next);
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [view, recording, query, collectionFilter, tagFilter],
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
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setSettingsLoaded(true));
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
    if (view === 'clipboard' && clipboardFilter === 'images') {
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
  useEffect(() => {
    void api<{ items: ClipSummary[] }>('library')
      .then((r) => setRecent(r.items.slice(0, 3)))
      .catch(() => {})
      .finally(() => setRecentLoading(false));
  }, [refresh]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (text || incoming) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [text, incoming]);
  function ensureCloud() {
    if (!online) {
      setError('Connect to the internet to record or use AI.');
      return false;
    }
    if (!settings.connected || !settings.consent) {
      setSettingsOpen(true);
      return false;
    }
    return true;
  }
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
  async function createCapture(content: string, id: string) {
    if (mode === 'reply' && !incoming.trim())
      throw new Error('Paste the incoming message before recording a reply.');
    let saved = await post<Clip>('clips', {
      id,
      content,
      kind: mode,
      context: mode === 'reply' ? incoming : '',
    });
    refreshLibrary();
    setText('');
    setTextOpen(false);
    createId.current = '';
    if (
      (templateId || mode === 'reply' || mode === 'prompt') &&
      settings.connected &&
      settings.consent
    ) {
      try {
        const transformed = await post<{ text: string }>('transform', {
          kind: mode === 'note' ? 'rewrite' : mode,
          templateId: templateId || undefined,
          text: saved.content,
          context: saved.context,
        });
        saved = await api<Clip>('clips/' + saved.id, {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'transform',
            content: transformed.text,
            versionKind: 'rewritten',
            revision: saved.revision,
          }),
        });
        refreshLibrary();
      } catch (e) {
        setError('Your original was saved. ' + errorMessage(e));
      }
    }
    setEditor(saved);
    setIncoming('');
    setMessage(
      mode === 'note'
        ? 'Thought saved.'
        : `Your ${mode === 'reply' ? 'reply' : 'prompt'} is ready to review.`,
    );
  }
  function toggleSelection(clip: ClipSummary) {
    setSelected((current) =>
      current.some((c) => c.id === clip.id)
        ? current.filter((c) => c.id !== clip.id)
        : current.length < 20
          ? [...current, clip]
          : current,
    );
    composeId.current = '';
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
    setSelected((current) => current.filter((c) => c.id !== id));
    setClips((current) => current.filter((c) => c.id !== id));
    setRecent((current) => current.filter((c) => c.id !== id));
    composeId.current = '';
    refreshLibrary();
    setMessage('Text deleted from Clipboard.');
  }
  async function pinClip(item: ClipSummary) {
    await run(async () => {
      const updated = await api<Clip>('clips/' + item.id, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'pin',
          pinned: !item.pinned,
          revision: item.revision,
        }),
      });
      setSelected((current) =>
        current.map((c) => (c.id === updated.id ? updated : c)),
      );
      refreshLibrary();
    });
  }
  async function compose() {
    if (format !== 'join' && !ensureCloud()) return;
    await run(async () => {
      const full = await Promise.all(
        selected.map((c) => api<Clip>('clips/' + c.id)),
      );
      const source = combineTexts(full);
      composeId.current ||= crypto.randomUUID();
      let saved = await post<Clip>('clips', {
        id: composeId.current,
        content: source,
        title: format === 'join' ? 'Combined thoughts' : formatNames[format],
        kind: 'combined',
      });
      refreshLibrary();
      if (format !== 'join') {
        try {
          const result = await post<{ text: string }>('transform', {
            kind: format,
            text: source,
          });
          saved = await api<Clip>('clips/' + saved.id, {
            method: 'PATCH',
            body: JSON.stringify({
              action: 'transform',
              content: result.text,
              versionKind: 'rewritten',
              revision: saved.revision,
            }),
          });
        } catch (e) {
          setError('Your combined source was saved. ' + errorMessage(e));
        }
      }
      setEditor(saved);
      setSelected([]);
      composeId.current = '';
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
        `Imported ${imported} thoughts. Existing thoughts were kept unchanged.`,
      );
      setBackup([]);
      setImportOpen(false);
      refreshLibrary();
    } catch (e) {
      setImportError(
        `${imported} thoughts restored so far. ${errorMessage(e)} You can retry this backup safely.`,
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
        `Exported ${all.length} thoughts with originals and versions.`,
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
  async function paste() {
    try {
      const value = await navigator.clipboard.readText();
      if (value.length > 20000)
        throw new Error(
          'Clipboard text is too long. Paste a smaller selection (up to 20,000 characters).',
        );
      setText(value);
      setTextOpen(true);
    } catch (e) {
      setTextOpen(true);
      setMessage(
        e instanceof Error && e.message.includes('too long')
          ? e.message
          : 'Paste directly into the text field using your keyboard or touch menu.',
      );
    }
  }
  const toolsState = useRef({
    clips,
    selected,
    locked,
    editor,
    text,
    incoming,
    navigate: setView,
  });
  useEffect(() => {
    toolsState.current = {
      clips,
      selected,
      locked,
      editor,
      text,
      incoming,
      navigate: setView,
    };
  }, [clips, selected, locked, editor, text, incoming, setView]);
  useEffect(
    () =>
      installWebTools({
        search: async (query) => {
          toolsState.current.navigate('clipboard');
          setClipboardFilter('all');
          setQuery(query);
          const r = await api<{ items: ClipSummary[] }>(
            'library?q=' + encodeURIComponent(query),
          );
          setClips(r.items);
          return r.items.map(({ id, title, kind, pinned }) => ({
            id,
            title,
            kind,
            pinned,
          }));
        },
        open: async (id) => {
          if (toolsState.current.locked || toolsState.current.editor)
            throw new Error(
              'Finish the current recording or close the editor first.',
            );
          const clip = await api<Clip>('clips/' + id);
          setEditor(clip);
          return { id: clip.id, title: clip.title };
        },
        stage: async (input) => {
          if (
            toolsState.current.locked ||
            toolsState.current.editor ||
            toolsState.current.text ||
            toolsState.current.incoming
          )
            throw new Error(
              'Finish your current draft before staging another.',
            );
          toolsState.current.navigate('capture');
          setMode(input.kind);
          setText(input.text);
          setIncoming(input.context);
          setTextOpen(true);
          return { status: 'staged', saved: false };
        },
      }),
    [],
  );
  // The whole card stays clickable, but the button no longer wraps the
  // heading and the time — it names the thought and stretches over the card.
  const card = (item: ClipSummary, selectable = false) => (
    <article className="thought-card" key={item.id}>
      {selectable && (
        <Checkbox
          checked={selected.some((c) => c.id === item.id)}
          onCheckedChange={() => toggleSelection(item)}
          disabled={
            (!selected.some((c) => c.id === item.id) &&
              selected.length >= 20) ||
            locked
          }
          aria-label={`Select ${item.title}`}
        />
      )}
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
          <Image
            src="/icons/icon-192.png"
            alt="DO"
            width={44}
            height={44}
            unoptimized
          />
          <span className="brand-label">Voice workspace</span>
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map(([id, label, Icon]) => (
            <Button
              key={id}
              className="nav-button"
              variant={view === id ? 'secondary' : 'ghost'}
              disabled={navLocked}
              aria-busy={busy || undefined}
              aria-current={view === id ? 'page' : undefined}
              onClick={() => setView(id)}
            >
              <Icon />
              {label}
              {id === 'compose' && selected.length > 0 && (
                <span className="count-badge">{selected.length}</span>
              )}
            </Button>
          ))}
        </nav>
        <div className="side-bottom">
          <Button variant="ghost" className="nav-button mb-4" disabled={navLocked} onClick={() => setHelpOpen(true)}>
            <BookOpen /> Help · Quick start
          </Button>
          <span className="mini-label">
            A little room for your next big idea.
          </span>
          {!installed && (
            <Button
              variant="outline"
              className="control w-full mt-4"
              onClick={() => setInstallOpen(true)}
            >
              <Smartphone /> Install DO
            </Button>
          )}
          <p className="mt-5">
            DO · Version 2<br />
            Your private voice workspace
          </p>
        </div>
      </Sidebar>
      <main className="workspace">
        <header className="topbar">
          <span className="brand mobile-brand">
            <Image
              src="/icons/icon-192.png"
              alt="DO Voice Workspace"
              width={44}
              height={44}
              unoptimized
            />
          </span>
          <div className="actions m-0 desktop-header-actions">
            <ThemeToggle />
            <Button
              variant="outline"
              className="control"
              disabled={locked}
              onClick={() => setToolsOpen(true)}
            >
              Workspace tools
            </Button>

            {!installed && (
              <Button
                className="control mobile-install"
                variant="ghost"
                onClick={() => setInstallOpen(true)}
                aria-label="Install DO"
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
              <span
                className={`status-dot ${settings.connected && settings.consent ? 'ready' : ''}`}
                aria-hidden="true"
              />
              <Settings /> Settings
              <span className="sr-only">
                {settings.connected && settings.consent
                  ? 'Voice and AI connected'
                  : 'Voice and AI not set up yet'}
              </span>
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
          ensureCloud={ensureCloud}
          onRecovered={(clip) => {
            setEditor(clip);
            refreshLibrary();
          }}
        />
        <div className="content">
          {!online && (
            <output className="banner">
              <WifiOff size={18} /> You’re offline. Recordings stay on this
              device. Reconnect to preserve unsaved words.
            </output>
          )}
          {updateReady && (
            <div className="banner">
              A new version of DO is ready.
              <Button
                variant="outline"
                className="control"
                disabled={locked || !!editor || !!text || !!incoming}
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            </div>
          )}
          <div className="intro">
            <div className="eyebrow">
              {view === 'capture'
                ? 'Made for your train of thought'
                : view === 'clipboard'
                  ? 'Ready to use again'
                  : 'Give your thoughts a little shape'}
            </div>
            <h1>
              {view === 'capture'
                ? 'Say it. Make it useful.'
                : view === 'clipboard'
                  ? 'Clipboard'
                  : 'A few thoughts. One good draft.'}
            </h1>
            <p className="subtle">
              {view === 'capture'
                ? 'A quick thought, a thoughtful reply, or the start of something bigger.'
                : view === 'clipboard'
                  ? 'All your saved words and images. Pin text to keep it handy, or copy an item to use it in another app.'
                  : 'Choose your clips, put them in order, and decide what to make.'}
            </p>
          </div>
          {view === 'capture' ? (
            <CaptureSurface
              settingsLoaded={settingsLoaded}
              settings={settings}
              setSettingsOpen={setSettingsOpen}
              locked={locked}
              busy={busy}
              mode={mode}
              setMode={setMode}
              incoming={incoming}
              setIncoming={setIncoming}
              templateId={templateId}
              setTemplateId={setTemplateId}
              text={text}
              setText={setText}
              textOpen={textOpen}
              setTextOpen={setTextOpen}
              setError={setError}
              setRecording={setRecording}
              createCapture={createCapture}
              nextCaptureId={() => {
                createId.current ||= crypto.randomUUID();
                return createId.current;
              }}
              resetCaptureId={() => {
                createId.current = '';
              }}
              run={run}
              paste={paste}
              recent={recent}
              recentLoading={recentLoading}
              card={card}
              setView={setView}
              setQuery={setQuery}
            />
          ) : (
            <LibrarySurface
              view={view}
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
              setView={setView}
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
              selected={selected}
              setSelected={setSelected}
              toggleSelection={toggleSelection}
              format={format}
              setFormat={setFormat}
              compose={compose}
              resetComposeId={() => {
                composeId.current = '';
              }}
              setImportOpen={setImportOpen}
              exportLibrary={exportLibrary}
              busy={busy}
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
            disabled={navLocked}
            aria-busy={busy || undefined}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => setView(id)}
          >
            <span className="mobile-nav-icon">
              <Icon />
              {id === 'compose' && selected.length > 0 && (
                <span className="mobile-nav-count">{selected.length}</span>
              )}
            </span>
            <span>{label}</span>
          </Button>
        ))}
      </nav>
      <QuickStartDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <SyncDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        onSettings={setSettings}
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
      />
      <ClipEditor
        key={editor?.id ?? 'closed'}
        clip={editor}
        onSync={() => setSyncOpen(true)}
        onClose={() => setEditor(null)}
        ensureCloud={ensureCloud}
        onUpdate={(updated) => {
          setEditor(updated);
          setSelected((current) =>
            current.map((c) => (c.id === updated.id ? updated : c)),
          );
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
          <DialogTitle>Bring your words back</DialogTitle>
          <DialogDescription>
            Choose a DO text backup (existing library exports also work).
            Originals, versions and pins will be preserved. Existing thoughts
            are never overwritten.
          </DialogDescription>
          <label htmlFor="backup-file" className="field-label">
            DO text backup (.json)
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
            <p>{backup.length} thoughts ready to import.</p>
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
          <DialogTitle>Keep DO one tap away</DialogTitle>
          <DialogDescription>
            Add it to your home screen for an app-like workspace.
          </DialogDescription>
          <div className="install-brand">
            <Image
              src="/icons/icon-192.png"
              alt="DO app icon"
              width={70}
              height={70}
              unoptimized
            />
            <strong>DO · Voice Workspace</strong>
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
              Install DO
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
            After your first online visit, you can capture recordings offline.
            Reconnect to transcribe, save to Clipboard, and use AI. Recording
            stops if you leave the app.
          </p>
          <div className="border-t pt-4 text-sm">
            <p>Want to dictate outside this window?{' '}
              <Link href="/mac" target="_blank" rel="noopener" className="text-link">Get the Mac app</Link>.
            </p>
            <p className="subtle mt-2">Find downloads and step-by-step instructions in <strong>Settings → Desktop apps</strong>, including the{' '}
              <Link href="/windows" target="_blank" rel="noopener" className="text-link">Windows test app</Link>.
            </p>
          </div>
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
