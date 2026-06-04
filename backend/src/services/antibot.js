// services/antibot.js
// Feature 32: Antibot Detection System
// Scoring factors (max 100 pts):
//   • Game speed < 2s avg turn time  → 30 pts
//   • IP shared with 5+ accounts     → 25 pts
//   • Device ID shared 3+ accounts   → 25 pts
//   • Playing > 10h/day              → 15 pts
//   • Linear move pattern            → 5 pts
// Thresholds: ≥90 → bot, 70-89 → suspicious, 50-69 → watch
// System bots (is_bot=TRUE) are EXCLUDED from scoring.

import { query } from '../db.js';
import { logger } from '../logger.js';

function scoreToCategory(score) {
  if (score >= 90) return 'bot';
  if (score >= 70) return 'suspicious';
  if (score >= 50) return 'watch';
  return 'clean';
}

/**
 * Called after each game ends with per-game metrics.
 * Accumulates evidence into antibot_scores (upsert).
 *
 * @param {object} opts
 * @param {string|number} opts.userId
 * @param {number}  opts.avgTurnMs        – average turn time in ms
 * @param {number}  opts.totalPlayMinutes – total play minutes today
 * @param {string}  opts.ip               – client IP
 * @param {string}  opts.deviceId         – fingerprint / device id (optional)
 */
export async function recordGameMetrics({
  userId,
  avgTurnMs = 0,
  totalPlayMinutes = 0,
  ip = '',
  deviceId = '',
  actionTypes = {},
}) {
  try {
    // Skip if this is a system bot user
    const botR = await query(
      `SELECT is_bot FROM users WHERE id = $1`,
      [userId]
    );
    if (!botR.rows[0] || botR.rows[0].is_bot) return; // system bot — exempt

    const details = {};
    let score = 0;

    // Factor 1: Game speed (avg turn < 2s)
    if (avgTurnMs > 0 && avgTurnMs < 2000) {
      score += 30;
      details.speed = { avgTurnMs, pts: 30 };
    }

    // Factor 2: IP shared with 5+ other accounts
    if (ip) {
      const ipR = await query(
        `SELECT COUNT(DISTINCT id)::int AS c
           FROM users
          WHERE last_ip = $1 AND id <> $2`,
        [ip, userId]
      );
      const ipCount = Number(ipR.rows[0]?.c || 0);
      if (ipCount >= 4) { // 4 others + self = 5
        score += 25;
        details.ip = { sharedWith: ipCount + 1, pts: 25 };
      }
    }

    // Factor 3: Device ID shared with 3+ accounts
    if (deviceId) {
      const devR = await query(
        `SELECT COUNT(DISTINCT id)::int AS c
           FROM users
          WHERE device_id = $1 AND id <> $2`,
        [deviceId, userId]
      );
      const devCount = Number(devR.rows[0]?.c || 0);
      if (devCount >= 2) { // 2 others + self = 3
        score += 25;
        details.device = { sharedWith: devCount + 1, pts: 25 };
      }
    }

    // Factor 4: Playing > 10h/day (600 minutes)
    if (totalPlayMinutes >= 600) {
      score += 15;
      details.playTime = { minutes: totalPlayMinutes, pts: 15 };
    }

    // Factor 5: Repetitive/linear action pattern.
    const actionEntries = Object.entries(actionTypes || {}).map(([name, count]) => [name, Number(count || 0)]);
    const totalActions = actionEntries.reduce((sum, [, count]) => sum + count, 0);
    const dominant = actionEntries.sort((a, b) => b[1] - a[1])[0];
    if (totalActions >= 6 && dominant && dominant[1] / totalActions >= 0.8) {
      score += 5;
      details.pattern = {
        dominantAction: dominant[0],
        dominantRatio: Number((dominant[1] / totalActions).toFixed(2)),
        totalActions,
        pts: 5,
      };
    }

    const category = scoreToCategory(score);

    // Upsert — take the greater of existing score and new score (don't reset cleared users)
    await query(
      `INSERT INTO antibot_scores (user_id, score, category, details, last_updated)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id)
       DO UPDATE SET
         score        = GREATEST(antibot_scores.score, EXCLUDED.score),
         category     = CASE
                          WHEN GREATEST(antibot_scores.score, EXCLUDED.score) >= 90 THEN 'bot'
                          WHEN GREATEST(antibot_scores.score, EXCLUDED.score) >= 70 THEN 'suspicious'
                          WHEN GREATEST(antibot_scores.score, EXCLUDED.score) >= 50 THEN 'watch'
                          ELSE 'clean'
                        END,
         details      = antibot_scores.details || EXCLUDED.details,
         last_updated = now()`,
      [userId, score, category, JSON.stringify(details)]
    );

    if (category !== 'clean') {
      logger.warn('[antibot] flagged user', { userId, score, category, details });
    }
  } catch (err) {
    // Non-fatal — antibot should never crash the game flow
    logger.error('[antibot] recordGameMetrics error', err.message);
  }
}

/**
 * Get paginated list of flagged users for the admin panel.
 * category: 'bot' | 'suspicious' | 'watch' | null (all non-clean)
 */
export async function getAntibotList({ category = null, limit = 100, offset = 0 } = {}) {
  const where = category
    ? `WHERE a.category = $3 AND u.is_bot IS NOT TRUE`
    : `WHERE a.category <> 'clean' AND u.is_bot IS NOT TRUE`;
  const params = category
    ? [limit, offset, category]
    : [limit, offset];

  const r = await query(
    `SELECT a.user_id, u.username, u.email, a.score, a.category, a.details, a.last_updated
       FROM antibot_scores a
       JOIN users u ON u.id = a.user_id
      ${where}
      ORDER BY a.score DESC, a.last_updated DESC
      LIMIT $1 OFFSET $2`,
    params
  );
  return r.rows;
}

/**
 * Remove a user's antibot score entry (admin action).
 */
export async function clearAntibotScore(userId) {
  await query(
    `DELETE FROM antibot_scores WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Bulk delete all users in a given category from antibot_scores.
 * Does NOT delete from users table — admin must confirm deletion separately.
 */
export async function bulkClearAntibotCategory(category) {
  const r = await query(
    `DELETE FROM antibot_scores WHERE category = $1 RETURNING user_id`,
    [category]
  );
  return r.rows.map((row) => row.user_id);
}

/**
 * Hard-delete a user from the users table (called when admin decides to remove a bot).
 * Cascades to all related tables via FK ON DELETE CASCADE.
 */
export async function deleteAntibotUser(userId) {
  // First remove antibot record to avoid FK issues
  await query(`DELETE FROM antibot_scores WHERE user_id = $1`, [userId]);
  const r = await query(`DELETE FROM users WHERE id = $1 AND is_bot IS NOT TRUE RETURNING id`, [userId]);
  return !!r.rows[0];
}

/**
 * Bulk hard-delete all users flagged as a given category (e.g. 'bot').
 * System bots (is_bot=TRUE) are always excluded from deletion.
 */
export async function bulkDeleteAntibotUsers(category) {
  const r = await query(
    `DELETE FROM users
      WHERE id IN (
        SELECT user_id FROM antibot_scores WHERE category = $1
      )
        AND is_bot IS NOT TRUE
      RETURNING id`,
    [category]
  );
  return r.rows.map((row) => row.id);
}
