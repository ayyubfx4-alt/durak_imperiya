// Tiny hash-based router.
import { state } from './state.js';
import { completeRoyalLoader, hideRoyalLoader, royalLoaderSource, showRouteLoader } from './royalLoading.js?v=129-royal-loader-clean';

const routes = new Map();
let activeCleanup = null;

export function route(name, render) { routes.set(name, render); }

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function renderRouteError(root, routeName, err) {
  console.error('[router] route render failed:', routeName, err);
  if (royalLoaderSource() === 'route') hideRoyalLoader('route');
  root.innerHTML = `
    <div class="screen center">
      <div class="card" style="max-width:420px;text-align:center">
        <h1>Sahifa ochilmadi</h1>
        <p class="muted">${escapeHtml(err?.message || "Iltimos, qayta urinib ko'ring.")}</p>
        <button class="btn primary" data-route-retry>Qayta urinish</button>
      </div>
    </div>`;
  root.querySelector('[data-route-retry]')?.addEventListener('click', () => mount());
}

export function navigate(name, params = {}, options = {}) {
  const url = `#/${name}${params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
  if (!options.silent) showRouteLoader(name, params);
  if (location.hash !== url) location.hash = url;
  else mount();
}

export function currentRoute() {
  const fallback = state.user ? 'home' : 'login';
  const hash = location.hash || '';
  // Telegram WebApp appends launch data as a plain hash, for example
  // #tgWebAppData=... . That is not an app route and must not become a 404.
  if (!hash || hash === '#' || !hash.startsWith('#/')) {
    return { name: fallback, params: {} };
  }
  const [pathPart, queryPart] = hash.slice(2).split('?');
  return {
    name: pathPart || fallback,
    params: Object.fromEntries(new URLSearchParams(queryPart || '')),
  };
}

export function mount() {
  if (activeCleanup) {
    try { activeCleanup(); } catch (_) { /* ignore route cleanup errors */ }
    activeCleanup = null;
  }
  const r = currentRoute();
  const fn = routes.get(r.name);
  const root = document.getElementById('app');
  if (!fn) {
    root.innerHTML = `<div class="screen center"><div class="card"><h1>404</h1><p class="muted">No route: ${r.name}</p></div></div>`;
    return;
  }
  // Auth guard — 'login' and 'nickname' are reachable without a session
  const requiresAuth = !['login', 'register', 'nickname'].includes(r.name);
  if (requiresAuth && !state.user) {
    return navigate('login');
  }
  root.innerHTML = '';
  const finishRouteLoader = () => {
    if (royalLoaderSource() === 'route') completeRoyalLoader('TAYYOR', 520, 'route');
  };
  const cleanup = fn(root, r.params);
  if (cleanup && typeof cleanup.then === 'function') {
    cleanup.then((cb) => {
      if (typeof cb === 'function') activeCleanup = cb;
      finishRouteLoader();
    }).catch((err) => {
      renderRouteError(root, r.name, err);
    });
  } else if (typeof cleanup === 'function') {
    activeCleanup = cleanup;
    finishRouteLoader();
  } else {
    finishRouteLoader();
  }
}

window.addEventListener('hashchange', mount);
