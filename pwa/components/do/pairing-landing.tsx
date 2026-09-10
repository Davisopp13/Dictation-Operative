'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SyncDialog } from './sync';
import { parsePairingLink } from '@/lib/sync/pairing';

export function PairingLanding({
  account,
  signInPath,
}: {
  account: string | null;
  signInPath: string;
}) {
  const [ready, setReady] = useState(false);
  const [initialCode, setInitialCode] = useState<{
    code: string;
    publicKey: string;
  }>();
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const scanned = parsePairingLink(window.location.href);
        // Keep only the public rendezvous link across sign-in; no encryption keys or bearer tokens.
        if (scanned)
          sessionStorage.setItem(
            'do-pairing-link',
            JSON.stringify({ url: window.location.href, at: Date.now() }),
          );
        const saved = sessionStorage.getItem('do-pairing-link');
        const pending = saved
          ? (JSON.parse(saved) as { url: string; at: number })
          : null;
        const link =
          scanned ??
          (pending && Date.now() - pending.at < 300000
            ? parsePairingLink(pending.url)
            : null);
        if (link) setInitialCode(link);
        if (account) sessionStorage.removeItem('do-pairing-link');
        if (window.location.hash) history.replaceState(null, '', '/pair');
      } catch {
        setError(
          'The scanned code could not be restored. You can enter it manually in Sync.',
        );
      }
      setReady(true);
    });
  }, [account]);
  return (
    <main className="pairing-landing">
      <h1 className="text-2xl font-semibold">Pair your device</h1>
      {!account ? (
        <>
          <p>Sign in to connect this browser with your other device.</p>
          {initialCode && (
            <p className="subtle">
              Your scanned code is ready. Keep the other device’s pairing screen
              open.
            </p>
          )}
          <a className="text-primary underline" href={signInPath} target="_top">
            Sign in
          </a>
        </>
      ) : (
        <>
          <button
            className="text-primary underline text-left"
            onClick={() => setOpen(true)}
          >
            Open device pairing
          </button>
          {ready && (
            <SyncDialog
              account={account}
              draft=""
              open={open}
              onOpenChange={setOpen}
              initialCode={initialCode}
            />
          )}
          <Link className="text-primary underline" href="/">
            Back to workspace
          </Link>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
