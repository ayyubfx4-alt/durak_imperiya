/**
 * src/i18n.js
 * Lightweight i18n module.
 *
 * Usage:
 *   import { t, setLocale, getLocale } from './i18n.js';
 *   t('login.google_btn')  // → "Google bilan kirish"  (if locale is 'uz')
 *
 * Locale is:
 *   1. Saved value from localStorage
 *   2. navigator.language prefix (uz / ru / en)
 *   3. Fallback 'en'
 */

const SUPPORTED = ['uz', 'ru', 'en'];
const cache = {};

function savedLocale() {
  return localStorage.getItem('locale')
    || localStorage.getItem('pref_language')
    || localStorage.getItem('durak.locale');
}

function persistLocale(locale) {
  localStorage.setItem('locale', locale);
  localStorage.setItem('pref_language', locale);
  localStorage.setItem('durak.locale', locale);
  document.documentElement.lang = locale;
}

let _locale = resolve(savedLocale() || 'uz');
let _strings = {};

function resolve(code) {
  if (!code) code = '';
  const prefix = code.slice(0, 2).toLowerCase();
  return SUPPORTED.includes(prefix) ? prefix : 'en';
}

async function load(locale) {
  if (cache[locale]) return cache[locale];
  try {
    const res = await fetch(`/i18n/${locale}.json`);
    if (!res.ok) throw new Error('fetch failed');
    cache[locale] = await res.json();
  } catch {
    // fallback to empty object — t() will return the key
    cache[locale] = {};
  }
  return cache[locale];
}

/**
 * Initialize i18n — call once at app start before rendering.
 * Detects device locale if not saved in localStorage.
 */
export async function initI18n() {
  const saved = savedLocale();
  _locale = resolve(saved || 'uz');
  persistLocale(_locale);
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
export async function setLocale(locale, onDone) {
  const l = resolve(locale);
  _locale = l;
  persistLocale(l);
  _strings = await load(l);
  if (typeof onDone === 'function') onDone(l);
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
