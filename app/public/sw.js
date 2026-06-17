const CACHE = 'tripreport-v2';

const PRECACHE = [
  '/',
  '/index.html',
  '/splash-logo.png',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for same-origin nav and hashed build assets; cache-first for other static files.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  const isBuildAsset = url.pathname.startsWith('/assets/');
  const isNavigate = request.mode === 'navigate';

  if (isNavigate || isBuildAsset) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => (isNavigate ? caches.match('/index.html') : caches.match(request)))
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      });
    })
  );
});
