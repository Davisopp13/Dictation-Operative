'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'do-theme';
const ORDER: Theme[] = ['system', 'light', 'dark'];

const LABEL: Record<Theme, string> = {
  system: 'Match my device',
  light: 'Light',
  dark: 'Dark',
};

function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

let listeners: (() => void)[] = [];

function subscribe(notify: () => void) {
  listeners = [...listeners, notify];
  window.addEventListener('storage', notify);
  return () => {
    listeners = listeners.filter((l) => l !== notify);
    window.removeEventListener('storage', notify);
  };
}

function getSnapshot(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark' || value === 'system')
      return value;
  } catch {
    // Private mode and blocked storage both land here.
  }
  return 'system';
}

function getServerSnapshot(): Theme {
  return 'system';
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => apply('system');
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // The choice still applies for this visit.
    }
    apply(next);
    for (const notify of listeners) notify();
  }, []);

  return { theme, setTheme };
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];

  return (
    <Button
      variant="outline"
      className="icon-control"
      aria-label={`Appearance: ${LABEL[theme]}. Switch to ${LABEL[next].toLowerCase()}.`}
      title={`Appearance: ${LABEL[theme]}`}
      onClick={() => setTheme(next)}
    >
      <Icon />
    </Button>
  );
}
