// Private workspace responses are deliberately never cached.
// Keep the `do-static-` prefix: activation deletes older caches by it.
const CACHE = 'do-static-v4';
const STATIC = [
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('do-static-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET')
    return;
  // API downloads and auth flows must never receive the offline HTML shell.
  if (
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/cdn-cgi/')
  )
    return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches
          .match('/offline.html')
          // Cloudflare redirects /offline.html to /offline. Rebuild the cached
          // response so navigation requests can use it without a redirect flag.
          .then((response) =>
            response
              ? new Response(response.body, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                })
              : Response.error(),
          ),
      ),
    );
    return;
  }
  if (STATIC.includes(url.pathname)) {
    event.respondWith(
      caches
        .match(event.request)
        .then((response) => response || fetch(event.request)),
    );
  }
});
