const CACHE = 'roman-shadow-academy-v2';
const FILES = ['./', './index.html', './styles.css', './src/curriculum.js', './src/voice.js', './src/app.js', './manifest.webmanifest'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: Roman always gets the newest game when online,
// and the cached copy keeps everything playable offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
