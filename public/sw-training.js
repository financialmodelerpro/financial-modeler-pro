/*
 * sw-training.js, the Training Hub app's service worker (2026-11-11).
 *
 * The SAME rules as the Modeling Hub's /sw.js, as its own file with its own
 * cache name and offline page, registered only on learn.financialmodelerpro.com
 * (or a local dev host) and only for a signed-in student (InstallAppHead):
 *   1. It caches the SHELL ONLY: the offline page and the icons, at install.
 *      Nothing else is ever written to a cache. There is no runtime caching.
 *   2. It NEVER caches or answers an API request, or any non-navigation
 *      request: those go straight to the network untouched.
 *   3. A PAGE NAVIGATION goes to the network. Only if the network FAILS does it
 *      answer with the Training Hub's offline page.
 *
 * A service worker belongs to its origin, so this one and the Modeling Hub's
 * never see each other's pages.
 *
 * Bump VERSION when the shell list changes; activate deletes every other cache.
 * No em dashes in this file.
 */
const VERSION = 'fmp-training-shell-v1';
const SHELL = [
  '/offline-training.html',
  '/pwa/training-icon-192.png',
  '/pwa/training-icon-512.png',
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
    fetch(req).catch(() => caches.match('/offline-training.html', { ignoreSearch: true })
      .then((page) => page || new Response('You are offline. Please check your connection and try again.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }))),
  );
});
