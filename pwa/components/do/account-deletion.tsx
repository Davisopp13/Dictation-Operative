'use client';
import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { errorMessage } from '@/lib/client';

type State = {
  email: string;
  needsReauthentication: boolean;
  text: number;
  images: number;
  documents: number;
};
const loginPath = '/login?returnTo=%2Faccount%2Fsign-in';

/** Permanent, self-service account deletion. Shown only to a signed-in user. */
export function AccountDeletion() {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/account-deletion', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) setState((await response.json()) as State);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function signInAgain() {
    setBusy(true);
    setError('');
    try {
      await authClient.signOut();
      window.location.assign(loginPath);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function remove(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/account-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: confirmation }),
      });
      const result = (await response.json()) as {
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        if (result.code === 'REAUTHENTICATION_REQUIRED')
          setState((value) => value && { ...value, needsReauthentication: true });
        throw new Error(result.message || 'Could not delete your account.');
      }
      window.location.assign('/login');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  // Signed out, or the status could not be loaded: nothing to offer.
  if (!state) return null;
  const matches =
    confirmation.trim().toLowerCase() === state.email.toLowerCase();
  return (
    <section className="login-content border-t pt-4" aria-labelledby="delete-account-title">
      <h2 id="delete-account-title" className="font-semibold">
        Delete account
      </h2>
      {!open ? (
        <>
          <p className="subtle text-sm">
            Permanently delete this account and everything saved in it.
          </p>
          <button
            type="button"
            className="text-link login-switch"
            onClick={() => setOpen(true)}
          >
            Delete my account…
          </button>
        </>
      ) : (
        <>
          <p>
            This permanently deletes <strong>{state.text}</strong> saved text{' '}
            {state.text === 1 ? 'item' : 'items'},{' '}
            <strong>{state.images}</strong>{' '}
            {state.images === 1 ? 'image' : 'images'},{' '}
            <strong>{state.documents}</strong>{' '}
            {state.documents === 1 ? 'document' : 'documents'}, your settings,
            and your sign-in. Every device is signed out. This cannot be undone.
          </p>
          <p className="subtle text-sm">
            Export anything you want to keep first. Device Sync pairings stored
            on your devices are not removed; remove them in Sync on each device.
          </p>
          {state.needsReauthentication ? (
            <>
              <p>
                To confirm it is you, sign in again and return here within 10
                minutes.
              </p>
              <button
                type="button"
                className="entry-primary"
                disabled={busy}
                onClick={() => void signInAgain()}
              >
                Sign in again
              </button>
            </>
          ) : (
            <form className="login-form" onSubmit={(event) => void remove(event)}>
              <label htmlFor="delete-account-email">
                Type <strong className="break-all">{state.email}</strong> to
                confirm
              </label>
              <input
                id="delete-account-email"
                type="email"
                autoComplete="off"
                spellCheck={false}
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              <button
                className="entry-primary bg-destructive"
                type="submit"
                disabled={busy || !matches}
              >
                {busy ? 'Deleting…' : 'Permanently delete account'}
              </button>
            </form>
          )}
          <button
            type="button"
            className="text-link login-switch"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setConfirmation('');
              setError('');
            }}
          >
            Cancel
          </button>
        </>
      )}
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
