import { env } from 'cloudflare:workers';
import { EntryPage } from '@/components/do/entry-page';
import { LoginForm } from '@/components/do/login-form';
import { authReady, googleReady } from '@/lib/app-auth';
import { safeRelativeReturnPath } from '../auth';
export const dynamic = 'force-dynamic';
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const returnTo = safeRelativeReturnPath(typeof params.returnTo === 'string' ? params.returnTo : '/');
  return <EntryPage title="Your words start here" description="Sign in or create an account to capture thoughts, shape your words, and keep the good bits.">
    <LoginForm ready={authReady(env)} google={googleReady(env)} returnTo={returnTo} oauthError={!!params.error} />
  </EntryPage>;
}
