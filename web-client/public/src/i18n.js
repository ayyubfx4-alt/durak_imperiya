/**
 * src/i18n.js
 * Lightweight i18n module.
 *
 * Usage:
 *   import { t, setLocale, getLocale } from './i18n.js';
 *   t('login.google_btn')  // → "Google bilan kirish"  (if locale is 'uz')
 *
 * Locale priority:
 *   1. Saved value from localStorage (locale / pref_language / durak.locale)
 *   2. navigator.language prefix (ru / uz / en)
 *   3. Fallback 'uz'
 */

const SUPPORTED = ['uz', 'ru', 'en'];
const cache = {};
const LOAD_TIMEOUT_MS = 3500;
const USER_SET_KEY = 'durak.locale.userSet';

function storageGet(key) {
  try { return localStorage.getItem(key); }
  catch (_) { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); }
  catch (_) { /* storage can be blocked in some WebView/privacy modes */ }
}

function savedLocale() {
  return storageGet('locale')
    || storageGet('pref_language')
    || storageGet('durak.locale');
}

function localeWasUserSet() {
  return storageGet(USER_SET_KEY) === '1';
}

function persistLocale(locale, { userSet = false } = {}) {
  storageSet('locale', locale);
  storageSet('pref_language', locale);
  storageSet('durak.locale', locale);
  if (userSet) storageSet(USER_SET_KEY, '1');
  try { document.documentElement.lang = locale; } catch (_) {}
}

function resolve(code) {
  if (!code) code = '';
  const prefix = code.slice(0, 2).toLowerCase();
  return SUPPORTED.includes(prefix) ? prefix : 'uz';
}

async function load(locale) {
  if (cache[locale]) return cache[locale];
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS) : null;
  try {
    const res = await fetch(`/i18n/${locale}.json`, {
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error('fetch failed');
    cache[locale] = await res.json();
  } catch {
    cache[locale] = {};
  } finally {
    if (timer) clearTimeout(timer);
  }
  return cache[locale];
}

let _locale = resolve(savedLocale() || '');
let _strings = {};

/**
 * Initialize i18n — call once at app start before rendering.
 * Priority: 1) explicit user choice  2) Uzbek default.
 * Older builds persisted navigator.language automatically, which caused
 * Russian/English pages for Uzbek users. Only trust a saved locale after
 * the user has intentionally changed it in login/settings.
 */
export async function initI18n() {
  const saved = localeWasUserSet() ? savedLocale() : '';
  _locale = resolve(saved || 'uz');
  persistLocale(_locale, { userSet: !!saved });
  _strings = await load(_locale);
}

/**
 * Translate a dot-separated key, e.g. 'login.google_btn'.
 * Returns the key itself if no translation found.
 */
export function t(key) {
  const parts = key.split('.');
  let val = _strings;
  for (const p of parts) {
    if (val === undefined || val === null) return key;
    val = val[p];
  }
  return (typeof val === 'string') ? val : key;
}

/** Get the current locale code ('uz' | 'ru' | 'en') */
export function getLocale() { return _locale; }

/**
 * Change locale, persist to localStorage, reload strings.
 * Optionally calls a callback after loaded (to re-render UI).
 */
export async function setLocale(locale, onDone, options = {}) {
  const l = resolve(locale);
  _locale = l;
  persistLocale(l, { userSet: options.userSet !== false });
  _strings = await load(l);
  if (typeof onDone === 'function') onDone(l);
  if (options?.reload && typeof location !== 'undefined') location.reload();
}

/**
 * Returns the list of supported locales with labels for the Settings screen.
 */
export function supportedLocales() {
  return [
    { code: 'uz', label: "O'zbek", flag: '🇺🇿' },
    { code: 'ru', label: 'Русский', flag: '🇷🇺' },
    { code: 'en', label: 'English', flag: '🇬🇧' },
  ];
}
