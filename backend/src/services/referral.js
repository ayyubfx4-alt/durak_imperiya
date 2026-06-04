import { withTransaction, query } from '../db.js';
import { config } from '../config.js';
import { changeCoins } from './coins.js';
import { logger } from '../logger.js';

/**
 * TOR §13 — 32-generation binary referral tree.
 *
 *   • Each user has at most two direct referees: a "left" hand and a
 *     "right" hand. Beyond two, the upline keeps spillover slots open
 *     (further sign-ups simply don't get attached to that user — the
 *     downstream tree forms via the new user's own direct referees).
 *   • Level 1 reward: `config.game.referralBonus` ($5 by default).
 *   • Levels 2..32 reward: `config.game.referralDownstreamBonus` ($1 each).
 *   • Rewards are gated on `games_played >= referralGamesRequired`.
 *   • A user whose full 32-deep tree is populated earns the `lider` title
 *     plus an exclusive emoji pack and card skin (one-shot grants).
 */

/**
 * Pick which slot (`left` or `right`) of the upline the new user attaches
 * to. Returns null if both slots are full — the new user is still recorded
 * in the chain (so they earn downstream credit) but the upline's direct
 * slots stay as they were.
 */
async function pickEmptySlot(client, parentId) {
  const r = await client.query(
    'SELECT referral_left_id, referral_right_id FROM users WHERE id = $1 FOR UPDATE',
    [parentId]
  );
  if (!r.rows[0]) return null;
  if (!r.rows[0].referral_left_id) return 'left';
  if (!r.rows[0].referral_right_id) return 'right';
  return null;
}

/**
 * Build a 32-deep referral chain when a new user registers using
 * `referrerCode`. The upline's level-1 slot is updated atomically so two
 * concurrent registrations cannot both claim the same slot.
 */
