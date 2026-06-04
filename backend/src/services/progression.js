import { query } from '../db.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

let thresholdsCache = null;
let thresholdsCacheAt = 0;

export const FEATURE_LABELS = {
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
  exclusive_profile_effects: 'Eksklyuziv profil effektlari',
  advanced_missions: 'Murakkab missiyalar',
};

function normalizeThreshold(row) {
  return {
    feature: String(row.feature || ''),
    requiredGames: Number(row.required_games || 0),
    required_games: Number(row.required_games || 0),
    enabled: row.enabled !== false,
    label: FEATURE_LABELS[row.feature] || row.feature,
  };
}

export function clearThresholdCache() {
  thresholdsCache = null;
  thresholdsCacheAt = 0;
}

export async function getThresholdRows({ includeDisabled = false } = {}) {
  const sql = includeDisabled
    ? 'SELECT feature, required_games, enabled, updated_at FROM unlock_thresholds ORDER BY required_games ASC, feature ASC'
    : 'SELECT feature, required_games, enabled, updated_at FROM unlock_thresholds WHERE enabled = TRUE ORDER BY required_games ASC, feature ASC';
  const { rows } = await query(sql);
  return rows.map(normalizeThreshold);
}

export async function getThresholds() {
  if (thresholdsCache && Date.now() - thresholdsCacheAt < CACHE_TTL_MS) return thresholdsCache;
  const rows = await getThresholdRows();
  thresholdsCache = Object.fromEntries(rows.map((row) => [row.feature, row.requiredGames]));
  thresholdsCacheAt = Date.now();
  return thresholdsCache;
}

export async function getUserUnlocks(gamesPlayed = 0) {
  const current = Math.max(0, Number(gamesPlayed || 0));
  const rows = await getThresholdRows();
  return Object.fromEntries(rows.map((row) => [
    row.feature,
    {
      unlocked: current >= row.requiredGames,
      required: row.requiredGames,
      requiredGames: row.requiredGames,
      remaining: Math.max(0, row.requiredGames - current),
      label: row.label,
    },
  ]));
}

export async function isUnlocked(gamesPlayed = 0, feature) {
  const thresholds = await getThresholds();
  const required = thresholds[feature];
  if (required === undefined) return true;
  return Number(gamesPlayed || 0) >= Number(required || 0);
}

export async function getUserGamesPlayed(userId) {
  const r = await query('SELECT games_played FROM users WHERE id = $1', [userId]);
  return Number(r.rows[0]?.games_played || 0);
}

export function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      const gamesPlayed = req.user?.games_played === undefined
        ? await getUserGamesPlayed(req.user?.id)
        : Number(req.user.games_played || 0);
      const unlocked = await isUnlocked(gamesPlayed, feature);
      if (!unlocked) {
        const thresholds = await getThresholds();
        const required = Number(thresholds[feature] || 0);
        return res.status(403).json({
          error: 'FEATURE_LOCKED',
          feature,
          required,
          current: gamesPlayed,
          message: `Unlock after ${required} matches`,
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export async function recordUnlocksForGamesPlayed(userId, previousCount, newCount, client = null) {
  const db = client || { query };
  const prev = Math.max(0, Number(previousCount || 0));
  const current = Math.max(0, Number(newCount || 0));
  const thresholds = await getThresholds();
  const newlyUnlocked = [];

  for (const [feature, requiredRaw] of Object.entries(thresholds)) {
    const required = Number(requiredRaw || 0);
    if (prev < required && current >= required) {
      newlyUnlocked.push(feature);
      await db.query(
        `INSERT INTO feature_unlocks (user_id, feature, games_played_at_unlock)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, feature) DO NOTHING`,
        [userId, feature, current]
      ).catch(() => {});
    }
  }

  return { gamesPlayed: current, newlyUnlocked };
}

export async function recordGamePlayed(userId) {
  const r = await query(
    `UPDATE users
        SET games_played = games_played + 1,
            games_played_updated_at = NOW()
      WHERE id = $1
      RETURNING games_played`,
    [userId]
  );
  const gamesPlayed = Number(r.rows[0]?.games_played || 0);
  return recordUnlocksForGamesPlayed(userId, gamesPlayed - 1, gamesPlayed);
}
