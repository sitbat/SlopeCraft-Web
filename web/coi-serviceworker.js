/** Same-directory, network-only isolation headers. GPL-3.0-or-later. */
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const scopeURL = new URL(self.registration.scope);
  const applicationURL = new URL('./', self.location.href);
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scopeURL.origin ||
      url.origin !== applicationURL.origin ||
      !url.pathname.startsWith(scopeURL.pathname) ||
      !url.pathname.startsWith(applicationURL.pathname)) return;
  // Even a registration created with a broader allowed scope cannot extend
  // this application's header policy into sibling directories.
  const boundary = scopeURL.pathname.length >= applicationURL.pathname.length
    ? scopeURL.pathname : applicationURL.pathname;
  const relativePath = url.pathname.slice(boundary.length);
  if (relativePath === 'api' || relativePath.startsWith('api/') ||
      request.headers.has('range') ||
      (request.cache === 'only-if-cached' && request.mode !== 'same-origin')) return;

  event.respondWith((async () => {
    // A controlled navigation needs a fresh full response. Assets keep their
    // normal network/cache behavior; no CacheStorage or project data is stored.
    const response = request.mode === 'navigate'
      ? await fetch(request, {cache: 'no-store'})
      : await fetch(request);
    if (response.redirected || response.type === 'opaque' ||
        response.type === 'opaqueredirect' || response.status === 0 ||
        response.status === 206 || response.status === 304 ||
        (response.status >= 300 && response.status < 400)) return response;
    if (response.url) {
      const finalURL = new URL(response.url);
      if (finalURL.origin !== scopeURL.origin ||
          !finalURL.pathname.startsWith(boundary)) return response;
    }
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    if (!headers.has('Cross-Origin-Resource-Policy')) {
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  })());
});
