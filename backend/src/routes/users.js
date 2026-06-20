import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { query } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';
import { getReferralStats } from '../services/referral.js';
import { syncUserGameStats } from '../services/gameStats.js';
import { STICKER_PACKS } from '../data/stickerPacks.js';
import { EMOJI_PACKS } from '../data/emojiPacks.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { PROFILE_REWARDS, grantAvailableProfileRewards, progressReward } from '../services/profileRewards.js';
import { getUserUnlocks } from '../services/progression.js';

export const usersRouter = Router();

const DEFAULT_USER_SETTINGS = {
  pref_dark_mode: true,
  pref_vibration: true,
  pref_language: 'uz',
  pref_hud_size: 'middle',
  pref_graphics_quality: 'high',
  pref_fps_limit: 60,
  pref_shadows: true,
  pref_antialiasing: true,
  pref_effects_quality: 'high',
  pref_lighting_quality: 'high',
  pref_sound: true,
  pref_music: false,
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

const USER_SETTING_TYPES = {
  pref_dark_mode: 'boolean',
  pref_vibration: 'boolean',
  pref_language: 'string',
  pref_hud_size: 'string',
  pref_graphics_quality: 'string',
  pref_fps_limit: 'number',
  pref_shadows: 'boolean',
  pref_antialiasing: 'boolean',
  pref_effects_quality: 'string',
  pref_lighting_quality: 'string',
  pref_sound: 'boolean',
  pref_music: 'boolean',
  pref_master_volume: 'number',
  pref_music_volume: 'number',
  pref_effects_volume: 'number',
  pref_voice_volume: 'number',
  pref_card_place_mode: 'string',
  pref_joystick_lock: 'boolean',
  pref_rotate_table: 'boolean',
  pref_quick_chat: 'boolean',
  pref_auto_deal: 'boolean',
  pref_right_action: 'boolean',
  pref_double_tap: 'boolean',
  pref_sort_value: 'boolean',
  pref_turn_sorting: 'boolean',
  pref_card_shirt: 'boolean',
  pref_emotions: 'boolean',
  pref_reward_anim: 'boolean',
  pref_halal_mode: 'boolean',
};

usersRouter.get('/me/progression', authRequired, async (req, res, next) => {
  try {
    await syncUserGameStats(req.user.id);
    const r = await query('SELECT games_played FROM users WHERE id = $1', [req.user.id]);
    const gamesPlayed = Number(r.rows[0]?.games_played || 0);
    res.json({
      gamesPlayed,
      games_played: gamesPlayed,
      unlocks: await getUserUnlocks(gamesPlayed),
    });
  } catch (err) { next(err); }
});

const USER_SETTING_ENUMS = {
  pref_language: ['uz', 'ru', 'en'],
  pref_hud_size: ['compact', 'middle', 'wide'],
  pref_graphics_quality: ['low', 'medium', 'high', 'ultra'],
  pref_effects_quality: ['low', 'medium', 'high'],
  pref_lighting_quality: ['low', 'medium', 'high'],
  pref_card_place_mode: ['tap', 'drag'],
};

const USER_SETTING_NUMBERS = {
  pref_fps_limit: { values: [30, 60, 90, 120], fallback: DEFAULT_USER_SETTINGS.pref_fps_limit },
  pref_master_volume: { min: 0, max: 100, fallback: DEFAULT_USER_SETTINGS.pref_master_volume },
  pref_music_volume: { min: 0, max: 100, fallback: DEFAULT_USER_SETTINGS.pref_music_volume },
  pref_effects_volume: { min: 0, max: 100, fallback: DEFAULT_USER_SETTINGS.pref_effects_volume },
  pref_voice_volume: { min: 0, max: 100, fallback: DEFAULT_USER_SETTINGS.pref_voice_volume },
};

export function sanitizeUserSettings(incoming = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(incoming || {})) {
    const type = USER_SETTING_TYPES[key];
    if (!type) continue;
    if (type === 'boolean') clean[key] = value === true || value === '1' || value === 'true' || value === 1;
    else if (type === 'number') {
      const rule = USER_SETTING_NUMBERS[key];
      const n = Math.round(Number(value));
      if (rule?.values) clean[key] = rule.values.includes(n) ? n : rule.fallback;
      else clean[key] = Number.isFinite(n) ? Math.max(rule.min, Math.min(rule.max, n)) : rule.fallback;
    } else if (USER_SETTING_ENUMS[key]) {
      const text = String(value || '').slice(0, 32);
      clean[key] = USER_SETTING_ENUMS[key].includes(text) ? text : DEFAULT_USER_SETTINGS[key];
    } else {
      clean[key] = String(value || '').slice(0, 32);
    }
  }
  return clean;
}

