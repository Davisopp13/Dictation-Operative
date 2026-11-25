export type OriginConfig = {
  BETTER_AUTH_URL?: string;
  AUTH_ADDITIONAL_ORIGINS?: string;
};

function origins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => new URL(entry).origin);
}

/**
 * Sends a page opened on one of the site's other addresses to the same page on
 * its main address.
 *
 * Sign-in only works on the main address: Google returns the browser there,
 * and the cookie that proves the browser started that sign-in is tied to the
 * address it started on. A sign-in begun anywhere else always fails.
 *
 * Only page navigations move. API calls keep working on every address, so
 * links and apps that already point at an older one are not broken, and the
 * `#fragment` a pairing link carries survives the redirect.
 */
export function mainAddressRedirect(
  request: Request,
  config: OriginConfig,
): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!config.BETTER_AUTH_URL) return null;
  const url = new URL(request.url);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
  // A request a page makes for itself (a script, a fetch) says so here; one
  // typed, clicked or followed from another app says "navigate" or nothing.
  const mode = request.headers.get('Sec-Fetch-Mode');
  if (mode && mode !== 'navigate') return null;
  const main = new URL(config.BETTER_AUTH_URL).origin;
  if (url.origin === main) return null;
  if (!origins(config.AUTH_ADDITIONAL_ORIGINS).includes(url.origin)) return null;
  return new Response(null, {
    status: 302,
    headers: {
      Location: main + url.pathname + url.search,
      'Cache-Control': 'no-store',
    },
  });
}
