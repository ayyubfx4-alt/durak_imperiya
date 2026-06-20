/**
 * achievements.js — Achievement unlock service.
 *
 * D2 FIX (N+1 query elimination):
 *   Old: for (const key of eligible) { await INSERT … }  — up to 24 round-trips
 *   New: single batch INSERT … ON CONFLICT DO NOTHING + RETURNING
 *        then single batch INSERT into achievement_inbox.
 *   Result: 2 DB round-trips per checkAndUnlock() call regardless of how
 *   many achievements are eligible (was up to 48 for a 4-player game).
 */

import { query } from '../db.js';
import { logger } from '../logger.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, unlockedFromStats } from '../data/achievements.js';

/**
 * Fetch user stats needed for achievement evaluation.
 * Returns null if user not found.
 */
async function fetchUserStats(userId) {
  const r = await query(
    `SELECT u.coins, u.win_streak, u.loss_streak, u.games_played,
            u.games_won, u.games_draw, u.bluffs_caught,
            (SELECT COUNT(*) FROM friends
              WHERE user_id = u.id AND status = 'accepted') AS friends
       FROM users u
      WHERE u.id = $1`,
    [userId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    winStreak:    Number(row.win_streak    || 0),
    lossStreak:   Number(row.loss_streak   || 0),
    coins:        Number(row.coins         || 0),
    gamesPlayed:  Number(row.games_played  || 0),
    gamesWon:     Number(row.games_won     || 0),
    draws:        Number(row.games_draw    || 0),
    bluffsCaught: Number(row.bluffs_caught || 0),
    friends:      Number(row.friends       || 0),
  };
}

/**
 * Compute fresh achievement unlocks for `userId` from the latest stats.
 *
 * BATCH INSERT pattern (D2 fix):
 *   1. One query: INSERT all eligible keys at once → get back the newly inserted ones.
 *   2. One query: INSERT achievement_inbox rows for newly unlocked keys.
 *   Total: 2 queries, regardless of achievement count.
 *
 * @returns {Promise<string[]>} newly unlocked achievement keys
 */
export async function checkAndUnlock(userId) {
  const stats = await fetchUserStats(userId);
  if (!stats) return [];

  const eligible = unlockedFromStats(stats);
  if (eligible.length === 0) return [];

  // Build a VALUES list: ($1,$2),($1,$3),…
  // userId is always $1; each key is $N where N = 2, 3, …
  const keyParams = eligible.map((_, i) => `($1, $${i + 2})`).join(', ');
  const r = await query(
    `INSERT INTO achievements (user_id, achievement_key)
     VALUES ${keyParams}
     ON CONFLICT (user_id, achievement_key) DO NOTHING
     RETURNING achievement_key`,
    [userId, ...eligible]
  );

  const newly = r.rows.map((row) => row.achievement_key);

  if (newly.length > 0) {
    // Batch insert inbox rows for all newly unlocked keys.
    const inboxParams = newly.map((_, i) => `($1, $${i + 2})`).join(', ');
    await query(
      `INSERT INTO achievement_inbox (user_id, achievement_key)
       VALUES ${inboxParams}
       ON CONFLICT DO NOTHING`,
      [userId, ...newly]
    ).catch((e) => logger.warn('[achievements] inbox batch insert failed: %s', e.message));

    logger.info('[achievements] user=%s unlocked=[%s]', userId, newly.join(', '));
  }

  return newly;
}

/**
 * Drain undelivered achievement popups for `userId`.
 * Marks rows as delivered and returns metadata for socket emission.
 *
 * @param {string|number} userId
 * @param {number} limit  max rows to drain per call
 * @returns {Promise<Array<{inboxId, key, name, category, target}>>}
 */
export async function drainInbox(userId, limit = 20) {
  const r = await query(
    `UPDATE achievement_inbox
        SET delivered    = TRUE,
            delivered_at = now()
      WHERE id IN (
        SELECT id FROM achievement_inbox
         WHERE user_id   = $1
           AND delivered = FALSE
         ORDER BY id ASC
         LIMIT $2
      )
      RETURNING id, achievement_key`,
    [userId, limit]
  );

  return r.rows.map((row) => {
    const meta = ACHIEVEMENT_BY_KEY[row.achievement_key]
      || { name: row.achievement_key, category: 'other', target: 0 };
    return {
      inboxId:  row.id,
      key:      row.achievement_key,
      name:     meta.name,
      category: meta.category,
      target:   meta.target,
    };
  });
}

/**
 * Read-only: full list of unlocked achievements (for profile/grid display).
 */
export async function listAchievements(userId) {
  const r = await query(
    `SELECT achievement_key, unlocked_at
       FROM achievements
      WHERE user_id = $1
      ORDER BY unlocked_at DESC`,
    [userId]
  );
  return r.rows;
}

/**
 * Full progress view — checks for new unlocks then returns progress for
 * every achievement including current vs. target counters.
 */
export async function listAchievementProgress(userId) {
  // Trigger unlock check and stat fetch in parallel.
  const [, stats, unlockedRows] = await Promise.all([
    checkAndUnlock(userId),
    fetchUserStats(userId),
    query(
      `SELECT achievement_key, unlocked_at
         FROM achievements
        WHERE user_id = $1`,
      [userId]
    ),
  ]);

  const row = stats || {};
  const statMap = {
    streak:      Number(row.winStreak    || 0),
    lossStreak:  Number(row.lossStreak   || 0),
    coins:       Number(row.coins        || 0),
    friends:     Number(row.friends      || 0),
    games:       Number(row.gamesPlayed  || 0),
    wins:        Number(row.gamesWon     || 0),
    draws:       Number(row.draws        || 0),
    bluffsCaught: Number(row.bluffsCaught || 0),
  };

  const unlocked = new Map(
    unlockedRows.rows.map((a) => [a.achievement_key, a.unlocked_at])
  );

  const items = ACHIEVEMENTS.map((a) => {
    const current = Number(statMap[a.category] || 0);
    const target  = Number(a.target || 0);
    return {
      ...a,
      current,
      progress:    target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0,
      unlocked:    unlocked.has(a.key),
      unlocked_at: unlocked.get(a.key) || null,
    };
  });

  return {
    total:    items.length,
    unlocked: items.filter((a) => a.unlocked).length,
    stats:    statMap,
    items,
  };
}
