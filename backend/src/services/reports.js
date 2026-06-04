// TOR §14 — player reports (shikoyat) + admin-applied bans with optional
// expiry. Records arrive as `reports` rows; admins resolve each by either
// dismissing it or applying a ban duration from `config.game.banDurations`.
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';

const REASONS = new Set(['cheating', 'abuse', 'spam', 'griefing', 'other']);
const STATUSES = new Set(['open', 'resolved', 'dismissed']);
const RESOLUTIONS = new Set([
  'no_action',
  'warned',
  'banned_1m',
  'banned_3m',
  'banned_6m',
  'banned_1y',
  'banned_permanent',
]);

const RESOLUTION_TO_DURATION_KEY = {
  banned_1m: 'one_month',
  banned_3m: 'three_months',
  banned_6m: 'six_months',
  banned_1y: 'one_year',
  banned_permanent: 'permanent',
};

export async function submitReport({ reporterId, reportedId, roomCode, gameId, reason, details }) {
  if (reporterId === reportedId) throw new HttpError(400, 'cannot report yourself');
  const cleanReason = REASONS.has(String(reason)) ? String(reason) : 'other';
  const trimDetails = String(details || '').slice(0, 1024) || null;
  const r = await query(
    `INSERT INTO reports (reporter_id, reported_id, room_code, game_id, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [reporterId, reportedId, roomCode || null, gameId || null, cleanReason, trimDetails]
  );
  return r.rows[0];
}

export async function listReports({ status = 'open', limit = 100, offset = 0 } = {}) {
  const cap = Math.max(1, Math.min(500, Number(limit) || 100));
  const skip = Math.max(0, Number(offset) || 0);
  let where = '';
  const params = [];
  if (status && status !== 'all') {
    if (!STATUSES.has(status)) throw new HttpError(400, 'invalid status');
    params.push(status);
    where = `WHERE r.status = $${params.length}`;
  }
  params.push(cap, skip);
  const r = await query(
    `SELECT r.id, r.reporter_id, r.reported_id, r.room_code, r.game_id, r.reason,
            r.details, r.status, r.resolution, r.resolved_at, r.created_at,
            ru.username AS reporter_username,
            tu.username AS reported_username
       FROM reports r
       LEFT JOIN users ru ON ru.id = r.reporter_id
       LEFT JOIN users tu ON tu.id = r.reported_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return r.rows;
}

/**
 * Apply a resolution to a report and (when the resolution is a ban)
 * suspend the reported user for the configured number of days. Permanent
 * bans set `banned_until = NULL` to distinguish them from time-limited
 * suspensions in the schema.
 */
export async function resolveReport({ reportId, adminId, resolution }) {
  if (!RESOLUTIONS.has(resolution)) throw new HttpError(400, 'invalid resolution');
  return withTransaction(async (client) => {
    const r = await client.query(
      `SELECT id, reported_id, status FROM reports WHERE id = $1 FOR UPDATE`,
      [reportId]
    );
    if (!r.rows[0]) throw new HttpError(404, 'report not found');
    if (r.rows[0].status !== 'open') throw new HttpError(400, 'report already closed');

    const reportedId = r.rows[0].reported_id;
    const isBanResolution = resolution.startsWith('banned_');
    let bannedUntil = null;
    if (isBanResolution) {
      const durationKey = RESOLUTION_TO_DURATION_KEY[resolution];
      const days = config.game.banDurations?.[durationKey];
      if (days === undefined) throw new HttpError(400, 'invalid ban duration');
      if (days === null) {
        // permanent ban: keep banned_until NULL
        await client.query(
          `UPDATE users SET is_banned = TRUE, banned_until = NULL, banned_reason = $2 WHERE id = $1`,
          [reportedId, `report:${reportId}`]
        );
      } else {
        const u = await client.query(
          `UPDATE users
              SET is_banned = TRUE,
                  banned_until = now() + ($2 || ' days')::interval,
                  banned_reason = $3
            WHERE id = $1
            RETURNING banned_until`,
          [reportedId, String(days), `report:${reportId}`]
        );
        bannedUntil = u.rows[0]?.banned_until;
      }
    }

    const status = isBanResolution || resolution !== 'no_action' ? 'resolved' : 'dismissed';
    await client.query(
      `UPDATE reports
          SET status = $2, resolution = $3, resolved_by = $4, resolved_at = now()
        WHERE id = $1`,
      [reportId, status, resolution, adminId]
    );
    return { ok: true, status, resolution, bannedUntil };
  });
}

/**
 * Promote / extend a ban without going through a report (admin direct
 * action). Accepts one of the keys from `config.game.banDurations` plus
 * `permanent`. Pass `key === null` (or omitted) for permanent.
 */
export async function adminBanUser({ adminId, userId, key, reason }) {
  if (!userId) throw new HttpError(400, 'userId required');
  if (key && !(key in config.game.banDurations)) throw new HttpError(400, 'invalid duration');
  const days = key ? config.game.banDurations[key] : null;
  if (days === null) {
    const u = await query(
      `UPDATE users
          SET is_banned = TRUE,
              banned_until = NULL,
              banned_reason = $2
        WHERE id = $1
        RETURNING id`,
      [userId, reason || `admin:${adminId}`]
    );
    if (!u.rows[0]) throw new HttpError(404, 'user not found');
    return { ok: true, bannedUntil: null };
  }
  const u = await query(
    `UPDATE users
        SET is_banned = TRUE,
            banned_until = now() + ($2 || ' days')::interval,
            banned_reason = $3
      WHERE id = $1
      RETURNING banned_until`,
    [userId, String(days), reason || `admin:${adminId}`]
  );
  return { ok: true, bannedUntil: u.rows[0]?.banned_until ?? null };
}

export async function adminUnbanUser({ userId }) {
  const u = await query(
    `UPDATE users
        SET is_banned = FALSE,
            banned_until = NULL,
            banned_reason = NULL
      WHERE id = $1
      RETURNING id`,
    [userId]
  );
  if (!u.rows[0]) throw new HttpError(404, 'user not found');
  return { ok: true };
}

/**
 * Refresh the `is_banned` flag for time-limited bans that have expired.
 * Called by the auth middleware on every request so a 30-day ban does not
 * outlive its window.
 */
export async function expireOldBans() {
  await query(
    `UPDATE users
        SET is_banned = FALSE, banned_until = NULL
      WHERE is_banned = TRUE
        AND banned_until IS NOT NULL
        AND banned_until <= now()`
  );
}

export const REPORT_REASONS = Array.from(REASONS);
export const REPORT_RESOLUTIONS = Array.from(RESOLUTIONS);
