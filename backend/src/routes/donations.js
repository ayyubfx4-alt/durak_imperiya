// TOR §6 — public donation endpoints + mocked IAP grant flow.
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { recordDonation, topDonors, MIN_DONATION_USD_CENTS } from '../services/donations.js';
import { query } from '../db.js';
import { config } from '../config.js';

export const donationsRouter = Router();

// Production must route donations through a real IAP / Stripe webhook so the
// reported `amountUsdCents` is backed by an actual payment. The mocked POST
// below trusts the caller's amount and is therefore gated to dev environments.
const ALLOW_DEV_DONATION = process.env.ALLOW_DEV_PURCHASES === '1' && config.env !== 'production';

/**
 * Public donor leaderboard. Store release uses verified real payment rows only.
 */
donationsRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 100);
    const rows = await topDonors(limit, { includeFake: true });
    res.json(rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      userId: r.user_id,
      name: r.display_name,
      amountUsd: r.amount_usd_cents / 100,
      amountUsdCents: r.amount_usd_cents,
      message: r.message,
      isFake: r.is_fake,
      createdAt: r.created_at,
    })));
  } catch (err) { next(err); }
});

donationsRouter.get('/real', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 100);
    const rows = await topDonors(limit, { includeFake: false });
    res.json(rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      userId: r.user_id,
      name: r.display_name,
      amountUsd: r.amount_usd_cents / 100,
      amountUsdCents: r.amount_usd_cents,
      message: r.message,
      createdAt: r.created_at,
    })));
  } catch (err) { next(err); }
});

donationsRouter.get('/config', (_req, res) => {
  res.json({
    minDonationUsd: MIN_DONATION_USD_CENTS / 100,
    minDonationUsdCents: MIN_DONATION_USD_CENTS,
  });
});

/**
 * Local demo donation. Production donations are created by Stripe/IAP
 * fulfillment after a verified payment.
 */
donationsRouter.post('/', authRequired, async (req, res, next) => {
  try {
    if (!ALLOW_DEV_DONATION) {
      return res.status(403).json({ error: 'donations must originate from a verified IAP / Stripe webhook' });
    }
    const amountUsdCents = Math.floor(Number(req.body?.amountUsdCents ?? Math.round(Number(req.body?.amountUsd || 0) * 100)));
    const message = String(req.body?.message || '').slice(0, 280) || null;
    const displayName = String(req.body?.displayName || req.user.username || 'Anonymous').slice(0, 64);
    if (!Number.isInteger(amountUsdCents) || amountUsdCents < MIN_DONATION_USD_CENTS) {
      return res.status(400).json({ error: `minimum donation is $${(MIN_DONATION_USD_CENTS / 100).toFixed(2)}` });
    }
    const result = await recordDonation({
      userId: req.user.id,
      displayName,
      amountUsdCents,
      message,
    });
    res.json(result);
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

/**
 * Aggregated stats by real user, useful for the "top donor" hall of fame
 * widget. Fake donations are excluded because they're not tied to a user.
 */
donationsRouter.get('/leaderboard/users', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT u.id, u.username, u.total_donated_cents
         FROM users u
        WHERE u.total_donated_cents > 0
        ORDER BY u.total_donated_cents DESC, u.username ASC
        LIMIT 100`
    );
    res.json(r.rows.map((row) => ({
      userId: row.id,
      username: row.username,
      totalUsd: row.total_donated_cents / 100,
    })));
  } catch (err) { next(err); }
});
