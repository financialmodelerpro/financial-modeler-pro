/*
 * sw.js, the Modeling Hub's service worker (2026-09-24).
 *
 * MINIMAL BY DESIGN. It exists so the app can be installed and opens in its own
 * window; it is NOT an offline app. The model lives on the server, so an
 * offline session has nothing true to show.
 *
 * THE RULES, each one a founder requirement:
 *   1. It caches the SHELL ONLY: the offline page and the icons, at install.
 *      Nothing else is ever written to a cache. There is no runtime caching.
 *   2. It NEVER caches or answers an API request. A user must never open to
 *      stale figures without knowing, so every /api/ request, and every
 *      non-navigation request (scripts, styles, data), goes straight to the
 *      network untouched: this worker does not call respondWith for them.
 *   3. A PAGE NAVIGATION goes to the network. Only if the network FAILS (no
 *      connection) does it answer with the offline page, which asks the user
 *      to check their connection and attempts no sign-in.
 *
 * Bump VERSION when the shell list changes; activate deletes every other cache.
 * No em dashes in this file.
 */
const VERSION = 'fmp-shell-v1';
const SHELL = [
  '/offline.html',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // `reload` skips the HTTP cache so the shell is the deployed one.
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                    // writes: never touched
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // other origins: never touched
  if (url.pathname.startsWith('/api/')) return;        // API: never touched, never cached

  // The shell files themselves: served from the shell cache, else the network.
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }

  // Only a full page navigation is answered, and only when the network fails.
  if (req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).catch(() => caches.match('/offline.html', { ignoreSearch: true })
      .then((page) => page || new Response('You are offline. Please check your connection and try again.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }))),
  );
});
