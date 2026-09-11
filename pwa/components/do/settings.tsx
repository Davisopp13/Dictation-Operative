'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, ExternalLink, ArrowRight, LoaderCircle, Check } from 'lucide-react';
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
import { authClient } from '@/lib/auth-client';
export type SettingsState = {
  connected: boolean;
  consent: boolean;
  secureStorage: boolean;
  shared?: boolean;
  logoutPath?: string;
  allowance?: { dailyLimit: number; remaining: number; resetsAt: number } | null;
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
            {settings.shared ? 'Voice and writing tools are included. Choose when to use cloud processing.' : 'Connect once to start recording and shaping your words.'}
          </DialogDescription>
        </DialogHeader>
        <div className="connection-card">
          <ShieldCheck />
          <div>
            <strong>
              {settings.shared ? 'AI is included' : settings.connected ? 'Groq is connected' : 'Connect Groq'}
            </strong>
            <p className="subtle text-sm">
              {settings.shared ? 'Transcription and writing tools are provided by DO. No API key needed.' : 'Fast transcription and writing tools, using your own API key.'}
            </p>
          </div>
          {settings.connected && <Check className="connected-icon" />}
        </div>
        {settings.shared && settings.allowance && <p className="subtle text-sm">{settings.allowance.remaining} of {settings.allowance.dailyLimit} included AI requests remaining today. Resets at midnight UTC. A transcription and an AI edit each count as one request.</p>}
        {!settings.shared && <form
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
              className="navigation-button"
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
            >
              Get a key <ExternalLink size={16} aria-hidden="true" />
            </a>
          </div>
        </form>}
        {!settings.shared && !settings.secureStorage && (
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
          {settings.shared ? 'Included usage is subject to daily availability. Review the ' : 'Groq account limits and charges apply. Review the '}
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
        {settings.connected && !settings.shared && (
          <Button
            variant="outline"
            className="control"
            disabled={busy}
            onClick={() => void change({ action: 'disconnect' })}
          >
            Disconnect Groq
          </Button>
        )}
        <div className="actions">
          <Link href="/login" className="text-link">Account sign-in</Link>
          <Button variant="outline" className="control" disabled={busy} onClick={async () => {
            setBusy(true); setError('');
            try {
              const result = await authClient.signOut();
              if (result.error) throw new Error(result.error.message || 'Could not sign out.');
              window.location.assign(settings.logoutPath ?? '/login');
            } catch (e) { setError(errorMessage(e)); setBusy(false); }
          }}>Sign out</Button>
        </div>
        <div className="subtle text-sm border-t pt-4">
          <Link href="/windows" target="_blank" rel="noopener" className="navigation-button windows-setup-link">
            <span>Windows setup · Download and test Win + Alt</span><ArrowRight size={16} aria-hidden="true" />
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
