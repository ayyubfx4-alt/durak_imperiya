let initialized = false;
let cachedState = { enabled: false };

function getTelegramWebApp() {
  return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
}

function hasTelegramLaunchData(tg) {
  if (typeof tg.initData === 'string' && tg.initData.length > 0) return true;
  const launchParams = `${location.search || ''}${location.hash || ''}`;
  return /tgWebApp(Data|Version|Platform|StartParam)=/.test(launchParams);
}

function safeCall(fn) {
  try {
    if (typeof fn === 'function') return fn();
  } catch (_) {
    return undefined;
  }
  return undefined;
}

function setPixelVar(name, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return;
  document.documentElement.style.setProperty(name, `${Math.round(n)}px`);
}

function setInsetVars(prefix, inset) {
  if (!inset || typeof inset !== 'object') return;
  setPixelVar(`${prefix}-top`, inset.top);
  setPixelVar(`${prefix}-right`, inset.right);
  setPixelVar(`${prefix}-bottom`, inset.bottom);
  setPixelVar(`${prefix}-left`, inset.left);
}

function isVersionAtLeast(tg, version) {
  if (typeof tg.isVersionAtLeast !== 'function') return true;
  return safeCall(() => tg.isVersionAtLeast(version)) === true;
}

function applyViewport(tg) {
  setPixelVar('--durak-tg-viewport-height', tg.viewportStableHeight || tg.viewportHeight);
  setInsetVars('--durak-tg-safe', tg.safeAreaInset);
  setInsetVars('--durak-tg-content-safe', tg.contentSafeAreaInset);
}

function applyTelegramChrome(tg) {
  const dark = '#050505';
  if (isVersionAtLeast(tg, '6.1')) {
    safeCall(() => tg.setHeaderColor(dark));
    safeCall(() => tg.setBackgroundColor(dark));
  }
  if (isVersionAtLeast(tg, '7.10')) {
    safeCall(() => tg.setBottomBarColor(dark));
  }
}

export function initTelegramWebApp() {
  if (initialized) return cachedState;
  initialized = true;

  const tg = getTelegramWebApp();
  if (!tg || !hasTelegramLaunchData(tg)) return cachedState;

  document.documentElement.classList.add('telegram-webapp');
  document.body?.classList.add('telegram-webapp-body');
  window.__DURAK_TELEGRAM_WEBAPP__ = tg;

  applyViewport(tg);
  applyTelegramChrome(tg);

  if (typeof tg.onEvent === 'function') {
    safeCall(() => tg.onEvent('viewportChanged', () => applyViewport(tg)));
    safeCall(() => tg.onEvent('themeChanged', () => applyTelegramChrome(tg)));
    safeCall(() => tg.onEvent('safeAreaChanged', () => applyViewport(tg)));
    safeCall(() => tg.onEvent('contentSafeAreaChanged', () => applyViewport(tg)));
  }

  if (isVersionAtLeast(tg, '7.7')) {
    safeCall(() => tg.disableVerticalSwipes());
  }

  safeCall(() => tg.expand());
  safeCall(() => tg.ready());

  cachedState = {
    enabled: true,
    platform: tg.platform || 'unknown',
    version: tg.version || 'unknown',
    user: tg.initDataUnsafe?.user || null,
  };
  window.__DURAK_TELEGRAM_WEBAPP_STATE__ = cachedState;
  return cachedState;
}
