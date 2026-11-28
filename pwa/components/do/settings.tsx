'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { workspacePages, type WorkspacePage } from '@/lib/workspace-navigation';
import { post, errorMessage } from '@/lib/client';
import { authClient } from '@/lib/auth-client';
import { ScreenTitle } from './screen-title';
import { useTheme, type Theme } from './theme';

export type SettingsState = {
  clipboardDailyCleanup?: boolean;
  logoutPath?: string;
};

const themes: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Daylight' },
  { value: 'dark', label: 'Midnight' },
  { value: 'system', label: 'Match device' },
];

/** How many devices this browser is paired with, read from its own storage. */
function usePairing(account: string) {
  const [pairing, setPairing] = useState<{
    name: string;
    paired: number;
  } | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        const saved = JSON.parse(
          localStorage.getItem(`do-sync-v1:${account}`) ?? 'null',
        ) as { device?: { name?: string }; pairs?: unknown[] } | null;
        setPairing(
          saved
            ? {
                name: saved.device?.name ?? '',
                paired: Array.isArray(saved.pairs) ? saved.pairs.length : 0,
              }
            : null,
        );
      } catch {
        setPairing(null);
      }
    };
    read();
    window.addEventListener('focus', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('focus', read);
      window.removeEventListener('storage', read);
    };
  }, [account]);
  return pairing;
}

/** The Settings screen. It opens from the sidebar; a visit never starts here. */
export function SettingsPage({
  account,
  email,
  settings,
  onSettings,
  startPage,
  onStartPageChange,
  locked,
  onSync,
  onCollections,
  onExport,
  onImport,
}: {
  account: string;
  email: string;
  settings: SettingsState;
  onSettings: (s: SettingsState) => void;
  startPage: WorkspacePage;
  onStartPageChange: (page: WorkspacePage) => void;
  locked: boolean;
  onSync: () => void;
  onCollections: () => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const pairing = usePairing(account);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  async function change(data: unknown) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      onSettings(await post<SettingsState>('settings', data));
      setSuccess('Settings saved.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ScreenTitle
        title="Settings"
        subtitle="Where the app opens and how long Clipboard items are kept."
        accent="sticky"
      />
      {error && (
        <p className="settings-message is-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <output className="settings-message" aria-live="polite">
          {success}
        </output>
      )}
      <div className="settings-grid">
        <section className="settings-card" aria-labelledby="set-start">
          <h2 id="set-start">Start page</h2>
          <p>
            Where a fresh visit lands. Refreshing keeps the tab you were on.
          </p>
          <fieldset
            className="segmented segmented-fill"
            aria-label="Start page"
          >
            {workspacePages.map((page) => (
              <button
                key={page.value}
                type="button"
                aria-pressed={startPage === page.value}
                onClick={() => {
                  setError('');
                  setSuccess('');
                  try {
                    onStartPageChange(page.value);
                    setSuccess('Start page saved.');
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                {page.label}
              </button>
            ))}
          </fieldset>
        </section>

        <section className="settings-card" aria-labelledby="set-sync">
          <div className="settings-card-head">
            <h2 id="set-sync">Device Sync</h2>
            {pairing && pairing.paired > 0 && (
              <span className="badge-mint">{pairing.paired} paired</span>
            )}
          </div>
          <p>
            Hand text and images straight to a paired device. Encrypted end to
            end and gone from the relay in two minutes.
          </p>
          {pairing?.name && (
            <ul className="settings-list">
              <li>
                {pairing.name} <span>This device</span>
              </li>
            </ul>
          )}
          <button type="button" className="button-secondary" onClick={onSync}>
            {pairing && pairing.paired > 0 ? 'Open Sync' : 'Pair a device'}
          </button>
        </section>

        <section className="settings-card" aria-labelledby="set-clean">
          <h2 id="set-clean">Daily Clipboard cleanup</h2>
          <p id="clipboard-cleanup-description">
            Once a day, removes unpinned Clipboard text and images older than 24
            hours when they have no protection, even when the app is closed.
            Pinned items, piled items, pending collections and Documents stay
            put, and so do earlier dictation history and text saved before this
            setting existed.
          </p>
          <label className="settings-switch" htmlFor="clipboard-daily-cleanup">
            Clean up unpinned items daily
            <Switch
              id="clipboard-daily-cleanup"
              checked={!!settings.clipboardDailyCleanup}
              disabled={busy}
              aria-describedby="clipboard-cleanup-description"
              onCheckedChange={(enabled) =>
                void change({ action: 'clipboard-cleanup', enabled })
              }
            />
          </label>
        </section>

        <section className="settings-card" aria-labelledby="set-theme">
          <h2 id="set-theme">Appearance</h2>
          <fieldset className="segmented segmented-fill" aria-label="Theme">
            {themes.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={theme === option.value}
                onClick={() => setTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
        </section>

        <section className="settings-card" aria-labelledby="set-collections">
          <h2 id="set-collections">Collections</h2>
          <p>
            Suggested collection names for organizing saved text. Give any saved
            text a collection and tags when you open it.
          </p>
          <button
            type="button"
            className="button-secondary"
            disabled={locked}
            onClick={onCollections}
          >
            Edit collections
          </button>
        </section>

        <section className="settings-card" aria-labelledby="set-account">
          <h2 id="set-account">Account sign-in</h2>
          <p>
            Signed in as <strong className="break-all">{email}</strong>. Use the
            same account on another device to see the same Clipboard and
            Documents.
          </p>
          <div className="settings-actions">
            <Link href="/account/sign-in" className="button-secondary">
              Sign-in methods
            </Link>
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const result = await authClient.signOut();
                  if (result.error)
                    throw new Error(
                      result.error.message || 'Could not sign out.',
                    );
                  window.location.assign(settings.logoutPath ?? '/login');
                } catch (e) {
                  setError(errorMessage(e));
                  setBusy(false);
                }
              }}
            >
              Sign out
            </button>
          </div>
        </section>

        <section className="settings-card" aria-labelledby="set-backup">
          <h2 id="set-backup">Backup</h2>
          <p>
            A complete copy of your saved text, versions included. Images and
            Documents are not part of it.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="button-secondary"
              disabled={locked}
              onClick={onExport}
            >
              Export
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={locked}
              onClick={onImport}
            >
              Import
            </button>
          </div>
        </section>
      </div>
      <p className="settings-foot">
        Your saved Clipboard and Documents need a connection.{' '}
        <Link href="/privacy" className="text-link">
          Privacy & storage
        </Link>
      </p>
    </>
  );
}