usersRouter.get('/leaderboard', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const sort = String(req.query.sort || 'rank_wins');
    const orderBy = sort === 'coins'
      ? 'coins DESC, rank_wins DESC'
      : ['won', 'wins', 'games_won'].includes(sort)
        ? 'games_won DESC, rank_wins DESC'
        : ['donation', 'donations', 'donated'].includes(sort)
          ? 'total_donated_cents DESC, rank_wins DESC'
          : sort === 'fame'
          ? 'elon_stickers DESC, sheriff_marks DESC, games_won DESC'
          : 'rank_wins DESC, games_won DESC';
    const r = await query(
      `SELECT id, username, nickname, avatar_url, coins, country_code, gold_coins, rank_wins, rank_color, rank_lines, rank_pluses,
              games_won, games_played, win_streak, loss_streak, sheriff_marks, elon_stickers, total_donated_cents,
              ROW_NUMBER() OVER (ORDER BY ${orderBy}, id ASC)::int AS position
         FROM users
        WHERE is_banned = FALSE AND is_admin IS NOT TRUE AND is_bot IS NOT TRUE
        ORDER BY ${orderBy}, id ASC
        LIMIT $1`,
      [limit]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

usersRouter.get('/leaderboard/overview', async (_req, res, next) => {
  try {
    const [totals, leader, prizes] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS players,
                COALESCE(SUM(coins),0)::bigint AS total_coins,
                COALESCE(SUM(gold_coins),0)::bigint AS total_gold,
                COALESCE(MAX(rank_wins),0)::int AS max_rank_wins
           FROM users WHERE is_banned = FALSE AND is_admin IS NOT TRUE AND is_bot IS NOT TRUE`
      ),
      query(
        `SELECT id, username, nickname, avatar_url, coins, country_code, gold_coins, rank_wins, rank_color,
                games_won, games_played, win_streak
           FROM users
          WHERE is_banned = FALSE AND is_admin IS NOT TRUE AND is_bot IS NOT TRUE
          ORDER BY rank_wins DESC, games_won DESC
          LIMIT 1`
      ),
      query(
        `SELECT placement, gold_coins
           FROM tournament_payouts
          ORDER BY awarded_at DESC
          LIMIT 3`
      ).catch(() => ({ rows: [] })),
    ]);
    res.json({
      season: {
        name: 'Sezon 7',
        endsInSeconds: 6 * 24 * 60 * 60 + 12 * 60 * 60 + 45 * 60 + 30,
      },
      totals: totals.rows[0] || { players: 0, total_coins: 0, total_gold: 0, max_rank_wins: 0 },
      leader: leader.rows[0] || null,
      prizes: prizes.rows,
      updatedEverySeconds: 600,
    });
  } catch (err) { next(err); }
});

usersRouter.get('/leaderboard/me', authRequired, async (req, res, next) => {
  try {
    const sort = String(req.query.sort || 'season');
    const orderCol = sort === 'coins'
      ? 'coins'
      : ['won', 'wins', 'games_won'].includes(sort)
        ? 'games_won'
        : ['donation', 'donations', 'donated'].includes(sort)
          ? 'total_donated_cents'
        : 'rank_wins';
    const r = await query(
      `WITH ranked AS (
         SELECT id, username, nickname, avatar_url, coins, country_code, gold_coins, rank_wins, rank_color,
                games_won, games_played, win_streak,
                ROW_NUMBER() OVER (ORDER BY ${orderCol} DESC, rank_wins DESC, games_won DESC, id ASC) AS rank
           FROM users
          WHERE is_banned = FALSE AND is_admin IS NOT TRUE AND is_bot IS NOT TRUE
       )
       SELECT * FROM ranked WHERE id = $1`,
      [req.user.id]
    );
    const row = r.rows[0] || null;
    res.json({ rank: row ? Number(row.rank) : null, user: row });
  } catch (err) { next(err); }
});

usersRouter.post('/me/profile', authRequired, async (req, res, next) => {
  try {
    const avatarUrl = typeof req.body?.avatarUrl === 'string' ? req.body.avatarUrl.slice(0, 800000) : null;
    if (avatarUrl && !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(avatarUrl) && !/^https?:\/\//.test(avatarUrl)) {
      return res.status(400).json({ error: 'invalid avatar' });
    }
    const sets = [];
    const params = [req.user.id];
    if (avatarUrl !== null) {
      params.push(avatarUrl);
      sets.push(`avatar_url = $${params.length}`);
    }
    if (!sets.length) return res.json({ ok: true });
    const r = await query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1
       RETURNING id, username, nickname, avatar_url, coins, country_code, gold_coins, settings_json AS settings`,
      params
    );
    res.json({ ok: true, user: r.rows[0] });
  } catch (err) { next(err); }
});

usersRouter.get('/me/settings', authRequired, async (req, res, next) => {
  try {
    const r = await query('SELECT settings_json AS settings FROM users WHERE id = $1', [req.user.id]);
    res.json({ ok: true, settings: r.rows[0]?.settings || {} });
  } catch (err) { next(err); }
});

usersRouter.post('/me/settings', authRequired, async (req, res, next) => {
  try {
    const incoming = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : {};
    const clean = sanitizeUserSettings(incoming);
    const r = await query(
      `UPDATE users
          SET settings_json = COALESCE(settings_json, '{}'::jsonb) || $2::jsonb,
              updated_at = now()
        WHERE id = $1
        RETURNING settings_json AS settings`,
      [req.user.id, JSON.stringify(clean)]
    );
    res.json({ ok: true, settings: r.rows[0]?.settings || {} });
  } catch (err) { next(err); }
});

usersRouter.post('/me/settings/reset', authRequired, async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE users
          SET settings_json = $2::jsonb,
              updated_at = now()
        WHERE id = $1
        RETURNING settings_json AS settings`,
      [req.user.id, JSON.stringify(DEFAULT_USER_SETTINGS)]
    );
    res.json({ ok: true, settings: r.rows[0]?.settings || DEFAULT_USER_SETTINGS });
  } catch (err) { next(err); }
});

usersRouter.patch('/me/country', authRequired, async (req, res, next) => {
  try {
    const countryCode = String(req.body?.countryCode || req.body?.country_code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) return res.status(400).json({ error: 'invalid country' });
    const r = await query(
      `UPDATE users
          SET country_code = $2,
              updated_at = now()
        WHERE id = $1
        RETURNING id, username, nickname, country_code`,
      [req.user.id, countryCode]
    );
    res.json({ ok: true, user: r.rows[0] });
  } catch (err) { next(err); }
});

usersRouter.get('/countries/stats', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT COALESCE(country_code, 'ZZ') AS country_code,
              COUNT(*)::int AS total_players,
              COALESCE(SUM(games_won), 0)::int AS total_wins,
              COALESCE(SUM(games_played), 0)::int AS total_games,
              CASE WHEN COALESCE(SUM(games_played), 0) > 0
                   THEN ROUND((SUM(games_won)::numeric / NULLIF(SUM(games_played), 0)) * 100, 2)
                   ELSE 0 END AS win_rate
         FROM users
        WHERE is_banned = FALSE AND is_admin IS NOT TRUE AND is_bot IS NOT TRUE
        GROUP BY COALESCE(country_code, 'ZZ')
        ORDER BY total_wins DESC, total_players DESC, country_code ASC
        LIMIT 250`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

usersRouter.get('/profile/:id', async (req, res, next) => {
  try {
    await syncUserGameStats(req.params.id);
    const r = await query(
      `SELECT id, username, nickname, avatar_url, coins, country_code, gold_coins,
              rank_wins, rank_color, rank_lines, rank_pluses, rank_progress,
              games_played, games_won, games_lost, games_draw,
              win_streak, loss_streak, bluffs_caught, bluffs_made, sheriff_marks, elon_stickers,
              badges_showcase, selected_skin, selected_avatar_frame, premium_until, total_donated_cents, created_at
         FROM users
        WHERE id = $1
          AND is_banned = FALSE
          AND is_admin IS NOT TRUE
          AND is_bot IS NOT TRUE`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    const rank = await query(
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY rank_wins DESC, games_won DESC, id ASC) AS global_rank
           FROM users
          WHERE is_banned = FALSE AND is_admin IS NOT TRUE AND is_bot IS NOT TRUE
       )
       SELECT global_rank FROM ranked WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ...r.rows[0], global_rank: Number(rank.rows[0]?.global_rank || 0) });
  } catch (err) { next(err); }
});

