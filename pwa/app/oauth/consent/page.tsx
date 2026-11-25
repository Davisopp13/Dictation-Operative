import { env } from 'cloudflare:workers';
import { EntryPage } from '@/components/do/entry-page';
import { ConsentForm } from '@/components/do/consent-form';
import { getUser, signInPath } from '../../auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Allow access — Catch-all Desk' };

/**
 * Shown when an app asks to sign in with this account. The request arrives in
 * the query string, signed by the server; the form sends it back unchanged
 * with the decision.
 */
export default async function Consent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clientId = typeof params.client_id === 'string' ? params.client_id : '';
  const user = await getUser();
  const client = clientId
    ? await env.DB.prepare(
        'SELECT name FROM auth_oauth_client WHERE client_id=? AND COALESCE(disabled,0)=0',
      )
        .bind(clientId)
        .first<{ name: string | null }>()
    : null;
  if (!user || !client || typeof params.sig !== 'string')
    return (
      <EntryPage
        title="This request can’t be completed"
        description="The sign-in request is missing, has expired, or came from an app this account doesn’t recognize. Return to the app and try again."
      >
        <a className="entry-primary" href={user ? '/' : signInPath('/')}>
          {user ? 'Open Catch-all Desk' : 'Sign in'}
        </a>
      </EntryPage>
    );
  const scopes = typeof params.scope === 'string' ? params.scope.split(' ') : [];
  return (
    <EntryPage
      title={`Allow ${client.name || 'this app'}?`}
      description={`It is asking to use your Catch-all Desk account, ${user.email}.`}
    >
      <ConsentForm
        workspace={scopes.includes('workspace')}
        email={scopes.includes('email')}
      />
    </EntryPage>
  );
}
