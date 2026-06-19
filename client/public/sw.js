// Cache app shell so it opens offline.
// Note: Vite copies /public to the root of the built site.
// The build ID placeholder below is stamped by vite.config.js at build
// time, so every new deploy produces a byte-different file - that's what
// makes the browser notice the update and re-run install/activate below.
const CACHE = 'shopping-list-__BUILD_ID__';
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

  // Network-first for API
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // Network-first for navigation/HTML: it references Vite's content-hashed
  // JS/CSS filenames, so it must always be re-validated or a stale page
  // keeps pointing at assets that no longer exist after a deploy.
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else: Vite's hashed JS/CSS/asset filenames
  // only change when their content does, so they're safe to cache forever.
  event.respondWith(caches.match(event.request).then(c => c || fetch(event.request)));
});