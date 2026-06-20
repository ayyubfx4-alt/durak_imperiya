// TOR §6 — donation tracking with the required fake donation pool.
import { withTransaction, query } from '../db.js';
import { logger } from '../logger.js';

async function dbReachable() {
  try { await query('SELECT 1'); return true; } catch (_) { return false; }
}

const FAKE_DONORS = [
  'Azizbek', 'Dilshod', 'Javohir', 'Sardor', 'Bekzod', 'Sherzod', 'Anvar', 'Jamshid',
  'Ibrohim', 'Shahzod', 'Nodir', 'Akmal', 'Diyor', 'Oybek', 'Sanjar', 'Ulugbek',
  'Malika', 'Madina', 'Sevara', 'Nilufar', 'Shahnoza', 'Gulnoza', 'Zarina', 'Dildora',
  'Ali', 'Vali', 'Hasan', 'Husan', 'Temur', 'Bobur', 'Rustam', 'Farrukh',
];

function fakeDonationRow(index) {
  const name = FAKE_DONORS[index % FAKE_DONORS.length];
  const suffix = Math.floor(index / FAKE_DONORS.length) ? ` ${Math.floor(index / FAKE_DONORS.length) + 1}` : '';
  const amount = [50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2500][index % 11];
  const hoursAgo = 100 - index;
  return {
    displayName: `${name}${suffix}`,
    amountUsdCents: amount,
    createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  };
}

export async function ensureFakeDonationsSeeded() {
  if (process.env.DISABLE_FAKE_DONATIONS === '1') return;
  if (!(await dbReachable())) return;
  try {
    const count = await query('SELECT COUNT(*)::int AS count FROM donations');
    const missing = Math.max(0, 100 - Number(count.rows[0]?.count || 0));
    for (let i = 0; i < missing; i++) {
      const row = fakeDonationRow(i);
      await query(
        `INSERT INTO donations (display_name, amount_usd_cents, message, is_fake, created_at)
         VALUES ($1, $2, NULL, TRUE, $3)`,
        [row.displayName, row.amountUsdCents, row.createdAt]
      );
    }
    if (missing) logger.info('seeded fake donations: %d', missing);
  } catch (err) {
    logger.warn('failed to seed fake donations: %s', err.message);
  }
}

const MIN_DONATION_CENTS = 50; // TOR §6: minimum $0.50.

export async function recordDonation({ userId, displayName, amountUsdCents, message, paymentRef }) {
  if (!Number.isInteger(amountUsdCents) || amountUsdCents < MIN_DONATION_CENTS) {
    const err = new Error(`minimum donation is $${(MIN_DONATION_CENTS / 100).toFixed(2)}`);
    err.statusCode = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO donations (user_id, display_name, amount_usd_cents, message, is_fake, payment_ref)
       VALUES ($1, $2, $3, $4, FALSE, $5)
       RETURNING id, user_id, display_name, amount_usd_cents, message, is_fake, created_at`,
      [userId || null, displayName, amountUsdCents, message || null, paymentRef || null]
    );
    if (userId) {
      await client.query(
        `UPDATE users
            SET total_donated_cents = COALESCE(total_donated_cents, 0) + $1,
                updated_at = now()
          WHERE id = $2`,
        [amountUsdCents, userId]
      );
    }
    await client.query(
      `DELETE FROM donations
        WHERE id = (
          SELECT id FROM donations
           WHERE is_fake = TRUE
           ORDER BY created_at ASC
           LIMIT 1
        )`
    );
    return { donation: ins.rows[0] };
  });
}

export async function topDonors(limit = 100, { includeFake = true } = {}) {
  const cap = Math.max(1, Math.min(200, Math.floor(limit)));
  const where = includeFake ? '' : 'WHERE is_fake = FALSE';
  const r = await query(
    `SELECT id, user_id, display_name, amount_usd_cents, message, is_fake, created_at
       FROM donations
      ${where}
      ORDER BY is_fake ASC, amount_usd_cents DESC, created_at DESC
      LIMIT $1`,
    [cap]
  );
  return r.rows;
}

export const MIN_DONATION_USD_CENTS = MIN_DONATION_CENTS;
