import { api } from '../api.js';
import { state, emit } from '../state.js';

export const FEATURE_NAMES = {
  basic_play: "O'ynash",
  daily_reward: 'Kunlik mukofot',
  profile_stats: 'Profil statistikasi',
  first_free_sticker: 'Birinchi bepul stiker',
  inventory: 'Inventar',
  duplicate_cards: 'Dublikat kartalar',
  gift_system: "Sovg'a tizimi",
  friends: "Do'stlar",
  card_collection: 'Karta kolleksiyasi',
  baraban: 'Kunlik baraban',
  voice_chat: 'Ovozli chat',
  spectate: 'Tomoshabin rejimi',
  online_status: 'Online status',
  ranking: 'Reyting',
  achievements: 'Yutuqlar',
  daily_missions: 'Kunlik vazifalar',
  win_streak: "G'alaba seriyasi",
  tournament: 'Turnir',
  premium_tournament: 'Premium turnir',
  rare_rewards: 'Rare mukofotlar',
  animated_rewards: 'Animatsiyali mukofotlar',
  elite_rewards: 'Elite mukofotlar',
  rare_animated_effects: 'Rare effektlar',
  exclusive_profile_effects: 'Profil effektlari',
  advanced_missions: 'Murakkab missiyalar',
};

const DEFAULT_THRESHOLDS = {
  basic_play: 0,
  daily_reward: 3,
  profile_stats: 3,
  first_free_sticker: 3,
  inventory: 3,
  duplicate_cards: 5,
  gift_system: 5,
  friends: 5,
  card_collection: 5,
  baraban: 10,
  voice_chat: 10,
  spectate: 10,
  online_status: 10,
  ranking: 15,
  achievements: 15,
  daily_missions: 15,
  win_streak: 15,
  tournament: 20,
  premium_tournament: 20,
  rare_rewards: 20,
  animated_rewards: 20,
  elite_rewards: 30,
  rare_animated_effects: 30,
  exclusive_profile_effects: 30,
  advanced_missions: 30,
};

const DEFAULT_UNLOCKS = Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([feature, required]) => [
  feature,
  { unlocked: required === 0, required, label: FEATURE_NAMES[feature] || feature },
]));

let progressionState = {
  gamesPlayed: 0,
  unlocks: { ...DEFAULT_UNLOCKS },
};

function normalize(raw = {}) {
  const gamesPlayed = Number(raw.gamesPlayed ?? raw.games_played ?? state.user?.games_played ?? 0);
  const unlocks = {};
  for (const [feature, info] of Object.entries(raw.unlocks || DEFAULT_UNLOCKS)) {
    const required = Number(info.required ?? info.requiredGames ?? info.required_games ?? 0);
    unlocks[feature] = {
      unlocked: info.unlocked !== undefined ? !!info.unlocked : gamesPlayed >= required,
      required,
      requiredGames: required,
      remaining: Math.max(0, required - gamesPlayed),
      label: info.label || FEATURE_NAMES[feature] || feature,
    };
  }
  return { gamesPlayed, unlocks: { ...DEFAULT_UNLOCKS, ...unlocks } };
}

export async function loadProgression() {
  try {
    progressionState = normalize(await api.progression());
  } catch (_) {
    progressionState = normalize({ gamesPlayed: state.user?.games_played || 0, unlocks: DEFAULT_UNLOCKS });
  }
  state.progression = progressionState;
  emit('progression:update', progressionState);
  return progressionState;
}

export function getProgression() {
  return progressionState;
}

export function isUnlocked(feature) {
  if (!feature) return true;
  const info = progressionState?.unlocks?.[feature];
  return info ? !!info.unlocked : true;
}

export function getRequired(feature) {
  return Number(progressionState?.unlocks?.[feature]?.required || 0);
}

export function getRemaining(feature) {
  return Math.max(0, getRequired(feature) - getGamesPlayed());
}

export function getGamesPlayed() {
  return Number(progressionState?.gamesPlayed || state.user?.games_played || 0);
}

export function featureLabel(feature) {
  return progressionState?.unlocks?.[feature]?.label || FEATURE_NAMES[feature] || feature;
}

export function lockedMessage(feature) {
  return `${getRequired(feature)} ta o'yindan keyin ochiladi`;
}

export async function refreshProgression() {
  return loadProgression();
}

export function handleUnlockEvent(data = {}) {
  const gamesPlayed = Number(data.gamesPlayed ?? data.games_played ?? progressionState.gamesPlayed ?? 0);
  progressionState.gamesPlayed = gamesPlayed;
  if (state.user) state.user.games_played = gamesPlayed;
  const features = Array.isArray(data.features) ? data.features : [];
  for (const feature of features) {
    const current = progressionState.unlocks[feature] || { required: 0, label: featureLabel(feature) };
    progressionState.unlocks[feature] = { ...current, unlocked: true, remaining: 0 };
  }
  state.progression = progressionState;
  emit('progression:update', progressionState);
  for (const feature of features) showUnlockToast(feature);
}

function showUnlockToast(feature) {
  import('../state.js').then(({ toast }) => {
    toast(`${featureLabel(feature)} ochildi!`, 'success', 4200);
  }).catch(() => {});
}
