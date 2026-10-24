/* ScanPro AI — service worker : app + bibliothèques + pack de langue en cache
   pour un fonctionnement hors-ligne après la première visite. */
const CACHE = 'scanpro-ai-v2.9.0';
const ASSETS = [
  './', './manifest.webmanifest', './assets/icon.svg',
  './vendor/tesseract.min.js', './vendor/tesseract-worker.min.js',
  './vendor/tesseract-core-simd.wasm.js', './vendor/tesseract-core-lstm.wasm.js',
  './vendor/tesseract-core-simd-lstm.wasm.js', './vendor/tesseract-core.wasm.js', './vendor/jspdf.umd.min.js',
  './vendor/pdf-lib.min.js', './vendor/pdf.min.js', './vendor/pdf.worker.min.js',
  './vendor/jszip.min.js',
  './vendor/lang/fra.traineddata.gz', './vendor/lang/eng.traineddata.gz',
  './vendor/lang/spa.traineddata.gz', './vendor/lang/deu.traineddata.gz',
  './vendor/lang/ita.traineddata.gz', './vendor/lang/por.traineddata.gz'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isDoc = req.mode === 'navigate' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  // 1) Document : réseau d'abord (mises à jour immédiates), cache en secours hors-ligne
  if (isDoc) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(h => h || caches.match('./')))
    );
    return;
  }

  // 2) Bibliothèques / modèles de langue : cache d'abord (gros fichiers, stables)
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
