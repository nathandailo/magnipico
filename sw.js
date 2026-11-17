// Magnipico service worker: offline support. App files are network-first (so updates arrive),
// the heavy runtime and models are cache-first (downloaded once).
const SHELL = 'magnipico-shell-v3';
const HEAVY = 'magnipico-heavy-v1';
const SHELL_FILES = ['./', 'index.html', 'styles.css', 'app.js', 'worker.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'vendor/ort/ort.webgpu.min.mjs'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== HEAVY).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const heavy = /\/(models|vendor)\//.test(url.pathname) && /\.(onnx|wasm|mjs)$/.test(url.pathname);
  if (heavy) {
    e.respondWith(caches.open(HEAVY).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok && res.status === 200) cache.put(e.request, res.clone()).catch(() => {});
      return res;
    }));
    return;
  }
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
