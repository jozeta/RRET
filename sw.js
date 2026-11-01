/* RRET service worker (FEAT-008): makes the app work offline after one visit.
   tests/pwa.test.mjs checks that every app file is precached. Bump CACHE_VERSION
   when files are added/removed or vendor assets are upgraded. */
// Keep in sync with js/version.js (enforced by tests/version.test.mjs).
const CACHE_VERSION = 'rret-2.0.0';
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/learn.css',
  'css/scope.css',
  'css/style.css',
  'js/analytics.js',
  'js/app.js',
  'js/coach.js',
  'js/drawing.js',
  'js/reticles.js',
  'js/scenario-logic.js',
  'js/scope.js',
  'js/settings.js',
  'js/station.js',
  'js/storage.js',
  'js/target-schema.js',
  'js/targets.js',
  'js/training.js',
  'js/tutorial.js',
  'js/ui.js',
  'js/utils.js',
  'js/version.js',
  'data/reticles.json',
  'data/targets.json',
  'vendor/bootstrap/bootstrap.bundle.min.js',
  'vendor/bootstrap/bootstrap.min.css',
  'vendor/bootstrap-icons/bootstrap-icons.min.css',
  'vendor/bootstrap-icons/fonts/bootstrap-icons.woff',
  'vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
  'vendor/fonts/Inter-c940764593.woff2',
  'vendor/fonts/Rajdhani-35f7e628ec.woff2',
  'vendor/fonts/Rajdhani-4745b75b6e.woff2',
  'vendor/fonts/Rajdhani-7597c31a95.woff2',
  'vendor/fonts/RobotoMono-2ed6ac9efa.woff2',
  'vendor/fonts/fonts.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('rret-') && k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the app itself, so a new deploy is picked up on the next
// online visit and the cache is only the offline fallback. Pinned vendor files and
// icons never change in place, so they are served cache-first.
const CACHE_FIRST = /\/(vendor|icons)\//;

function fromNetwork(req) {
  return fetch(req).then(res => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
    }
    return res;
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (CACHE_FIRST.test(url.pathname)) {
    event.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fromNetwork(req)));
    return;
  }
  event.respondWith(
    fromNetwork(req).catch(() =>
      caches.match(req, { ignoreSearch: true }).then(hit =>
        hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())
      )
    )
  );
});
