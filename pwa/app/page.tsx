import { getUser, signInPath } from './auth';
import { SignedOut } from './signed-out';
import Workspace from '@/components/do/workspace';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getUser();
  if (!user) return <SignedOut signInPath={signInPath('/')} />;
  return <Workspace account={user.userId} email={user.email} />;
}
