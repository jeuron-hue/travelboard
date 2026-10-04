/* travelboard service worker (SPEC.md 6.4).
   Shell: cache-first from a versioned precache. Anything cross-origin (Supabase,
   Edge Functions) is left to the network and never cached.
   Updates install in the background and wait; the page shows "update ready, tap
   to reload" and only a tap sends SKIP_WAITING. Never skipWaiting automatically.
   Bump CACHE_VERSION on every release, together with APP_VERSION in trip.html. */

const CACHE_VERSION = 2;
const CACHE = 'tb-shell-v' + CACHE_VERSION;

const PRECACHE = [
  './trip.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './vendor/supabase-js-2.117.2.umd.js',
  './vendor/supabase-js-LICENSE',
  './vendor/fonts/ibm-plex-sans-latin-400-normal.woff2',
  './vendor/fonts/ibm-plex-sans-latin-600-normal.woff2',
  './vendor/fonts/IBM-Plex-OFL-LICENSE'
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the HTTP cache so a new version never precaches stale files.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('tb-shell-v') && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // network-only, never cached

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ignoreSearch so ?new=1 and share-target queries still hit the cached trip.html
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
