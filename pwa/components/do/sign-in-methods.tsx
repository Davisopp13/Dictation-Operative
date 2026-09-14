'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { errorMessage } from '@/lib/client';

type Methods = { email: string; hasPassword: boolean; googleConnected: boolean; needsReauthentication: boolean };
const returnTo = '/account/sign-in';
const loginPath = '/login?returnTo=%2Faccount%2Fsign-in';

export function SignInMethods() {
  const [methods, setMethods] = useState<Methods | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/auth/password-setup', { cache: 'no-store', signal: controller.signal });
        if (response.status === 401) { setSignedOut(true); return; }
        if (!response.ok) throw new Error('Could not load your sign-in methods. Refresh to try again.');
        setMethods(await response.json() as Methods);
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function reauthenticate() {
    setBusy(true); setError(''); setPassword(''); setConfirmation('');
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: returnTo, errorCallbackURL: loginPath });
      if (result.error) throw new Error(result.error.message || 'Could not start Google sign-in.');
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }

  async function addPassword(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess('');
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/auth/password-setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password }),
      });
      const result = await response.json() as { message?: string; code?: string };
      if (!response.ok) {
        if (result.code === 'REAUTHENTICATION_REQUIRED') setMethods((value) => value && { ...value, needsReauthentication: true });
        if (result.code === 'UNAUTHORIZED') setSignedOut(true);
        if (result.code === 'PASSWORD_ALREADY_SET') setMethods((value) => value && { ...value, hasPassword: true });
        throw new Error(result.message || 'Could not add your password.');
      }
      setMethods((value) => value && { ...value, hasPassword: true });
      setSuccess('Password added. Use your email and this password on another device. Google sign-in still opens this same account.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setPassword(''); setConfirmation(''); setBusy(false); }
  }

  return <div className="login-content">
    {loading && <output>Loading your sign-in methods…</output>}
    {signedOut ? <>
      <p>Sign in with your existing Google account to add a password.</p>
      <Link className="entry-primary" href={loginPath}>Sign in to continue</Link>
    </> : methods && <>
      <p>Signed in as <strong className="break-all">{methods.email}</strong></p>
      <p>{methods.googleConnected ? 'Google sign-in is connected.' : 'You use a password to sign in.'} {methods.hasPassword ? 'Email and password sign-in is ready.' : 'Add a password to also sign in with your email.'}</p>
      {!methods.hasPassword && (methods.needsReauthentication ? <>
        <p>Confirm your Google account before adding a password. Return here within 10 minutes of signing in.</p>
        <button className="entry-primary login-google" disabled={busy} onClick={() => void reauthenticate()}>Continue with Google</button>
      </> : <form className="login-form" onSubmit={(event) => void addPassword(event)}>
        <label htmlFor="password-account-email">Account email</label>
        <input id="password-account-email" type="email" autoComplete="username" value={methods.email} readOnly />
        <label htmlFor="account-new-password">New password</label>
        <input id="account-new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} aria-describedby="password-guidance" />
        <label htmlFor="account-confirm-password">Confirm password</label>
        <input id="account-confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} />
        <p id="password-guidance" className="subtle text-sm">Use at least 12 characters and save it in your password manager. Email password recovery is not available yet.</p>
        <button className="entry-primary" type="submit" disabled={busy}>{busy ? 'Adding password…' : 'Add password'}</button>
      </form>)}
    </>}
    {error && <p className="login-error" role="alert">{error}</p>}
    {success && <output>{success}</output>}
    <Link className="text-link login-switch" href="/">Back to your workspace</Link>
  </div>;
}
