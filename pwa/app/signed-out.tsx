/// Shown instead of the workspace when no signed-in user reached the page.
/// Behind Cloudflare Access this only happens when Access is not yet enforcing
/// on this hostname, so it must never redirect: a redirect to the same page
/// would loop.
export function SignedOut({ signInPath }: { signInPath: string }) {
  return (
    <main className="pairing-landing">
      <h1 className="text-2xl font-semibold">Sign in required</h1>
      <p>Sign in to open your DO workspace.</p>
      <a className="text-primary underline" href={signInPath} target="_top">
        Sign in
      </a>
    </main>
  );
}
