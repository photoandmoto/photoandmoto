const CACHE_NAME = 'photoandmoto-v4';
const STATIC_ASSETS = [
  '/fi/app/',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;

  const url = new URL(e.request.url);
  const isAppShell = url.pathname === '/fi/app/' || url.pathname === '/fi/app';

  if (isAppShell) {
    // Network-first: always fetch fresh HTML so updates appear without reinstalling
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          caches.open(CACHE_NAME).then((c) => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
