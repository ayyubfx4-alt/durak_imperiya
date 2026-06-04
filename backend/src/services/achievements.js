// Achievement service — checks unlock thresholds after every game and
// queues popups in `achievement_inbox` so the client can show a real-time
// notification the next time the user is connected. The socket layer
// (see game/socket.js → flushAchievementInbox) drains the inbox and emits
// `achievement:unlock` events.
//
// The DB row is the source of truth — if the socket layer misses a delivery
// (user offline, server restart), the popup still fires on the next
// connection. Each row carries a `delivered` flag so we never re-emit.
import { query } from '../db.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, unlockedFromStats } from '../data/achievements.js';
import { logger } from '../logger.js';

/**
 * Compute fresh achievement unlocks for `userId` from the latest stats.
 * Returns the newly unlocked keys. Side effects:
 *   • Inserts into `achievements` (unique on user_id + achievement_key).
 *   • Inserts a row into `achievement_inbox` for each newly unlocked key
 *     so the realtime layer can deliver a popup.
 */
export async function checkAndUnlock(userId) {
  const u = await query(
    `SELECT u.coins, u.win_streak, u.loss_streak, u.games_played, u.games_won, u.games_draw, u.bluffs_caught,
            (SELECT COUNT(*) FROM friends WHERE user_id = u.id AND status = 'accepted') AS friends
       FROM users u WHERE u.id = $1`,
    [userId]
  );
  if (!u.rows[0]) return [];

  const stats = {
    winStreak: u.rows[0].win_streak,
    lossStreak: u.rows[0].loss_streak,
    coins: Number(u.rows[0].coins),
    gamesPlayed: u.rows[0].games_played,
    gamesWon: u.rows[0].games_won,
    draws: u.rows[0].games_draw,
    bluffsCaught: u.rows[0].bluffs_caught,
    friends: Number(u.rows[0].friends),
  };
  const eligible = unlockedFromStats(stats);
  const newly = [];
  for (const key of eligible) {
    try {
      const r = await query(
        `INSERT INTO achievements (user_id, achievement_key)
           VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING achievement_key`,
        [userId, key]
      );
      if (r.rows[0]) {
        newly.push(key);
        // Queue the popup so it survives an offline window or restart.
        await query(
          `INSERT INTO achievement_inbox (user_id, achievement_key) VALUES ($1, $2)`,
          [userId, key]
        ).catch((e) => logger.warn('inbox insert failed', e.message));
      }
    } catch (e) {
      logger.warn('achievement upsert failed', e.message);
    }
  }
  return newly;
}

/**
 * Drain undelivered popups for a user. Returns an array of
 * `{ key, name, category, target }` ready to emit. Marks rows as delivered.
 */
export async function drainInbox(userId, limit = 20) {
  const r = await query(
    `UPDATE achievement_inbox SET delivered = TRUE, delivered_at = now()
       WHERE id IN (
         SELECT id FROM achievement_inbox
           WHERE user_id = $1 AND delivered = FALSE
           ORDER BY id ASC LIMIT $2
       )
     RETURNING id, achievement_key`,
    [userId, limit]
  );
  return r.rows.map((row) => {
    const meta = ACHIEVEMENT_BY_KEY[row.achievement_key] || { name: row.achievement_key, category: 'other', target: 0 };
    return {
      inboxId: row.id,
      key: row.achievement_key,
      name: meta.name,
      category: meta.category,
      target: meta.target,
    };
  });
}

/** Read-only: full list of unlocked achievements (for the profile/grid). */
export async function listAchievements(userId) {
  const r = await query(
    `SELECT achievement_key, unlocked_at FROM achievements
       WHERE user_id = $1 ORDER BY unlocked_at DESC`,
    [userId]
  );
  return r.rows;
}

export async function listAchievementProgress(userId) {
  await checkAndUnlock(userId);
  const r = await query(
    `SELECT u.coins, u.win_streak, u.loss_streak, u.games_played, u.games_won, u.games_draw, u.bluffs_caught,
            (SELECT COUNT(*) FROM friends WHERE user_id = u.id AND status = 'accepted') AS friends
       FROM users u WHERE u.id = $1`,
    [userId]
  );
  const row = r.rows[0] || {};
  const stats = {
    streak: Number(row.win_streak || 0),
    lossStreak: Number(row.loss_streak || 0),
    coins: Number(row.coins || 0),
    friends: Number(row.friends || 0),
    games: Number(row.games_played || 0),
    wins: Number(row.games_won || 0),
    draws: Number(row.games_draw || 0),
    bluffsCaught: Number(row.bluffs_caught || 0),
  };

  const unlockedRows = await query(
    `SELECT achievement_key, unlocked_at
       FROM achievements
      WHERE user_id = $1`,
    [userId]
  );
  const unlocked = new Map(unlockedRows.rows.map((a) => [a.achievement_key, a.unlocked_at]));
  const items = ACHIEVEMENTS.map((a) => {
    const current = Number(stats[a.category] || 0);
    const target = Number(a.target || 0);
    return {
      ...a,
      current,
      progress: target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0,
      unlocked: unlocked.has(a.key),
      unlocked_at: unlocked.get(a.key) || null,
    };
  });
  return {
    total: items.length,
    unlocked: items.filter((a) => a.unlocked).length,
    stats,
    items,
  };
}
