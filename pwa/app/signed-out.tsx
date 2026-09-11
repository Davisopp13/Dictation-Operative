import { ArrowRight } from 'lucide-react';
import { EntryPage } from '@/components/do/entry-page';

/// Shown instead of the workspace when no signed-in user reached the page.
/// Behind Cloudflare Access this only happens when Access is not yet enforcing
/// on this hostname, so it must never redirect: a redirect to the same page
/// would loop.
export function SignedOut({ signInPath }: { signInPath: string }) {
  return (
    <EntryPage
      title="Your workspace awaits"
      description="Sign in to open your DO workspace and pick up where you left off."
    >
      <a className="entry-primary" href={signInPath} target="_top">
        Sign in <ArrowRight size={18} aria-hidden="true" />
      </a>
    </EntryPage>
  );
}