usersRouter.get('/me/showcase', authRequired, async (req, res, next) => {
  try {
    await syncUserGameStats(req.user.id);
    const u = await query(
      `SELECT id, username, nickname, avatar_url, coins, country_code, gold_coins,
              rank_wins, rank_color, rank_lines, rank_pluses, rank_progress,
              games_played, games_won, games_lost, games_draw,
              win_streak, loss_streak, bluffs_caught, sheriff_marks,
              premium_until, total_donated_cents, badges_showcase, selected_avatar_frame, created_at
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = u.rows[0];
    if (!user) throw new HttpError(404, 'user not found');

    await grantAvailableProfileRewards(req.user.id, user);
    const fresh = await query(
      `SELECT id, username, nickname, avatar_url, coins, country_code, gold_coins,
              rank_wins, rank_color, rank_lines, rank_pluses, rank_progress,
              games_played, games_won, games_lost, games_draw,
              win_streak, loss_streak, bluffs_caught, sheriff_marks,
              premium_until, total_donated_cents, badges_showcase, selected_avatar_frame, created_at
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    const me = fresh.rows[0];
    const rank = await query(
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY rank_wins DESC, games_won DESC, id ASC) AS global_rank
           FROM users
           WHERE is_banned = FALSE AND is_admin IS NOT TRUE AND is_bot IS NOT TRUE
       )
       SELECT global_rank FROM ranked WHERE id = $1`,
      [req.user.id]
    );
    me.global_rank = Number(rank.rows[0]?.global_rank || 0);

    const inv = await query(
      `SELECT item_type, item_id, quantity, obtained_at
         FROM inventory WHERE user_id = $1`,
      [req.user.id]
    );
    const stickerOwned = new Map();
    const emojiOwnedByPack = new Map();
    for (const row of inv.rows) {
      if (row.item_type === 'sticker_pack') stickerOwned.set(row.item_id, Number(row.quantity || 0));
      if (row.item_type === 'emoji') {
        const [packId, emojiId] = String(row.item_id).split(':');
        if (!emojiOwnedByPack.has(packId)) emojiOwnedByPack.set(packId, new Map());
        emojiOwnedByPack.get(packId).set(emojiId, Number(row.quantity || 0));
      }
    }

    const claimed = await query(
      `SELECT metadata->>'rewardKey' AS key
         FROM transactions
        WHERE user_id = $1 AND type = 'profile_reward'`,
      [req.user.id]
    );
    const claimedKeys = new Set(claimed.rows.map((r) => r.key).filter(Boolean));
    const ach = await query(
      `SELECT achievement_key, unlocked_at
         FROM achievements WHERE user_id = $1`,
      [req.user.id]
    );
    const unlockedAchievements = new Set(ach.rows.map((r) => r.achievement_key));

    res.json({
      user: me,
      rewards: PROFILE_REWARDS.map((r) => progressReward(r, me, claimedKeys)),
      achievements: ACHIEVEMENTS.map((a) => ({
        ...a,
        unlocked: unlockedAchievements.has(a.key),
      })),
      stickers: STICKER_PACKS.map((p) => ({
        id: p.id,
        name: p.name,
        rarity: p.rarity,
        premium: p.premium,
        priceGold: p.priceGold,
        owned: stickerOwned.get(p.id) || 0,
        total: p.size,
        size: p.size,
        themeColor: p.themeColor,
        themeGlow: p.themeGlow,
        panelColor: p.panelColor,
        tag: p.tag,
        preview: p.stickers.slice(0, 8),
        stickers: p.stickers,
      })),
      emojiPacks: EMOJI_PACKS.slice(0, 16).map((p) => {
        const owned = emojiOwnedByPack.get(p.id) || new Map();
        return {
          id: p.id,
          name: p.name,
          rarity: p.rarity,
          premium: p.premium,
          owned: owned.size,
          total: p.emoji.length,
          emoji: p.emoji.map((e) => ({ ...e, qty: owned.get(e.id) || 0 })),
        };
      }),
    });
  } catch (err) { next(err); }
});

// TOR §13: 32-generation referral tree. Reports per-level activity, the
// deepest generation reached, and whether the user has unlocked the
// "lider" title + exclusive emoji/skin set.
usersRouter.get('/me/referral-depth', authRequired, async (req, res, next) => {
  try {
    const stats = await getReferralStats(req.user.id);
    const totalReferrals = stats.perLevel.reduce((acc, r) => acc + (r.total || 0), 0);
    res.json({
      ...stats,
      totalReferrals,
      qualifiesForExclusive: stats.depth >= stats.leaderDepth,
    });
  } catch (err) { next(err); }
});

// TOR §13: explicit tree view used by the profile widget (level rollups
// + meta). Same data as /me/referral-depth — kept under a stable path so
// the client can use it directly.
usersRouter.get('/me/referral-tree', authRequired, async (req, res, next) => {
  try {
    res.json(await getReferralStats(req.user.id));
  } catch (err) { next(err); }
});

/**
 * Daily-bonus is removed in the v4 TOR. The endpoint stays to keep older
 * clients from crashing but always reports the feature is gone.
 */
usersRouter.post('/me/daily-bonus', authRequired, (_req, res) => {
  res.status(410).json({ error: 'daily bonus removed in v4 — earn via ads or play' });
});

/**
 * Dev/local ad bonus fallback. In production the reward is granted only from
 * `/api/admob/ssv` after Google AdMob SSV signature verification.
 */
usersRouter.post('/me/ad-bonus', authRequired, async (req, res, next) => {
  try {
    const source = String(req.body?.adSource || req.body?.source || 'unknown');
    const production = config.env === 'production';
    const allowDevReward = process.env.ALLOW_WEB_AD_REWARD === '1' || !production;
    if (!allowDevReward) {
      return res.status(403).json({
        error: 'rewarded ad server-side verification is required in production; use /api/admob/ssv callback',
      });
    }
    // Fully atomic ad-bonus claim:
    // The UPDATE sets last_ad_at AND adds the bonus in one query so concurrent
    // requests from the same user cannot both succeed (the second UPDATE will
    // find last_ad_at already refreshed and fail the cooldown predicate).
    const cooldownIv = `${Math.max(1, Math.floor(config.game.adCooldownHours))} hours`;
    const claim = await query(
      `UPDATE users
         SET last_ad_at = now(),
             coins = coins + $2
       WHERE id = $1
         AND ($3::bigint <= 0 OR coins <= $3)
         AND (last_ad_at IS NULL OR last_ad_at < now() - ($4)::interval)
       RETURNING last_ad_at, coins`,
      [req.user.id, config.game.adBonus, config.game.adBalanceCap, cooldownIv]
    );
    if (!claim.rows[0]) {
      // Either balance too high, cooldown still running, or user not found.
      const u = await query('SELECT last_ad_at, coins FROM users WHERE id = $1', [req.user.id]);
      if (!u.rows[0]) throw new HttpError(404, 'user not found');
      if (config.game.adBalanceCap > 0 && Number(u.rows[0].coins) > config.game.adBalanceCap) {
        return res.status(403).json({
          error: 'ad bonus only available while balance is at or below the cap',
          cap: config.game.adBalanceCap,
          balance: Number(u.rows[0].coins),
        });
      }
      const last = u.rows[0].last_ad_at ? new Date(u.rows[0].last_ad_at) : null;
      const cooldownMs = config.game.adCooldownHours * 3600 * 1000;
      return res.status(429).json({
        error: 'cooldown',
        msRemaining: last ? Math.max(0, cooldownMs - (Date.now() - last.getTime())) : cooldownMs,
      });
    }
    // Coin grant is already applied in the UPDATE above — record ledger entry.
    await query(
      `INSERT INTO transactions (user_id, amount, type, metadata) VALUES ($1, $2, 'ad', $3)`,
      [req.user.id, config.game.adBonus, { source: 'ad_bonus', adSource: source }]
    ).catch(() => {}); // non-fatal if transaction table doesn't exist yet
    res.json({ ok: true, awarded: config.game.adBonus, coins: Number(claim.rows[0].coins) });
  } catch (err) { next(err); }
});

/** Surface the v4 economy constants so the client can render rules / picker. */
usersRouter.get('/config/economy', (_req, res) => {
  res.json({
    minBet: config.game.minBet,
    maxBet: config.game.maxBet,
    betTiers: config.game.betTiers,
    allowedTableSizes: config.game.allowedTableSizes,
    adBonus: config.game.adBonus,
    adCooldownHours: config.game.adCooldownHours,
    adBalanceCap: config.game.adBalanceCap,
    friendCoinGiftDailyLimit: config.game.friendCoinGiftDailyLimit,
    elonStickerStakeThreshold: config.game.elonStickerStakeThreshold,
    tournament: config.game.tournament,
  });
});
