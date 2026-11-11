/* RRET service worker (FEAT-008): makes the app work offline after one visit.
   tests/pwa.test.mjs checks that every app file is precached. Bump CACHE_VERSION
   when files are added/removed or vendor assets are upgraded. */
// Keep in sync with js/version.js (enforced by tests/version.test.mjs).
const CACHE_VERSION = 'rret-2.2.0';
const PRECACHE = [
  './',
  'css/lada.css',
  'css/learn.css',
  'css/scope.css',
  'css/style.css',
  'css/theme.css',
  'data/targets.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'index.html',
  'js/analytics.js',
  'js/app.js',
  'js/coach.js',
  'js/drawing.js',
  'js/reticle-designs.js',
  'js/reticle-help.js',
  'js/reticles.js',
  'js/scenario-logic.js',
  'js/scope.js',
  'js/settings.js',
  'js/shared-set.js',
  'js/station.js',
  'js/storage.js',
  'js/target-art.js',
  'js/target-schema.js',
  'js/targets.js',
  'js/textures.js',
  'js/training.js',
  'js/tutorial.js',
  'js/ui.js',
  'js/utils.js',
  'js/version.js',
  'manifest.webmanifest',
  'vendor/bootstrap-icons/bootstrap-icons.min.css',
  'vendor/bootstrap-icons/fonts/bootstrap-icons.woff',
  'vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
  'vendor/bootstrap/bootstrap.bundle.min.js',
  'vendor/bootstrap/bootstrap.min.css',
  'vendor/fonts/Archivo-latin-4c98b9d490.woff2',
  'vendor/fonts/Archivo-latin-ext-a75c792f98.woff2',
  'vendor/fonts/RobotoMono-2ed6ac9efa.woff2',
  'vendor/fonts/fonts.css',
  'vendor/lada-glass/2.0.0/CHANGELOG.md',
  'vendor/lada-glass/2.0.0/VERSION',
  'vendor/lada-glass/2.0.0/graphics/empty.svg',
  'vendor/lada-glass/2.0.0/graphics/horizon.svg',
  'vendor/lada-glass/2.0.0/graphics/rings.svg',
  'vendor/lada-glass/2.0.0/graphics/waves.svg',
  'vendor/lada-glass/2.0.0/icons/activity.svg',
  'vendor/lada-glass/2.0.0/icons/alert.svg',
  'vendor/lada-glass/2.0.0/icons/app.svg',
  'vendor/lada-glass/2.0.0/icons/box.svg',
  'vendor/lada-glass/2.0.0/icons/bug.svg',
  'vendor/lada-glass/2.0.0/icons/chart.svg',
  'vendor/lada-glass/2.0.0/icons/check-circle.svg',
  'vendor/lada-glass/2.0.0/icons/check.svg',
  'vendor/lada-glass/2.0.0/icons/chevron-down.svg',
  'vendor/lada-glass/2.0.0/icons/chevron-right.svg',
  'vendor/lada-glass/2.0.0/icons/clock.svg',
  'vendor/lada-glass/2.0.0/icons/copy.svg',
  'vendor/lada-glass/2.0.0/icons/download.svg',
  'vendor/lada-glass/2.0.0/icons/edit.svg',
  'vendor/lada-glass/2.0.0/icons/external.svg',
  'vendor/lada-glass/2.0.0/icons/eye.svg',
  'vendor/lada-glass/2.0.0/icons/file.svg',
  'vendor/lada-glass/2.0.0/icons/filter.svg',
  'vendor/lada-glass/2.0.0/icons/folder.svg',
  'vendor/lada-glass/2.0.0/icons/globe.svg',
  'vendor/lada-glass/2.0.0/icons/info.svg',
  'vendor/lada-glass/2.0.0/icons/key.svg',
  'vendor/lada-glass/2.0.0/icons/layers.svg',
  'vendor/lada-glass/2.0.0/icons/link.svg',
  'vendor/lada-glass/2.0.0/icons/list.svg',
  'vendor/lada-glass/2.0.0/icons/lock.svg',
  'vendor/lada-glass/2.0.0/icons/mail.svg',
  'vendor/lada-glass/2.0.0/icons/menu.svg',
  'vendor/lada-glass/2.0.0/icons/minus.svg',
  'vendor/lada-glass/2.0.0/icons/moon.svg',
  'vendor/lada-glass/2.0.0/icons/overview.svg',
  'vendor/lada-glass/2.0.0/icons/plus.svg',
  'vendor/lada-glass/2.0.0/icons/refresh.svg',
  'vendor/lada-glass/2.0.0/icons/scan.svg',
  'vendor/lada-glass/2.0.0/icons/search.svg',
  'vendor/lada-glass/2.0.0/icons/settings.svg',
  'vendor/lada-glass/2.0.0/icons/shield-check.svg',
  'vendor/lada-glass/2.0.0/icons/shield.svg',
  'vendor/lada-glass/2.0.0/icons/sprite.svg',
  'vendor/lada-glass/2.0.0/icons/sun.svg',
  'vendor/lada-glass/2.0.0/icons/terminal.svg',
  'vendor/lada-glass/2.0.0/icons/trash.svg',
  'vendor/lada-glass/2.0.0/icons/upload.svg',
  'vendor/lada-glass/2.0.0/icons/user.svg',
  'vendor/lada-glass/2.0.0/icons/x.svg',
  'vendor/lada-glass/2.0.0/lada-glass-bootstrap.css',
  'vendor/lada-glass/2.0.0/lada-glass.css',
  'vendor/lada-glass/2.0.0/lada-glass.js'
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
