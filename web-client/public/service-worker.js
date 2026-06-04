// Bump CACHE name on every release so the activate event can purge old
// caches and clients pick up fresh shells immediately.
const CACHE = 'durak-v141-support-draft';

// Static shell assets only. Application JS/CSS use a network-first strategy
// below so a fresh deploy reaches users without requiring them to clear
// caches manually.
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/images/imperia-home-bg.jpg',
];

// Paths that MUST always be fetched from the network when online so the
// user sees the latest UI. We still fall back to the cached copy when
// offline so the PWA keeps working on a flaky connection.
const NETWORK_FIRST_PATHS = [
  '/styles.css',
  '/styles/',
  '/src/',
  '/i18n/',
  '/images/',
];

function isNetworkFirst(pathname) {
  return NETWORK_FIRST_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

// Never cache API or socket traffic — these are dynamic and live.
function isPassThrough(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/socket.io/');
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  if (isPassThrough(url.pathname)) return;

  if (isNetworkFirst(url.pathname)) {
    e.respondWith(
      fetch(e.request).then((res) => {
        // Update the cache with the latest version for offline fallback.
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first for shell / icons / manifest.
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
