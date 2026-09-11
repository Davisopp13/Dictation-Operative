'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { errorMessage } from '@/lib/client';

export function LoginForm({ ready, google, returnTo, oauthError }: { ready: boolean; google: boolean; returnTo: string; oauthError: boolean }) {
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(oauthError ? 'Google sign-in was not completed. Please try again.' : '');
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (name: string) => { const input = values.get(name); return typeof input === 'string' ? input : ''; };
    const username = value('username').trim();
    const password = value('password');
    setBusy(true); setError('');
    try {
      const result = signup
        ? await authClient.signUp.email({ email: value('email').trim(), name: username, username, password })
        : await authClient.signIn.username({ username, password });
      if (result.error) throw new Error(result.error.message || 'Check your details and try again.');
      window.location.assign(returnTo);
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  async function signInGoogle() {
    setBusy(true); setError('');
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: returnTo, errorCallbackURL: '/login?error=google' });
      if (result.error) throw new Error(result.error.message || 'Google sign-in could not be started.');
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  if (!ready) return <output>Account signup is being prepared. Please check back soon.</output>;
  return <div className="login-content">
    {google && <><button className="entry-primary login-google" type="button" disabled={busy} onClick={() => void signInGoogle()}>Continue with Google</button><p className="login-divider">or use your username</p></>}
    <form className="login-form" onSubmit={(e) => void submit(e)}>
      <label htmlFor="login-username">Username</label>
      <input id="login-username" name="username" required minLength={3} maxLength={30} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} placeholder="Your username" />
      {signup && <><label htmlFor="login-email">Email</label><input id="login-email" name="email" type="email" required maxLength={254} autoComplete="email" disabled={busy} placeholder="you@example.com" /></>}
      <label htmlFor="login-password">Password</label>
      <input id="login-password" name="password" type="password" required minLength={signup ? 12 : 1} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} disabled={busy} placeholder={signup ? 'At least 12 characters' : 'Your password'} />
      {signup && <p className="subtle text-sm">Use a password manager to keep your password. Email password recovery is not available yet.</p>}
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="entry-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <button type="button" className="text-link login-switch" disabled={busy} onClick={() => { setSignup(!signup); setError(''); }}>{signup ? 'Already have an account? Sign in' : 'New to DO? Create an account'}</button>
    <p className="subtle text-sm">Your saved words are private to your account.</p>
  </div>;
}
