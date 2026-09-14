import { EntryPage } from '@/components/do/entry-page';
import { SignInMethods } from '@/components/do/sign-in-methods';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account sign-in — DO' };

export default function AccountSignIn() {
  return <EntryPage title="Account sign-in" description="Choose how you sign in to the same account and saved workspace.">
    <SignInMethods />
  </EntryPage>;
}
