/* Season 0 PWA. Scope is /play/ only. The landing page is outside this worker. */
const CACHE = 'bard-s0-loop-v2';
const SHELL = [
  '/play/',
  '/play/index.html',
  '/play/manifest.webmanifest',
  '/tokens.css',
  '/season.css',
  '/season0/ui/app.js',
  '/season0/ui/trial-view.js',
  '/play/assets/avatars/bard.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/play/') && !SHELL.includes(url.pathname)) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok && event.request.method === 'GET') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then((hit) => hit || caches.match('/play/index.html')))
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Bard', body: 'Season 0' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch { /* keep the default line */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/play/assets/avatars/bard.webp',
    tag: payload.tag || 'bard-s0'
  }));
});
