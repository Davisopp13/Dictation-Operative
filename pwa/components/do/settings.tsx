'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, ExternalLink, LoaderCircle, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { post, errorMessage } from '@/lib/client';
export type SettingsState = {
  connected: boolean;
  consent: boolean;
  secureStorage: boolean;
};
export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SettingsState;
  onSettings: (s: SettingsState) => void;
}) {
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  async function change(data: unknown) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      onSettings(await post<SettingsState>('settings', data));
      setKey('');
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
          setKey('');
          setError('');
          setSuccess('');
          onOpenChange(value);
        }
      }}
    >
      <DialogContent className="settings-dialog">
        <DialogHeader>
          <DialogTitle>Make DO yours</DialogTitle>
          <DialogDescription>
            Connect once to start recording and shaping your words.
          </DialogDescription>
        </DialogHeader>
        <div className="connection-card">
          <ShieldCheck />
          <div>
            <strong>
              {settings.connected ? 'Groq is connected' : 'Connect Groq'}
            </strong>
            <p className="subtle text-sm">
              Fast transcription and writing tools, using your own API key.
            </p>
          </div>
          {settings.connected && <Check className="connected-icon" />}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void change({ action: 'connect', key });
          }}
        >
          <label className="field-label" htmlFor="groq-key">
            {settings.connected ? 'Replace API key' : 'Groq API key'}
          </label>
          <Input
            id="groq-key"
            type="password"
            className="field"
            autoComplete="off"
            spellCheck={false}
            placeholder="gsk_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            maxLength={300}
          />
          <p className="subtle text-sm mt-2">
            Encrypted before saving. It is never sent back to your browser.
          </p>
          <div className="actions">
            <Button
              className="control"
              type="submit"
              disabled={busy || !key.trim() || !settings.secureStorage}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ShieldCheck />
              )}{' '}
              Save connection
            </Button>
            <a
              className="text-link"
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
            >
              Get a key <ExternalLink size={14} />
            </a>
          </div>
        </form>
        {!settings.secureStorage && (
          <Alert variant="destructive" className="error-message">
            <AlertDescription>
              Secure connection storage is still being configured.
            </AlertDescription>
          </Alert>
        )}
        <div className="consent-row">
          <div>
            <label htmlFor="cloud-consent" className="font-semibold">
              Allow cloud processing
            </label>
            <p className="subtle text-sm mt-1">
              Recordings and text you ask AI to work on are sent to Groq. Your
              saved Clipboard is private to your signed-in account. Audio is not
              stored in Clipboard.
            </p>
          </div>
          <Switch
            id="cloud-consent"
            checked={settings.consent}
            disabled={busy}
            onCheckedChange={(value) =>
              void change({ action: 'consent', consent: value })
            }
          />
        </div>
        <p className="subtle text-sm">
          Groq account limits and charges apply. Review the{' '}
          <a
            href="https://groq.com/privacy-policy/"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Groq privacy policy
          </a>
          .
        </p>
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
        {settings.connected && (
          <Button
            variant="outline"
            className="control"
            disabled={busy}
            onClick={() => void change({ action: 'disconnect' })}
          >
            Disconnect Groq
          </Button>
        )}
        <div className="subtle text-sm border-t pt-4">
          <Link href="/windows" target="_blank" rel="noopener" className="text-link windows-setup-link">
            Windows setup → Download and test Win + Alt
          </Link>
          DO · Version 2<br />
          Your saved Clipboard needs a connection. Keep the app open while recording.{' '}
          <Link href="/privacy" className="text-link">
            Privacy & storage
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
