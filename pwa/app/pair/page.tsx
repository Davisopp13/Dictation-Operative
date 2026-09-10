import { getUser, signInPath } from '../auth';
import { PairingLanding } from '@/components/do/pairing-landing';
export const dynamic = 'force-dynamic';
export default async function PairPage() {
  const user = await getUser();
  return (
    <PairingLanding
      account={user?.userId ?? null}
      signInPath={signInPath('/pair')}
    />
  );
}
