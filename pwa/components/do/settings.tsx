'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { NativeSelect } from '@/components/ui/native-select';
import {
  isWorkspacePage,
  workspacePages,
  type WorkspacePage,
} from '@/lib/workspace-navigation';
import { post, errorMessage } from '@/lib/client';
import { authClient } from '@/lib/auth-client';
export type SettingsState = {
  clipboardDailyCleanup?: boolean;
  logoutPath?: string;
};
export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettings,
  startPage,
  onStartPageChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SettingsState;
  onSettings: (s: SettingsState) => void;
  startPage: WorkspacePage;
  onStartPageChange: (page: WorkspacePage) => void;
}) {
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
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setError('');
          setSuccess('');
          onOpenChange(value);
        }
      }}
    >
      <DialogContent className="settings-dialog">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Choose where the app opens and how long Clipboard items are kept.
          </DialogDescription>
        </DialogHeader>
        <div>
          <label className="field-label" htmlFor="start-page">
            Start page
          </label>
          <NativeSelect
            id="start-page"
            className="field"
            value={startPage}
            aria-describedby="start-page-description"
            onChange={(event) => {
              const next = event.target.value;
              if (!isWorkspacePage(next)) return;
              setError('');
              setSuccess('');
              try {
                onStartPageChange(next);
                setSuccess('Start page saved.');
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            {workspacePages.map((page) => (
              <option key={page.value} value={page.value}>
                {page.label}
              </option>
            ))}
          </NativeSelect>
          <p id="start-page-description" className="subtle text-sm mt-2">
            Choose where Catchall Desk opens on a fresh visit. Refreshing keeps
            your current tab. Saved for your account in this browser.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="clipboard-daily-cleanup" className="font-semibold">
              Daily Clipboard cleanup
            </label>
            <Switch
              id="clipboard-daily-cleanup"
              checked={!!settings.clipboardDailyCleanup}
              disabled={busy}
              aria-describedby="clipboard-cleanup-description"
              onCheckedChange={(enabled) =>
                void change({ action: 'clipboard-cleanup', enabled })
              }
            />
          </div>
          <p id="clipboard-cleanup-description" className="subtle text-sm">
            Once a day, permanently remove unpinned Clipboard text and images
            older than 24 hours, even when the app is closed. Pin anything you
            want to keep. Applies across your account’s devices. Earlier
            dictation history and text saved before this feature stay saved.
          </p>
        </div>
        {error && (
          <Alert variant="destructive" className="error-message" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="success-message" aria-live="polite">
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}
        <div className="actions">
          <Link href="/account/sign-in" className="text-link">
            Account sign-in
          </Link>
          <Button
            variant="outline"
            className="control"
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
          </Button>
        </div>
        <div className="subtle text-sm border-t pt-4">
          Catchall Desk
          <br />
          Your saved Clipboard and Documents need a connection.{' '}
          <Link href="/privacy" className="text-link">
            Privacy & storage
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
