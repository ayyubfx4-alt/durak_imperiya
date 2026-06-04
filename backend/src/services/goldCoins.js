import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

/**
 * Atomically credit / debit a user's Gold Coin balance and append a ledger
 * entry. Mirrors `services/coins.js` for Durak Dollars.
 */
export async function changeGoldCoins(userId, amount, type, referenceId = null, metadata = null) {
  return withTransaction(async (client) => {
    const lock = await client.query('SELECT gold_coins FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!lock.rows[0]) throw new HttpError(404, 'user not found');
    const newBal = Number(lock.rows[0].gold_coins) + amount;
    if (newBal < 0) throw new HttpError(400, 'insufficient gold coins');
    await client.query('UPDATE users SET gold_coins = $1 WHERE id = $2', [newBal, userId]);
    const adminId = metadata?.adminId || null;
    const reason = metadata?.reason || null;
    await client.query(
      `INSERT INTO gold_transactions (user_id, amount, type, reference_id, metadata, admin_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, amount, type, referenceId, metadata, adminId, reason]
    );
    return newBal;
  });
}

/** Return the user's current Gold Coin balance. */
export async function getGoldBalance(userId) {
  const r = await query('SELECT gold_coins FROM users WHERE id = $1', [userId]);
  return Number(r.rows[0]?.gold_coins ?? 0);
}

/**
 * Convert Gold Coins → Durak Dollars at the bundle's fixed ratio. The two
 * ledgers stay in sync via a single transaction so a crash cannot leave a
 * user out-of-pocket.
 */
export async function convertGoldToDollars(userId, costGoldCoins, dollarsEquiv, bundleId) {
  return withTransaction(async (client) => {
    const lock = await client.query(
      'SELECT gold_coins, coins FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!lock.rows[0]) throw new HttpError(404, 'user not found');
    const gold = Number(lock.rows[0].gold_coins);
    if (gold < costGoldCoins) throw new HttpError(400, 'insufficient gold coins');
    const newGold = gold - costGoldCoins;
    const newDollars = Number(lock.rows[0].coins) + dollarsEquiv;
    await client.query(
      'UPDATE users SET gold_coins = $1, coins = $2 WHERE id = $3',
      [newGold, newDollars, userId]
    );
    await client.query(
      `INSERT INTO gold_transactions (user_id, amount, type, metadata)
       VALUES ($1, $2, 'convert_to_dollars', $3)`,
      [userId, -costGoldCoins, { bundleId, dollarsEquiv }]
    );
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, metadata)
       VALUES ($1, $2, 'gold_convert', $3)`,
      [userId, dollarsEquiv, { bundleId, costGoldCoins }]
    );
    return { goldCoins: newGold, coins: newDollars };
  });
}
