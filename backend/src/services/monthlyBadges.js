// TOR §9 — monthly "Makkor tulki" / Cunning Fox badge.
//
// Awarded to whichever real user made the most successful bluffs during a
// calendar month. The metric we track is `bluffs_made`, but we only count
// the delta inside the period so winners from previous months don't
// dominate forever. To keep state simple, we snapshot each user's
// `bluffs_made` at the start of the month and compare deltas on settle.

import { query, withTransaction } from '../db.js';
import { logger } from '../logger.js';

const PERIOD_KEY = 'cunning_fox_snapshot';

/**
 * Persist the current per-user `bluffs_made` total so the next settlement
 * can compute the period delta. Stored as a JSON blob inside the
 * `audit_log` table for now to avoid a brand-new table.
 */
export async function snapshotBluffCounters() {
  const r = await query('SELECT id, bluffs_made FROM users WHERE is_banned = FALSE');
  const snap = Object.fromEntries(r.rows.map((u) => [u.id, Number(u.bluffs_made || 0)]));
  await query(
    "INSERT INTO audit_log (action, metadata) VALUES ($1, $2)",
    [PERIOD_KEY, snap]
  );
}

async function latestSnapshot() {
  const r = await query(
    `SELECT metadata FROM audit_log
      WHERE action = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [PERIOD_KEY]
  );
  return r.rows[0]?.metadata || {};
}

/**
 * Settle the badge for the supplied period. Picks the user with the
 * largest `bluffs_made` delta against the most recent snapshot, then
 * inserts a row in `monthly_badges` and an `achievements` unlock for
 * `monthly_cunning_fox`. If no one bluffed at all the month is skipped.
 */
export async function settleCunningFox(year, month) {
  const snap = await latestSnapshot();
  const r = await query('SELECT id, username, bluffs_made FROM users WHERE is_banned = FALSE');
  let topId = null;
  let topDelta = 0;
  for (const u of r.rows) {
    const delta = Math.max(0, Number(u.bluffs_made || 0) - Number(snap[u.id] || 0));
    if (delta > topDelta) {
      topDelta = delta;
      topId = u.id;
    }
  }
  if (!topId || topDelta < 1) {
    logger.info('cunning fox: no qualifying bluffs for %d-%d', year, month);
    return { winnerId: null, delta: 0 };
  }
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO monthly_badges (period_year, period_month, badge_key, user_id, metric_value)
       VALUES ($1, $2, 'cunning_fox', $3, $4)
       ON CONFLICT (period_year, period_month, badge_key) DO UPDATE
         SET user_id = EXCLUDED.user_id, metric_value = EXCLUDED.metric_value`,
      [year, month, topId, topDelta]
    );
    await client.query(
      `INSERT INTO achievements (user_id, achievement_key)
       VALUES ($1, 'monthly_cunning_fox')
       ON CONFLICT (user_id, achievement_key) DO NOTHING`,
      [topId]
    );
  });
  // New snapshot becomes the baseline for the next period.
  await snapshotBluffCounters();
  return { winnerId: topId, delta: topDelta };
}
