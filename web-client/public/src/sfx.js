/**
 * Sound effects module — Web Audio API synthesized sounds.
 * Hech qanday audio fayllar yuklanmaydi, real-time sintez qilamiz.
 *
 * MIJOZ TALABI (Audio/Sound Design):
 *   - Karta tarqatish ovozi
 *   - Karta tashlash ovozi
 *   - Button click ovozi
 *   - Coin yutish ovozi
 *   - Timeout warning ovozi
 *   - Settings'da sound on/off
 *
 * Foydalanish:
 *   import { sfx } from './sfx.js';
 *   sfx.play('click');
 *   sfx.setEnabled(false);
 */

let audioCtx = null;
let enabled = (localStorage.getItem('pref_sound') ?? '1') === '1';
let musicEnabled = (localStorage.getItem('pref_music') ?? '0') === '1';
let masterGain = null;
let musicTimer = null;
let musicGain = null;
const activeMusicNodes = new Set();
let masterVolume = readVolume('pref_master_volume', 80);
let effectsVolume = readVolume('pref_effects_volume', 90);
let musicVolume = readVolume('pref_music_volume', 50);
let voiceVolume = readVolume('pref_voice_volume', 70);

// v97: old builds auto-wrote pref_music=1. Treat it as off until the user
// explicitly toggles Music in Settings in this build.
if (localStorage.getItem('pref_music_user_set') !== '1') {
  musicEnabled = false;
  localStorage.setItem('pref_music', '0');
}

function readVolume(key, fallback) {
  const n = Number(localStorage.getItem(key));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
}

function scaled(value, base = 1) {
  return Math.max(0, Math.min(1, Number(value || 0) / 100)) * base;
}

function applyMasterGain() {
  if (masterGain) masterGain.gain.value = enabled ? scaled(masterVolume, 0.72) : 0;
}

function applyMusicGain() {
  if (musicGain) musicGain.gain.value = canPlayMusic() ? scaled(musicVolume, 0.7) : 0;
}

function canPlayMusic() {
  return enabled && musicEnabled && masterVolume > 0 && musicVolume > 0;
}

function canPlayEffects() {
  return enabled && masterVolume > 0 && effectsVolume > 0;
}

function ctx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      applyMasterGain();
      masterGain.connect(audioCtx.destination);
    } catch (e) {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone({ freq = 440, dur = 0.12, type = 'sine', vol = 0.5, attack = 0.005, decay = 0.08, slideTo = null }) {
  if (!canPlayEffects()) return;
  const c = ctx();
  if (!c || !masterGain) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(vol * scaled(effectsVolume), c.currentTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  osc.connect(g);
  g.connect(masterGain);
  osc.start();
  osc.stop(c.currentTime + dur + 0.02);
}

function noise({ dur = 0.06, vol = 0.4, filterFreq = 1500, filterType = 'bandpass' }) {
  if (!canPlayEffects()) return;
  const c = ctx();
  if (!c || !masterGain) return;
  const bufferSize = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // decay
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = 1.2;
  const g = c.createGain();
  g.gain.value = vol * scaled(effectsVolume);
  src.connect(filter); filter.connect(g); g.connect(masterGain);
  src.start();
}

const SFX = {
  click: () => {
    tone({ freq: 1200, dur: 0.05, type: 'square', vol: 0.18 });
  },
  deal: () => {
    // Karta tarqatish ovozi (oz "swoosh")
    noise({ dur: 0.08, vol: 0.30, filterFreq: 2400, filterType: 'bandpass' });
  },
  cardThrow: () => {
    // Karta stolga uchirilganda
    noise({ dur: 0.12, vol: 0.4, filterFreq: 1800, filterType: 'highpass' });
    setTimeout(() => tone({ freq: 220, dur: 0.06, type: 'triangle', vol: 0.2 }), 30);
  },
  cardBeat: () => {
    // Karta urilganda (zarba)
    tone({ freq: 380, slideTo: 140, dur: 0.18, type: 'sawtooth', vol: 0.35 });
    noise({ dur: 0.1, vol: 0.3, filterFreq: 900 });
  },
  take: () => {
    // O'yinchi kartani olganda (kichik "schwoop")
    tone({ freq: 260, slideTo: 120, dur: 0.22, type: 'sine', vol: 0.3 });
  },
  win: () => {
    // G'alaba fanfara
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.4 }), i * 90)
    );
  },
  lose: () => {
    // Mag'lubiyat (decending)
    [400, 350, 280, 200].forEach((f, i) =>
      setTimeout(() => tone({ freq: f, dur: 0.18, type: 'sawtooth', vol: 0.3 }), i * 110)
    );
  },
  coin: () => {
    // Coin (tanga) ovozi — yorqin "ding"
    tone({ freq: 988, dur: 0.10, type: 'sine', vol: 0.4 });
    setTimeout(() => tone({ freq: 1319, dur: 0.16, type: 'sine', vol: 0.35 }), 40);
  },
  warning: () => {
    // Timeout warning (urgent beep)
    tone({ freq: 880, dur: 0.08, type: 'square', vol: 0.4 });
    setTimeout(() => tone({ freq: 880, dur: 0.08, type: 'square', vol: 0.4 }), 130);
  },
  notification: () => {
    tone({ freq: 660, dur: 0.10, type: 'triangle', vol: 0.30 });
    setTimeout(() => tone({ freq: 880, dur: 0.14, type: 'triangle', vol: 0.30 }), 80);
  },
  error: () => {
    tone({ freq: 200, dur: 0.18, type: 'sawtooth', vol: 0.35 });
  },
  shuffle: () => {
    // Kartalar aralashtirilishi
    for (let i = 0; i < 6; i++) {
      setTimeout(() => noise({ dur: 0.04, vol: 0.18, filterFreq: 2000 + Math.random() * 1000 }), i * 35);
    }
  },
};

