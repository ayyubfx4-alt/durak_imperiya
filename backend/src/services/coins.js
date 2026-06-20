/**
 * coins.js — Atomic coin credit/debit service.
 *
 * RACE-CONDITION PROOF (S1 fix):
 *   changeCoins uses a single `UPDATE … WHERE (coins + $amount) >= 0 RETURNING coins`
 *   statement. PostgreSQL acquires a row lock on the UPDATE itself, so two
 *   concurrent debits on the same user race the lock — only the first that
 *   passes the WHERE condition wins; the second sees rowCount=0 and throws
 *   'insufficient coins'. No SELECT→check→UPDATE window exists.
 *
 *   The old SELECT FOR UPDATE pattern was correct too, but required a full
 *   serializable transaction. This form is simpler, equally safe, and one
 *   fewer round-trip to the DB.
 */

import { withTransaction, query } from '../db.js';
import { logger } from '../logger.js';
import { HttpError } from '../middleware/error.js';

/**
 * Atomically credit (amount > 0) or debit (amount < 0) a user's coin balance.
 *
 * @param {string|number} userId
 * @param {number}        amount   — signed integer; positive = credit, negative = debit
 * @param {string}        type     — transaction type key (win, stake_reserve, purchase…)
 * @param {string|null}   referenceId
 * @param {object|null}   metadata
 * @returns {Promise<number>} new coin balance
 * @throws {HttpError(404)} if user not found
 * @throws {HttpError(400)} if balance would go negative or amount is invalid
 */
export async function changeCoins(userId, amount, type, referenceId = null, metadata = null) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || !Number.isInteger(amt)) {
    throw new HttpError(400, `invalid coin amount: ${amount}`);
  }
  if (!type || typeof type !== 'string') {
    throw new HttpError(400, 'transaction type is required');
  }

  return withTransaction(async (client) => {
    // Single atomic statement — credit unconditionally (amount > 0),
    // or debit only when balance will remain >= 0 (amount < 0).
    const r = await client.query(
      `UPDATE users
          SET coins      = coins + $1,
              updated_at = now()
        WHERE id = $2
          AND (coins + $1) >= 0
        RETURNING coins`,
      [amt, userId]
    );

    if (r.rowCount === 0) {
      // Distinguish "user doesn't exist" from "balance too low".
      const exists = await client.query('SELECT 1 FROM users WHERE id = $1', [userId]);
      if (!exists.rows[0]) throw new HttpError(404, 'user not found');
      throw new HttpError(400, 'insufficient coins');
    }

    const newBalance = Number(r.rows[0].coins);

    await client.query(
      `INSERT INTO transactions (user_id, amount, type, reference_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, amt, type, referenceId ?? null, metadata ? JSON.stringify(metadata) : null]
    );

    logger.debug('[coins] changeCoins userId=%s amount=%d type=%s newBalance=%d', userId, amt, type, newBalance);
    return newBalance;
  });
}

/** Read-only balance lookup — no lock, for display purposes only. */
export async function getBalance(userId) {
  const r = await query('SELECT coins FROM users WHERE id = $1', [userId]);
  return Number(r.rows[0]?.coins ?? 0);
}

/**
 * Transfer coins between two users atomically.
 *
 * Deadlock prevention: both rows are locked in ascending `id` order so
 * concurrent A→B and B→A transfers never deadlock each other.
 *
 * @param {string|number} fromId
 * @param {string|number} toId
 * @param {number}        amount   — must be positive
 * @param {string}        type
 * @param {string|null}   referenceId
 */
export async function transferCoins(fromId, toId, amount, type = 'gift', referenceId = null) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, 'transfer amount must be a positive integer');
  if (String(fromId) === String(toId)) throw new HttpError(400, 'cannot transfer to self');

  return withTransaction(async (client) => {
    // Lock both rows in deterministic order to avoid deadlock.
    const lock = await client.query(
      `SELECT id, coins
         FROM users
        WHERE id = ANY($1::uuid[])
        ORDER BY id
          FOR UPDATE`,
      [[fromId, toId]]
    );

    if (lock.rows.length < 2) {
      throw new HttpError(404, lock.rows.length === 0 ? 'users not found' : 'one user not found');
    }

    const sender = lock.rows.find((row) => String(row.id) === String(fromId));
    if (!sender) throw new HttpError(404, 'sender not found');
    if (Number(sender.coins) < amt) throw new HttpError(400, 'insufficient coins');

    // Atomic debit + credit.
    await client.query('UPDATE users SET coins = coins - $1, updated_at = now() WHERE id = $2', [amt, fromId]);
    await client.query('UPDATE users SET coins = coins + $1, updated_at = now() WHERE id = $2', [amt, toId]);

    // Dual ledger entries.
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, reference_id, metadata)
       VALUES ($1, $2, $3, $4, $5),
              ($6, $7, $8, $9, $10)`,
      [
        fromId, -amt, type, referenceId, JSON.stringify({ to: toId }),
        toId,    amt, type, referenceId, JSON.stringify({ from: fromId }),
      ]
    );

    logger.debug('[coins] transfer fromId=%s toId=%s amount=%d type=%s', fromId, toId, amt, type);
  });
}
