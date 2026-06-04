export const PREF_DEFAULTS = {
  pref_dark_mode: true,
  pref_sound: true,
  pref_music: false,
  pref_vibration: true,
  pref_language: 'uz',
  pref_hud_size: 'middle',
  pref_graphics_quality: 'high',
  pref_fps_limit: 60,
  pref_shadows: true,
  pref_antialiasing: true,
  pref_effects_quality: 'high',
  pref_lighting_quality: 'high',
  pref_master_volume: 80,
  pref_music_volume: 50,
  pref_effects_volume: 90,
  pref_voice_volume: 70,
  pref_card_place_mode: 'tap',
  pref_joystick_lock: true,
  pref_rotate_table: true,
  pref_quick_chat: true,
  pref_auto_deal: false,
  pref_right_action: false,
  pref_double_tap: false,
  pref_sort_value: false,
  pref_turn_sorting: false,
  pref_card_shirt: false,
  pref_emotions: true,
  pref_reward_anim: true,
  pref_halal_mode: true,
};

export const PREF_MUSIC_USER_SET_KEY = 'pref_music_user_set';

function hasLocalStorage() {
  return typeof localStorage !== 'undefined';
}

function boolFromStorage(value) {
  return value === '1' || value === 'true';
}

function parseStoredValue(key, saved) {
  const fallback = PREF_DEFAULTS[key];
  if (typeof fallback === 'boolean') return boolFromStorage(saved);
  if (typeof fallback === 'number') {
    const n = Number(saved);
    return Number.isFinite(n) ? n : fallback;
  }
  return saved;
}

export function musicWasUserSet() {
  return hasLocalStorage() && localStorage.getItem(PREF_MUSIC_USER_SET_KEY) === '1';
}

export function markMusicUserSet() {
  if (hasLocalStorage()) localStorage.setItem(PREF_MUSIC_USER_SET_KEY, '1');
}

export function localMusicPreference() {
  if (!hasLocalStorage()) return null;
  const value = localStorage.getItem('pref_music');
  return value === null ? null : boolFromStorage(value);
}

export function localPreferenceValue(key) {
  if (!hasLocalStorage()) return null;
  const saved = localStorage.getItem(key);
  return saved === null ? null : parseStoredValue(key, saved);
}

export function prefValue(key, user = null) {
  if (key === 'pref_music') {
    if (musicWasUserSet()) {
      const localValue = localMusicPreference();
      if (localValue !== null) return localValue;
    } else {
      return false;
    }
  }
  const localValue = localPreferenceValue(key);
  if (localValue !== null) return localValue;
  const settings = user?.settings || {};
  if (Object.prototype.hasOwnProperty.call(settings, key)) return settings[key];
  return PREF_DEFAULTS[key];
}

export function pref(key, user = null) {
  return !!prefValue(key, user);
}

export function setPref(key, value) {
  localStorage.setItem(key, value ? '1' : '0');
  window.dispatchEvent(new CustomEvent('imperia:pref-change', {
    detail: { key, value: !!value },
  }));
}

export function setPrefValue(key, value) {
  const fallback = PREF_DEFAULTS[key];
  localStorage.setItem(key, typeof fallback === 'boolean' ? (value ? '1' : '0') : String(value));
  window.dispatchEvent(new CustomEvent('imperia:pref-change', {
    detail: { key, value },
  }));
}

export function vibrate(ms = 18) {
  if (!pref('pref_vibration')) return;
  try { navigator.vibrate?.(ms); } catch (_) {}
}
