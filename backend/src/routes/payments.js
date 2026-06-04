import { Router } from 'express';
import { config } from '../config.js';
import { authRequired } from '../middleware/auth.js';
import { changeGoldCoins } from '../services/goldCoins.js';
import { recordDonation, MIN_DONATION_USD_CENTS } from '../services/donations.js';
import { verifyIAP } from '../services/iap.js';
import { query, withTransaction } from '../db.js';
import { logger } from '../logger.js';
import { hasIapFingerprint, iapFingerprint } from '../services/iapIdempotency.js';

export const paymentsRouter = Router();

const GOLD_BUNDLES_BY_ID = Object.fromEntries(config.shop.goldBundles.map((b) => [b.id, b]));
const PREMIUM_TIERS = {
  premium_month: { days: 30, priceUsd: config.premium.monthlyUsd, label: 'Premium 1 oy' },
  premium_quarter: { days: 90, priceUsd: config.premium.quarterlyUsd, label: 'Premium 3 oy' },
  premium_year: { days: 365, priceUsd: config.premium.yearlyUsd, label: 'Premium 1 yil' },
};

async function grantVerifiedPurchase({ userId, platform, productId, receipt }) {
  const fingerprint = iapFingerprint(receipt);
  if (await hasIapFingerprint(fingerprint)) return { duplicate: true };

  const grant = await verifyIAP(platform, productId, receipt);
  await withTransaction(async (client) => {
    if (grant.gold_coins > 0) {
      await client.query('UPDATE users SET gold_coins = gold_coins + $1 WHERE id = $2', [grant.gold_coins, userId]);
      await client.query(
        `INSERT INTO gold_transactions (user_id, amount, type, metadata)
         VALUES ($1, $2, 'iap', $3)`,
        [userId, grant.gold_coins, { platform, productId, iapFingerprint: fingerprint, priceUsd: grant.price_usd }]
      );
    }
    if (grant.premium_days > 0) {
      await client.query(
        `UPDATE users
            SET premium_until = GREATEST(COALESCE(premium_until, now()), now()) + ($1 || ' days')::interval
          WHERE id = $2`,
        [String(grant.premium_days), userId]
      );
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, metadata)
         VALUES ($1, 0, 'iap_premium', $2)`,
        [userId, { platform, productId, days: grant.premium_days, iapFingerprint: fingerprint }]
      );
    }
  });
  return { duplicate: false, grant };
}

paymentsRouter.post('/iap', authRequired, async (req, res, next) => {
  try {
    const { platform, productId, receipt } = req.body || {};
    if (!platform || !productId || !receipt) {
      return res.status(400).json({ error: 'platform, productId, and receipt are required' });
    }
    const result = await grantVerifiedPurchase({ userId: req.user.id, platform, productId, receipt });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('iap error:', err.message);
    next(err);
  }
});

let _stripe = null;
function stripeUsable() {
  return Boolean(config.stripe.secretKey)
    && !(config.env === 'production' && config.stripe.secretKey.startsWith('sk_test_'));
}

async function stripe() {
  if (_stripe) return _stripe;
  if (!stripeUsable()) {
    if (config.stripe.secretKey) {
      logger.warn('stripe disabled: test secret key is configured in production');
    }
    return null;
  }
  const mod = await import('stripe').catch(() => null);
  if (!mod) return null;
  const Stripe = mod.default || mod;
  _stripe = new Stripe(config.stripe.secretKey, { apiVersion: '2024-06-20' });
  return _stripe;
}

paymentsRouter.get('/config', (_req, res) => {
  const enabled = stripeUsable();
  res.json({
    ok: true,
    stripeConfigured: enabled,
    publicKeyConfigured: enabled && Boolean(config.stripe.publicKey),
    cardEnabled: enabled,
    premiumUsdConfigured: Object.values(PREMIUM_TIERS).some((tier) => Number.isFinite(Number(tier.priceUsd))),
    currency: 'usd',
  });
});

function checkoutOrigin(req) {
  const publicUrl = String(config.appStore.publicUrl || '').replace(/\/+$/, '');
  if (/^https?:\/\//i.test(publicUrl)) return publicUrl;
  const headerOrigin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (/^https?:\/\//i.test(headerOrigin)) return headerOrigin;
  return `${req.protocol}://${req.get('host')}`;
}

function safeHashPath(value, fallback) {
  const text = String(value || '');
  if (!text.startsWith('/#/')) return fallback;
  if (/[\r\n]/.test(text)) return fallback;
  return text.slice(0, 220);
}

function checkoutReturnUrl(req, type, status) {
  const defaultPath = type === 'donation' ? '/#/donations' : '/#/shop';
  const requested = status === 'success' ? req.body?.successPath : req.body?.cancelPath;
  const path = safeHashPath(requested, defaultPath);
  const glue = path.includes('?') ? '&' : '?';
  const sessionPart = status === 'success' ? '&session_id={CHECKOUT_SESSION_ID}' : '';
  return `${checkoutOrigin(req)}${path}${glue}payment=${status}${sessionPart}`;
}

async function fulfillPaidCheckoutSession(sess) {
  const userId = sess.metadata?.userId || sess.client_reference_id;
  const type = sess.metadata?.type;
  const productId = sess.metadata?.productId || '';
  if (!userId) throw Object.assign(new Error('checkout session has no user'), { status: 400 });
  if (!['gold_bundle', 'premium', 'donation'].includes(type)) {
    throw Object.assign(new Error('unknown checkout product type'), { status: 400 });
  }

  const dup = await query(
    `SELECT 1 FROM transactions WHERE metadata->>'stripeSessionId' = $1
     UNION ALL
     SELECT 1 FROM gold_transactions WHERE metadata->>'stripeSessionId' = $1
     UNION ALL
     SELECT 1 FROM donations WHERE payment_ref = $1
     UNION ALL
     SELECT 1 FROM stripe_payments WHERE stripe_session = $1
     LIMIT 1`,
    [sess.id]
  );
  if (dup.rows[0]) return { ok: true, fulfilled: false, duplicate: true, type, productId };

  const result = { ok: true, fulfilled: true, duplicate: false, type, productId };
  if (type === 'gold_bundle') {
    const bundle = GOLD_BUNDLES_BY_ID[productId];
    if (!bundle) throw Object.assign(new Error('unknown gold bundle'), { status: 400 });
    const goldCoins = await changeGoldCoins(userId, bundle.goldCoins, 'stripe_iap', null, {
      stripeSessionId: sess.id,
      productId,
      priceUsd: bundle.priceUsd,
    });
    result.awardedGoldCoins = bundle.goldCoins;
    result.goldCoins = goldCoins;
  } else if (type === 'premium') {
    const tier = PREMIUM_TIERS[productId];
    if (!tier) throw Object.assign(new Error('unknown premium tier'), { status: 400 });
    const premium = await query(
      `UPDATE users
          SET premium_until = GREATEST(COALESCE(premium_until, now()), now()) + ($1 || ' days')::interval
        WHERE id = $2
        RETURNING premium_until`,
      [String(tier.days), userId]
    );
    await query(
      `INSERT INTO transactions (user_id, amount, type, metadata)
       VALUES ($1, 0, 'premium', $2)`,
      [userId, { stripeSessionId: sess.id, productId, days: tier.days }]
    );
    result.premiumDays = tier.days;
    result.premiumUntil = premium.rows[0]?.premium_until;
  } else if (type === 'donation') {
    const amountUsdCents = Math.floor(Number(sess.metadata?.amountUsdCents || sess.amount_total || 0));
    await recordDonation({
      userId,
      displayName: sess.customer_details?.name || sess.customer_details?.email || 'Supporter',
      amountUsdCents,
      message: sess.metadata?.donationMessage || null,
      paymentRef: sess.id,
    });
    result.amountUsdCents = amountUsdCents;
  }

  try {
    await query(
      `INSERT INTO stripe_payments (user_id, stripe_session, product_type, product_id, amount_cents, status, metadata)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6)
       ON CONFLICT (stripe_session) DO NOTHING`,
      [userId, sess.id, type, productId || null, Math.floor(Number(sess.amount_total || sess.metadata?.amountUsdCents || 0)), sess.metadata || {}]
    );
  } catch (_) { /* legacy databases may not have this audit table */ }

  return result;
}

paymentsRouter.post('/create-checkout-session', authRequired, async (req, res) => {
  const s = await stripe();
  if (!s) return res.status(503).json({ error: 'payments not configured' });

  const { type, productId } = req.body || {};
  let amountCents;
  let label;
  if (type === 'gold_bundle') {
    const bundle = GOLD_BUNDLES_BY_ID[productId];
    if (!bundle) return res.status(400).json({ error: 'unknown gold bundle' });
    amountCents = Math.round(bundle.priceUsd * 100);
    label = `${bundle.goldCoins} Gold Coins`;
  } else if (type === 'premium') {
    const tier = PREMIUM_TIERS[productId];
    if (!tier) return res.status(400).json({ error: 'unknown premium tier' });
    if (!Number.isFinite(Number(tier.priceUsd))) {
      return res.status(409).json({ error: 'premium price is not approved yet' });
    }
    amountCents = Math.round(tier.priceUsd * 100);
    label = tier.label;
  } else if (type === 'donation') {
    amountCents = Math.floor(Number(req.body?.amountUsdCents || 0));
    if (!Number.isInteger(amountCents) || amountCents < MIN_DONATION_USD_CENTS) {
      return res.status(400).json({ error: `minimum donation is $${(MIN_DONATION_USD_CENTS / 100).toFixed(2)}` });
    }
    label = 'Durak Imperia donation';
  } else {
    return res.status(400).json({ error: 'unknown product type' });
  }

  const donationMessage = type === 'donation' ? String(req.body?.message || '').slice(0, 280) : '';

  try {
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: label } },
      }],
      success_url: checkoutReturnUrl(req, type, 'success') || config.stripe.successUrl,
      cancel_url: checkoutReturnUrl(req, type, 'cancel') || config.stripe.cancelUrl,
      client_reference_id: req.user.id,
      metadata: {
        userId: req.user.id, type, productId: productId || '',
        amountUsdCents: String(amountCents),
        donationMessage: donationMessage || '',
      },
    });
    res.json({ url: session.url, id: session.id });
  } catch (err) {
    logger.error('stripe session error:', err.message);
    res.status(500).json({ error: 'failed to create session' });
  }
});