export async function recordReferralChain(newUserId, referrerCode) {
  const ref = await query('SELECT id FROM users WHERE referral_code = $1', [referrerCode]);
  if (!ref.rows[0]) return;
  const directParentId = ref.rows[0].id;
  if (directParentId === newUserId) return;

  await withTransaction(async (client) => {
    // Direct hand: claim left/right slot if free.
    const slot = await pickEmptySlot(client, directParentId);
    if (slot === 'left') {
      await client.query(
        'UPDATE users SET referral_left_id = $1 WHERE id = $2 AND referral_left_id IS NULL',
        [newUserId, directParentId]
      );
    } else if (slot === 'right') {
      await client.query(
        'UPDATE users SET referral_right_id = $1 WHERE id = $2 AND referral_right_id IS NULL',
        [newUserId, directParentId]
      );
    }

    let currentId = directParentId;
    let position = slot;
    for (let level = 1; level <= config.game.referralMaxLevel; level++) {
      if (!currentId || currentId === newUserId) break;
      await client.query(
        `INSERT INTO referrals (referrer_id, referee_id, level, position)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [currentId, newUserId, level, level === 1 ? position : null]
      );
      const up = await client.query('SELECT referred_by FROM users WHERE id = $1', [currentId]);
      currentId = up.rows[0]?.referred_by;
      position = null;
    }

    await client.query(
      'UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL',
      [directParentId, newUserId]
    );
  });
}

/**
 * Called after a user finishes a game. Once they cross the games-played
 * threshold we pay each ancestor up to `referralMaxLevel` (TOR §13).
 *
 *   • Level 1 ancestor (direct upline)    → $referralBonus
 *   • Levels 2..32 (deeper upline)        → $referralDownstreamBonus
 *
 * Each `referrals` row is flipped to `rewarded = TRUE` first so a crash
 * mid-payout cannot double-pay.
 */
export async function maybePayReferralBonus(userId) {
  const rows = await withTransaction(async (client) => {
    const u = await client.query('SELECT games_played FROM users WHERE id = $1', [userId]);
    if (!u.rows[0]) return [];
    if (u.rows[0].games_played < config.game.referralGamesRequired) return [];
    const refs = await client.query(
      'SELECT id, referrer_id, level FROM referrals WHERE referee_id = $1 AND rewarded = FALSE',
      [userId]
    );
    for (const r of refs.rows) {
      await client.query('UPDATE referrals SET rewarded = TRUE, rewarded_at = now() WHERE id = $1', [r.id]);
    }
    return refs.rows;
  });
  if (!rows.length) return;

  const directBonus = config.game.referralBonus;
  const downstreamBonus = config.game.referralDownstreamBonus;
  const payoutByReferrer = new Map();
  for (const r of rows) {
    const reward = r.level === 1 ? directBonus : downstreamBonus;
    if (reward <= 0) continue;
    try {
      await changeCoins(r.referrer_id, reward, 'referral', userId, { level: r.level });
      payoutByReferrer.set(r.referrer_id, (payoutByReferrer.get(r.referrer_id) || 0) + reward);
    } catch (err) {
      logger.warn('referral payout skipped for %s: %s', r.referrer_id, err.message);
    }
  }
  // Refresh depth + leader status for everyone we just paid (cheap because
  // the set of referrers is bounded by 32).
  for (const referrerId of payoutByReferrer.keys()) {
    await refreshReferralDepth(referrerId).catch(() => {});
  }
}

/**
 * Recompute `users.referral_depth_max` for `userId` based on the maximum
 * downline level recorded in `referrals`. When the depth first reaches the
 * configured leader threshold we grant the exclusive emoji pack + card
 * skin (idempotent: handled by the inventory ON CONFLICT DO NOTHING).
 */
export async function refreshReferralDepth(userId) {
  return withTransaction(async (client) => {
    const r = await client.query(
      'SELECT COALESCE(MAX(level), 0)::int AS depth FROM referrals WHERE referrer_id = $1',
      [userId]
    );
    const depth = r.rows[0]?.depth || 0;
    const u = await client.query(
      'UPDATE users SET referral_depth_max = $1 WHERE id = $2 RETURNING referral_leader',
      [depth, userId]
    );
    if (!u.rows[0]) return { depth, leader: false, justEarned: false };
    const wasLeader = u.rows[0].referral_leader;
    if (!wasLeader && depth >= config.game.referralLeaderDepth) {
      await client.query(
        'UPDATE users SET referral_leader = TRUE WHERE id = $1',
        [userId]
      );
      const exclusiveEmoji = config.game.referralLeaderExclusiveEmoji;
      const exclusiveSkin = config.game.referralLeaderExclusiveSkin;
      if (exclusiveEmoji) {
        await client.query(
          `INSERT INTO inventory (user_id, item_type, item_id, quantity)
           VALUES ($1, 'emoji_pack', $2, 1)
           ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
          [userId, exclusiveEmoji]
        );
      }
      if (exclusiveSkin) {
        await client.query(
          `INSERT INTO inventory (user_id, item_type, item_id, quantity)
           VALUES ($1, 'card_skin', $2, 1)
           ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
          [userId, exclusiveSkin]
        );
      }
      return { depth, leader: true, justEarned: true };
    }
    return { depth, leader: wasLeader, justEarned: false };
  });
}

/**
 * Return a per-level rollup of a user's downstream referral activity. Used
 * by the profile screen to render the 32-gen "tree" widget.
 */
export async function getReferralStats(userId) {
  const r = await query(
    `SELECT level::int AS level,
            COUNT(*)::int        AS total,
            SUM(CASE WHEN rewarded THEN 1 ELSE 0 END)::int AS rewarded
       FROM referrals
      WHERE referrer_id = $1
      GROUP BY level
      ORDER BY level ASC`,
    [userId]
  );
  const depth = await query(
    'SELECT referral_depth_max, referral_leader FROM users WHERE id = $1',
    [userId]
  );
  return {
    perLevel: r.rows,
    depth: depth.rows[0]?.referral_depth_max ?? 0,
    leader: !!depth.rows[0]?.referral_leader,
    maxLevel: config.game.referralMaxLevel,
    directBonus: config.game.referralBonus,
    downstreamBonus: config.game.referralDownstreamBonus,
    leaderDepth: config.game.referralLeaderDepth,
  };
}
