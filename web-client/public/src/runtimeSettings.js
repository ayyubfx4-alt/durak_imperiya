import { PREF_DEFAULTS, localMusicPreference, musicWasUserSet, prefValue } from './preferences.js?v=111-encoding-fix';
import { sfx } from './sfx.js?v=111-encoding-fix';

const FPS_VALUES = [30, 60, 90, 120];
const QUALITY_VALUES = ['low', 'medium', 'high', 'ultra'];
const EFFECT_VALUES = ['low', 'medium', 'high'];
const LANG_VALUES = ['uz', 'ru', 'en'];
const HUD_VALUES = ['compact', 'middle', 'wide'];
const CARD_PLACE_VALUES = ['tap', 'drag'];

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true' || value === '1' || value === 1;
}

function volume(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function fps(value) {
  const n = Number(value);
  return FPS_VALUES.includes(n) ? n : PREF_DEFAULTS.pref_fps_limit;
}

export function normalizeRuntimeSettings(settings = {}) {
  const merged = { ...PREF_DEFAULTS, ...(settings || {}) };
  return {
    ...merged,
    pref_dark_mode: bool(merged.pref_dark_mode, true),
    pref_sound: bool(merged.pref_sound, true),
    pref_music: musicWasUserSet() ? (localMusicPreference() ?? bool(merged.pref_music, false)) : false,
    pref_vibration: bool(merged.pref_vibration, true),
    pref_shadows: bool(merged.pref_shadows, true),
    pref_antialiasing: bool(merged.pref_antialiasing, true),
    pref_joystick_lock: bool(merged.pref_joystick_lock, true),
    pref_rotate_table: bool(merged.pref_rotate_table, true),
    pref_quick_chat: bool(merged.pref_quick_chat, true),
    pref_auto_deal: bool(merged.pref_auto_deal, false),
    pref_right_action: bool(merged.pref_right_action, false),
    pref_double_tap: bool(merged.pref_double_tap, false),
    pref_sort_value: bool(merged.pref_sort_value, false),
    pref_turn_sorting: bool(merged.pref_turn_sorting, false),
    pref_card_shirt: bool(merged.pref_card_shirt, false),
    pref_emotions: bool(merged.pref_emotions, true),
    pref_reward_anim: bool(merged.pref_reward_anim, true),
    pref_halal_mode: bool(merged.pref_halal_mode, true),
    pref_language: pick(merged.pref_language, LANG_VALUES, PREF_DEFAULTS.pref_language),
    pref_hud_size: pick(merged.pref_hud_size, HUD_VALUES, PREF_DEFAULTS.pref_hud_size),
    pref_graphics_quality: pick(merged.pref_graphics_quality, QUALITY_VALUES, PREF_DEFAULTS.pref_graphics_quality),
    pref_fps_limit: fps(merged.pref_fps_limit),
    pref_effects_quality: pick(merged.pref_effects_quality, EFFECT_VALUES, PREF_DEFAULTS.pref_effects_quality),
    pref_lighting_quality: pick(merged.pref_lighting_quality, EFFECT_VALUES, PREF_DEFAULTS.pref_lighting_quality),
    pref_card_place_mode: pick(merged.pref_card_place_mode, CARD_PLACE_VALUES, PREF_DEFAULTS.pref_card_place_mode),
    pref_master_volume: volume(merged.pref_master_volume, PREF_DEFAULTS.pref_master_volume),
    pref_music_volume: volume(merged.pref_music_volume, PREF_DEFAULTS.pref_music_volume),
    pref_effects_volume: volume(merged.pref_effects_volume, PREF_DEFAULTS.pref_effects_volume),
    pref_voice_volume: volume(merged.pref_voice_volume, PREF_DEFAULTS.pref_voice_volume),
  };
}

export function runtimeSettingsFrom(user = null) {
  const next = {};
  for (const key of Object.keys(PREF_DEFAULTS)) next[key] = prefValue(key, user);
  return normalizeRuntimeSettings(next);
}

export function applyRuntimeSettings(settings = {}) {
  if (typeof document === 'undefined') return normalizeRuntimeSettings(settings);
  const normalized = normalizeRuntimeSettings(settings?.settings || settings);
  const root = document.documentElement;

  root.dataset.fpsLimit = String(normalized.pref_fps_limit);
  root.dataset.graphicsQuality = normalized.pref_graphics_quality;
  root.dataset.effectsQuality = normalized.pref_effects_quality;
  root.dataset.lightingQuality = normalized.pref_lighting_quality;
  root.dataset.hudSize = normalized.pref_hud_size;
  root.dataset.cardPlaceMode = normalized.pref_card_place_mode;

  root.classList.toggle('pref-dark', normalized.pref_dark_mode);
  root.classList.toggle('pref-shadows-off', !normalized.pref_shadows);
  root.classList.toggle('pref-aa-off', !normalized.pref_antialiasing);
  for (const q of QUALITY_VALUES) root.classList.toggle(`pref-graphics-${q}`, normalized.pref_graphics_quality === q);
  for (const value of FPS_VALUES) root.classList.toggle(`pref-fps-${value}`, normalized.pref_fps_limit === value);

  const motionFactor = {
    30: '1.65',
    60: '1',
    90: '0.78',
    120: '0.64',
  }[normalized.pref_fps_limit] || '1';
  const glowStrength = {
    low: '0.28',
    medium: '0.62',
    high: '1',
    ultra: '1.22',
  }[normalized.pref_graphics_quality] || '1';

  root.style.setProperty('--durak-motion-factor', motionFactor);
  root.style.setProperty('--durak-glow-strength', glowStrength);
  root.style.setProperty('--durak-master-volume', String(normalized.pref_master_volume / 100));

  sfx.configure?.({
    soundEnabled: normalized.pref_sound,
    musicEnabled: normalized.pref_music,
    masterVolume: normalized.pref_master_volume,
    musicVolume: normalized.pref_music_volume,
    effectsVolume: normalized.pref_effects_volume,
    voiceVolume: normalized.pref_voice_volume,
  });

  return normalized;
}

let runtimeSettingsBound = false;

export function initRuntimeSettings(getUser = () => null) {
  if (runtimeSettingsBound) return;
  runtimeSettingsBound = true;

  const sync = () => applyRuntimeSettings(runtimeSettingsFrom(getUser()));
  sync();

  window.addEventListener('imperia:pref-change', sync);
  window.addEventListener('storage', (event) => {
    if (event.key && Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, event.key)) sync();
  });
}
