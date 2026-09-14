'use client';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { watchVisibleList } from '@/lib/live-list';

type Name = 'text' | 'images';
type State = {
  active: boolean;
  syncing: boolean;
  failed: boolean;
  lastSynced: number | null;
};
type Watch = (
  name: Name,
  refresh: (signal: AbortSignal) => Promise<void>,
) => () => void;
const initial: State = {
  active: false,
  syncing: false,
  failed: false,
  lastSynced: null,
};
const Context = createContext<{
  watch: Watch;
  syncNow: () => void;
  states: Record<Name, State>;
} | null>(null);

export function ClipboardSyncProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState({ text: initial, images: initial });
  const watchers = useRef(new Map<Name, ReturnType<typeof watchVisibleList>>());
  const watch = useCallback<Watch>((name, refresh) => {
    const update = (change: Partial<State>) =>
      setStates((old) => ({ ...old, [name]: { ...old[name], ...change } }));
    const stop = watchVisibleList(refresh, {
      start: () => update({ syncing: true }),
      success: () =>
        update({ syncing: false, failed: false, lastSynced: Date.now() }),
      error: () => update({ syncing: false, failed: true }),
    });
    watchers.current.set(name, stop);
    update({ active: true, syncing: false });
    void stop.refresh();
    return () => {
      stop();
      if (watchers.current.get(name) === stop) {
        watchers.current.delete(name);
        update({ active: false, syncing: false });
      }
    };
  }, []);
  const syncNow = useCallback(() => {
    for (const watcher of watchers.current.values()) void watcher.refresh();
  }, []);
  return (
    <Context.Provider value={{ watch, syncNow, states }}>
      {children}
    </Context.Provider>
  );
}

export function useClipboardSync() {
  const value = useContext(Context);
  if (!value) throw new Error('Clipboard sync provider is missing.');
  return value;
}

export function ClipboardSyncControls({
  sources = ['text', 'images'],
}: {
  sources?: Name[];
}) {
  const { states, syncNow } = useClipboardSync();
  const values = sources.map((name) => states[name]);
  const syncing = values.some((state) => state.syncing);
  const ready = values.every((state) => state.active);
  const failed = values.some((state) => state.failed);
  const lastSynced = values.every((state) => state.lastSynced !== null)
    ? Math.min(...values.map((state) => state.lastSynced!))
    : null;
  const message = !ready
    ? 'Sync paused while loading, editing, or saving.'
    : syncing
      ? 'Checking for new items…'
      : failed
        ? 'Could not sync. Check your connection and sign-in, then retry.'
        : lastSynced
          ? `Last synced ${new Date(lastSynced).toLocaleTimeString()}`
          : 'Waiting to sync…';
  return (
    <div className="clipboard-sync-controls">
      <output className="subtle text-sm" aria-live="polite">
        {message}
      </output>
      <Button
        variant="outline"
        className="control"
        onClick={syncNow}
        disabled={!ready || syncing}
      >
        <RefreshCw className={syncing ? 'animate-spin' : ''} />
        {syncing ? 'Syncing…' : 'Sync now'}
      </Button>
    </div>
  );
}