function musicNote(freq, delay = 0, dur = 1.8) {
  if (!canPlayMusic()) return;
  const c = ctx();
  if (!c || !musicGain) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + delay);
  g.gain.linearRampToValueAtTime(0.055, c.currentTime + delay + 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + dur);
  osc.connect(g);
  g.connect(musicGain);
  activeMusicNodes.add(osc);
  osc.onended = () => activeMusicNodes.delete(osc);
  osc.start(c.currentTime + delay);
  osc.stop(c.currentTime + delay + dur + 0.05);
}

function startMusic() {
  if (!canPlayMusic() || musicTimer) return;
  const c = ctx();
  if (!c || !masterGain) return;
  musicGain = musicGain || c.createGain();
  applyMusicGain();
  try { musicGain.disconnect(); } catch (_) {}
  musicGain.connect(masterGain);
  const loop = () => {
    if (!canPlayMusic()) return;
    musicNote(196, 0, 2.4);
    musicNote(246.94, 1.2, 2.2);
    musicNote(293.66, 2.4, 2.1);
    musicNote(246.94, 3.6, 2.2);
  };
  loop();
  musicTimer = setInterval(loop, 4800);
}

function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  activeMusicNodes.forEach((node) => {
    try { node.stop(0); } catch (_) {}
  });
  activeMusicNodes.clear();
  if (musicGain) {
    try { musicGain.gain.value = 0; } catch (_) {}
    try { musicGain.disconnect(); } catch (_) {}
  }
}

function applyVoiceAudio(audio) {
  if (!audio) return audio;
  const volume = enabled ? scaled(voiceVolume) : 0;
  audio.volume = volume;
  audio.muted = volume <= 0;
  return audio;
}

export const sfx = {
  play(name) {
    if (!enabled) return;
    try { SFX[name]?.(); } catch (_) { /* silent */ }
  },
  configure(options = {}) {
    const hasSound = Object.prototype.hasOwnProperty.call(options, 'soundEnabled');
    const hasMusic = Object.prototype.hasOwnProperty.call(options, 'musicEnabled');
    if (hasSound) this.setEnabled(options.soundEnabled);
    if (Number.isFinite(Number(options.masterVolume))) this.setMasterVolume(options.masterVolume);
    if (Number.isFinite(Number(options.effectsVolume))) this.setEffectsVolume(options.effectsVolume);
    if (Number.isFinite(Number(options.musicVolume))) this.setMusicVolume(options.musicVolume);
    if (Number.isFinite(Number(options.voiceVolume))) this.setVoiceVolume(options.voiceVolume);
    if (hasMusic) this.setMusicEnabled(options.musicEnabled);
  },
  setEnabled(v) {
    enabled = !!v;
    localStorage.setItem('pref_sound', v ? '1' : '0');
    applyMasterGain();
    document.querySelectorAll('audio#voice-remote-audio').forEach(applyVoiceAudio);
    if (!enabled) {
      stopMusic();
    } else if (musicEnabled) {
      startMusic();
    }
  },
  setMusicEnabled(v) {
    musicEnabled = !!v;
    localStorage.setItem('pref_music', v ? '1' : '0');
    if (musicEnabled) startMusic();
    else stopMusic();
  },
  setMasterVolume(v) {
    masterVolume = readVolumeFromValue(v, 80);
    localStorage.setItem('pref_master_volume', String(masterVolume));
    applyMasterGain();
    document.querySelectorAll('audio#voice-remote-audio').forEach(applyVoiceAudio);
    if (canPlayMusic() && !musicTimer) startMusic();
    if (!canPlayMusic()) stopMusic();
  },
  setEffectsVolume(v) {
    effectsVolume = readVolumeFromValue(v, 90);
    localStorage.setItem('pref_effects_volume', String(effectsVolume));
  },
  setMusicVolume(v) {
    musicVolume = readVolumeFromValue(v, 50);
    localStorage.setItem('pref_music_volume', String(musicVolume));
    applyMusicGain();
    if (canPlayMusic() && !musicTimer) startMusic();
    if (!canPlayMusic()) stopMusic();
  },
  setVoiceVolume(v) {
    voiceVolume = readVolumeFromValue(v, 70);
    localStorage.setItem('pref_voice_volume', String(voiceVolume));
    document.querySelectorAll('audio#voice-remote-audio').forEach(applyVoiceAudio);
  },
  applyVoiceAudio,
  isMusicEnabled() { return musicEnabled; },
  isEnabled() { return enabled; },
  volumes() {
    return { masterVolume, effectsVolume, musicVolume, voiceVolume };
  },
};

function readVolumeFromValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
}

// Birinchi user gesture'da audio context'ni "unlock" qilish (iOS Safari uchun)
function unlock() {
  ctx();
  if (musicEnabled) startMusic();
  window.removeEventListener('touchstart', unlock);
  window.removeEventListener('click', unlock);
}
window.addEventListener('touchstart', unlock, { once: true });
window.addEventListener('click', unlock, { once: true });
