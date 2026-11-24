'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { errorMessage } from '@/lib/client';

/** Allow or deny an app's sign-in request. The auth client navigates onward. */
export function ConsentForm({
  workspace,
  email,
}: {
  workspace: boolean;
  email: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(accept: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await authClient.oauth2.consent({ accept });
      if (result.error)
        throw new Error(
          result.error.message ||
            'The request could not be completed. Return to the app and try again.',
        );
      // On success the response carries the app's return address and the
      // client is already navigating there.
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <div className="login-content">
      <p>If you allow it, the app will be able to:</p>
      <ul className="list-disc pl-5 space-y-1">
        {workspace && (
          <li>
            See, add, change, and delete your saved text, images, and documents
          </li>
        )}
        {email && <li>See your account email address</li>}
        <li>Stay signed in until you sign out in the app</li>
      </ul>
      <p className="subtle text-sm">
        Only allow this if you just chose to sign in from that app on this
        device.
      </p>
      <button
        type="button"
        className="entry-primary"
        disabled={busy}
        onClick={() => void decide(true)}
      >
        {busy ? 'Please wait…' : 'Allow'}
      </button>
      <button
        type="button"
        className="text-link login-switch"
        disabled={busy}
        onClick={() => void decide(false)}
      >
        Don’t allow
      </button>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
