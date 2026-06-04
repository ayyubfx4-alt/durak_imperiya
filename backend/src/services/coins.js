import { withTransaction, query } from '../db.js';
import { HttpError } from '../middleware/error.js';

/** Atomically credit/debit a user's coins and write a transaction log. */
export async function changeCoins(userId, amount, type, referenceId = null, metadata = null) {
  return withTransaction(async (client) => {
    const lock = await client.query('SELECT coins FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!lock.rows[0]) throw new HttpError(404, 'user not found');
    const newBal = Number(lock.rows[0].coins) + amount;
    if (newBal < 0) throw new HttpError(400, 'insufficient coins');
    await client.query('UPDATE users SET coins = $1 WHERE id = $2', [newBal, userId]);
    await client.query(
      'INSERT INTO transactions (user_id, amount, type, reference_id, metadata) VALUES ($1, $2, $3, $4, $5)',
      [userId, amount, type, referenceId, metadata]
    );
    return newBal;
  });
}

export async function getBalance(userId) {
  const r = await query('SELECT coins FROM users WHERE id = $1', [userId]);
  return Number(r.rows[0]?.coins ?? 0);
}

export async function transferCoins(fromId, toId, amount, type = 'gift', referenceId = null) {
  if (amount <= 0) throw new HttpError(400, 'amount must be positive');
  if (fromId === toId) throw new HttpError(400, 'cannot transfer to self');
  return withTransaction(async (client) => {
    // Lock both rows in deterministic ID order to avoid the A→B / B→A
    // deadlock that PostgreSQL otherwise reports as "deadlock detected" and
    // refuses one transaction. Using a single SELECT … FOR UPDATE with an
    // ORDER BY is the standard recipe.
    const lock = await client.query(
      'SELECT id, coins FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
      [fromId, toId]
    );
    if (lock.rows.length < 2) throw new HttpError(404, 'user not found');
    const sender = lock.rows.find((r) => r.id === fromId);
    if (Number(sender.coins) < amount) throw new HttpError(400, 'insufficient coins');
    await client.query('UPDATE users SET coins = coins - $1 WHERE id = $2', [amount, fromId]);
    await client.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [amount, toId]);
    await client.query(
      'INSERT INTO transactions (user_id, amount, type, reference_id, metadata) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [fromId, -amount, type, referenceId, { to: toId }, toId, amount, type, referenceId, { from: fromId }]
    );
  });
}