paymentsRouter.post('/checkout/fulfill', authRequired, async (req, res) => {
  const s = await stripe();
  if (!s) return res.status(503).json({ error: 'payments not configured' });
  const sessionId = String(req.body?.sessionId || '').trim();
  if (!/^cs_(test|live)_/i.test(sessionId)) return res.status(400).json({ error: 'invalid checkout session' });
  try {
    const sess = await s.checkout.sessions.retrieve(sessionId);
    const ownerId = sess.metadata?.userId || sess.client_reference_id;
    if (ownerId !== req.user.id) return res.status(403).json({ error: 'checkout session belongs to another user' });
    if (sess.payment_status !== 'paid') return res.status(402).json({ error: 'checkout session is not paid yet' });
    const result = await fulfillPaidCheckoutSession(sess);
    res.json(result);
  } catch (err) {
    logger.error('stripe fulfill error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'failed to fulfill checkout session' });
  }
});

export async function stripeWebhookHandler(req, res) {
  const s = await stripe();
  if (!s) return res.status(503).end();
  if (!config.stripe.webhookSecret) {
    logger.error('stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ error: 'stripe webhook secret is not configured' });
  }

  let event;
  try {
    event = s.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
  } catch (err) {
    logger.warn('stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const sess = event.data.object;
    const userId = sess.metadata?.userId || sess.client_reference_id;
    if (!userId) return res.json({ received: true });

    try {
      await fulfillPaidCheckoutSession(sess);
    } catch (err) {
      logger.error('webhook fulfillment error:', err.message);
    }
  }

  res.json({ received: true });
}
