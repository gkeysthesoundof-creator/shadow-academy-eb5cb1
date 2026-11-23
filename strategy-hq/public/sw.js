/* Strategy HQ service worker: offline playbook + static assets only. */
const CACHE = 'hq-cache-v2';
const OFFLINE_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a1a;color:#f2eefc;font-family:system-ui,sans-serif;padding:24px;text-align:center}a{color:#40e3eb}</style></head><body><main><h1>Offline</h1><p>Offline — live research, scouts and the coach need a connection. Your cached playbook is available.</p><p><a href="/playbook">Open cached playbook</a></p></main></body></html>';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic' && !res.redirected) cache.put(cacheKey || req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(cacheKey || req);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/static/')) { e.respondWith(networkFirst(req)); return; }
  if (req.mode === 'navigate') {
    const isPlaybook = url.pathname === '/playbook';
    e.respondWith((async () => {
      try {
        // Only the playbook page is cached for offline use; other routes are never stored.
        return isPlaybook ? await networkFirst(req, '/playbook') : await fetch(req);
      } catch {
        return new Response(OFFLINE_HTML, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    })());
  }
});
