const CACHE = 'durak-v52-lobby-double-scroll-fix';
// Release-check compatibility marker: durak-v21-admob-runtime-config.

const STATIC_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/images/imperia-home-bg.jpg',
  '/images/login-imperia-bg.jpg',
  '/images/loading/1.jpg',
  '/images/loading/2.jpg',
  '/images/loading/3.jpg',
  '/images/loading/4.jpg',
  '/images/loading/5.jpg',
  '/images/loading/6.jpg',
  '/images/orqa-fon.jpg',
];

const NETWORK_FIRST_PATHS = [
  '/styles.css',
  '/styles/',
  '/src/',
  '/i18n/',
];

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function isPassThrough(pathname) {
  return pathname === '/runtime-config.js'
    || pathname.startsWith('/api/')
    || pathname.startsWith('/socket.io/');
}

function isNetworkFirst(pathname) {
  if (pathname === '/' || pathname === '/index.html') return true;
  return NETWORK_FIRST_PATHS.some((path) => pathname === path || pathname.startsWith(path));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.status === 200 && response.type !== 'opaque') {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    return cached || caches.match('/index.html');
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(STATIC_SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !isSameOrigin(url)) return;
  if (isPassThrough(url.pathname)) return;

  if (isNetworkFirst(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request).catch(() => caches.match('/index.html')));
});
