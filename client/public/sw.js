// Cache app shell so it opens offline.
// Note: Vite copies /public to the root of the built site.
const CACHE = 'shopping-list-v1';
const APP_ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for API; cache-first for everything else
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(c => c || fetch(event.request)));
});