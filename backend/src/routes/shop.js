import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { withTransaction, query } from '../db.js';
import { changeCoins } from '../services/coins.js';
import { changeGoldCoins, convertGoldToDollars } from '../services/goldCoins.js';
import { GOLD_BUNDLES, DOLLAR_BUNDLES, config } from '../config.js';
import { PACK_BY_ID } from '../data/emojiPacks.js';
import { SKIN_BY_ID } from '../data/cardSkins.js';
import { PROFILE_FRAME_BY_ID } from '../data/profileFrames.js';
import { isExclusiveItem, userQualifiesForExclusive, REFERRAL_GENERATIONS_FOR_EXCLUSIVE } from './inventory.js';
import { verifyIAP } from '../services/iap.js';
import { hasIapFingerprint, iapFingerprint } from '../services/iapIdempotency.js';
import {
  adminCardSkin,
  adminEmojiPack,
  adminProfileFrame,
  applyPriceOverride,
  getEnabledAdminItem,
  getPriceOverrides,
} from '../services/adminCatalog.js';

// Real-money grants are only safe when backed by a verified IAP receipt
// (see `/verify-iap`). The legacy `/buy/coin-bundle` and `/buy/gold-bundle`
// endpoints existed for dev testing where receipts aren't available; we
// gate them with this flag so production deployments never expose a free
// money tap. Set `ALLOW_DEV_PURCHASES=1` only in non-production envs.
const ALLOW_DEV_PURCHASES = process.env.ALLOW_DEV_PURCHASES === '1' && config.env !== 'production';

export const shopRouter = Router();

/**
 * Legacy coin-bundle catalog (kept for backward compatibility with v3 clients
 * that may still hit the old endpoint). New clients should use
 * `/shop/gold-bundles` for premium currency and `/shop/dollar-bundles` to
 * exchange Gold Coin → Durak Dollars.
 */
const COIN_BUNDLES = [
  { id: 'bundle_starter', coins: 500, priceUsd: 0.99 },
  { id: 'bundle_basic', coins: 1500, priceUsd: 2.99 },
  { id: 'bundle_pro', coins: 6000, priceUsd: 9.99 },
  { id: 'bundle_whale', coins: 35000, priceUsd: 49.99 },
];

const PREMIUM_TIERS = [
  { id: 'premium_month', name: 'Premium 1 oy', days: 30, priceUsd: config.premium.monthlyUsd, priceGoldCoins: 300 },
  { id: 'premium_quarter', name: 'Premium 3 oy', days: 90, priceUsd: config.premium.quarterlyUsd, priceGoldCoins: 750 },
  { id: 'premium_year', name: 'Premium 1 yil', days: 365, priceUsd: config.premium.yearlyUsd, priceGoldCoins: 2500 },
];

const EMOJI_PACK_PRICE_COINS = { common: 200, uncommon: 500, rare: 1500, legendary: 5000 };
const SKIN_PRICE_COINS = { common: 0, uncommon: 800, rare: 2500, epic: 6000, legendary: 15000 };
const DOLLARS_PER_GOLD = 10000 / 55;
const priceGoldFromDollars = (dollars) => Math.max(0, Math.ceil(Number(dollars || 0) / DOLLARS_PER_GOLD));

async function resolveEmojiPack(packId) {
  const staticPack = PACK_BY_ID[packId];
  if (staticPack) {
    const overrides = await getPriceOverrides();
    const priceDollars = EMOJI_PACK_PRICE_COINS[staticPack.rarity] ?? 1000;
    return {
      ...applyPriceOverride({
        ...staticPack,
        price: priceDollars,
        priceGold: Number(staticPack.priceGold ?? priceGoldFromDollars(priceDollars)),
      }, 'emoji_pack', staticPack.id, overrides),
      adminCreated: false,
    };
  }
  const adminItem = await getEnabledAdminItem('emoji_pack', packId);
  return adminItem ? adminEmojiPack(adminItem, ':)') : null;
}

async function resolveCardSkin(skinId) {
  const staticSkin = SKIN_BY_ID[skinId];
  if (staticSkin) {
    const overrides = await getPriceOverrides();
    const priceDollars = staticSkin.priceCoins ?? SKIN_PRICE_COINS[staticSkin.rarity] ?? 1000;
    return {
      ...applyPriceOverride({
        ...staticSkin,
        price: priceDollars,
        priceGold: priceGoldFromDollars(priceDollars),
      }, 'card_skin', staticSkin.id, overrides),
      adminCreated: false,
    };
  }
  const adminItem = await getEnabledAdminItem('card_skin', skinId);
  return adminItem ? adminCardSkin(adminItem, priceGoldFromDollars) : null;
}

async function resolveProfileFrame(frameId) {
  const staticFrame = PROFILE_FRAME_BY_ID[frameId];
  if (staticFrame) {
    if (staticFrame.barabanOnly) return null;
    const overrides = await getPriceOverrides();
    return applyPriceOverride(staticFrame, 'avatar_frame', staticFrame.id, overrides);
  }
  const adminItem = await getEnabledAdminItem('avatar_frame', frameId);
  return adminItem ? adminProfileFrame(adminItem) : null;
}

shopRouter.get('/coin-bundles', (_req, res) => res.json(COIN_BUNDLES));
shopRouter.get('/premium-tiers', (_req, res) => res.json(PREMIUM_TIERS));
// TOR §4.2: Gold Coin & Dollar bundles.
shopRouter.get('/gold-bundles', (_req, res) => res.json(GOLD_BUNDLES));
shopRouter.get('/dollar-bundles', (_req, res) => res.json(DOLLAR_BUNDLES));

shopRouter.post('/buy/emoji-pack', authRequired, async (req, res, next) => {
  try {
    const pack = await resolveEmojiPack(req.body?.packId);
    if (!pack) return res.status(404).json({ error: 'pack not found' });
    if (pack.premium) {
      const u = await query('SELECT premium_until FROM users WHERE id = $1', [req.user.id]);
      const isPremium = u.rows[0]?.premium_until && new Date(u.rows[0].premium_until) > new Date();
      if (!isPremium) return res.status(403).json({ error: 'premium-only pack' });
    }
    // TOR §7: exclusive packs require a deep referral tree.
    if (isExclusiveItem('emoji_pack', pack.id)) {
      const ok = await userQualifiesForExclusive(req.user.id);
      if (!ok) return res.status(403).json({ error: `requires ${REFERRAL_GENERATIONS_FOR_EXCLUSIVE}-generation referral tree` });
    }
    const priceDollars = Number(pack.price ?? EMOJI_PACK_PRICE_COINS[pack.rarity] ?? 1000);
    const priceGold = Number(pack.priceGold ?? priceGoldFromDollars(priceDollars));
    let goldCoins = 0;
    let alreadyOwned = false;
    await withTransaction(async (client) => {
      const lock = await client.query('SELECT gold_coins FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      const owned = await client.query(
        `SELECT 1
           FROM inventory
          WHERE user_id = $1
            AND (
              (item_type = 'emoji_pack' AND item_id = $2)
              OR (item_type = 'emoji' AND item_id LIKE $3)
            )
          LIMIT 1`,
        [req.user.id, pack.id, `${pack.id}:%`]
      );
      if (owned.rows[0]) {
        alreadyOwned = true;
        goldCoins = Number(lock.rows[0]?.gold_coins || 0);
        return;
      }
      if (Number(lock.rows[0].gold_coins) < priceGold) throw Object.assign(new Error('Gold Coin yetarli emas'), { status: 400 });
      const updated = await client.query('UPDATE users SET gold_coins = gold_coins - $1 WHERE id = $2 RETURNING gold_coins', [priceGold, req.user.id]);
      goldCoins = Number(updated.rows[0]?.gold_coins || 0);
      await client.query(
        "INSERT INTO gold_transactions (user_id, amount, type, metadata) VALUES ($1, $2, 'purchase', $3)",
        [req.user.id, -priceGold, { itemType: 'emoji_pack', itemId: pack.id, priceDollars, priceGold }]
      );
      // grant the whole pack
      await client.query(
        `INSERT INTO inventory (user_id, item_type, item_id, quantity)
         VALUES ($1, 'emoji_pack', $2, 1)
         ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET quantity = GREATEST(inventory.quantity, 1)`,
        [req.user.id, pack.id]
      );
      for (const e of (pack.emoji || [{ id: 'main', value: pack.icon || ':)' }])) {
        await client.query(
          `INSERT INTO inventory (user_id, item_type, item_id, quantity)
           VALUES ($1, 'emoji', $2, 1)
           ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET quantity = inventory.quantity + 1`,
          [req.user.id, `${pack.id}:${e.id}`]
        );
      }
    });
    res.json({ ok: true, packId: pack.id, spentGold: alreadyOwned ? 0 : priceGold, goldCoins, alreadyOwned });
  } catch (err) { next(err); }
});

shopRouter.post('/buy/card-skin', authRequired, async (req, res, next) => {
  try {
    const skin = await resolveCardSkin(req.body?.skinId);
    if (!skin) return res.status(404).json({ error: 'skin not found' });
    if (skin.premium) {
      const u = await query('SELECT premium_until FROM users WHERE id = $1', [req.user.id]);
      const isPremium = u.rows[0]?.premium_until && new Date(u.rows[0].premium_until) > new Date();
      if (!isPremium) return res.status(403).json({ error: 'premium-only skin' });
    }
    if (isExclusiveItem('card_skin', skin.id)) {
      const ok = await userQualifiesForExclusive(req.user.id);
      if (!ok) return res.status(403).json({ error: `requires ${REFERRAL_GENERATIONS_FOR_EXCLUSIVE}-generation referral tree` });
    }
    const priceDollars = Number(skin.priceCoins ?? skin.price ?? SKIN_PRICE_COINS[skin.rarity] ?? 1000);
    const priceGold = Number(skin.priceGold ?? priceGoldFromDollars(priceDollars));
    if (priceGold === 0) return res.status(400).json({ error: 'this skin is free / default' });
    let goldCoins = 0;
    let alreadyOwned = false;
    await withTransaction(async (client) => {
      const lock = await client.query('SELECT gold_coins FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      const owned = await client.query(
        `SELECT 1 FROM inventory WHERE user_id = $1 AND item_type = 'card_skin' AND item_id = $2`,
        [req.user.id, skin.id]
      );
      if (owned.rows[0]) {
        alreadyOwned = true;
        const selected = await client.query(
          'UPDATE users SET selected_skin = $1 WHERE id = $2 RETURNING gold_coins',
          [skin.id, req.user.id]
        );
        goldCoins = Number(selected.rows[0]?.gold_coins || lock.rows[0]?.gold_coins || 0);
        return;
      }
      if (Number(lock.rows[0].gold_coins) < priceGold) throw Object.assign(new Error('Gold Coin yetarli emas'), { status: 400 });
      const updated = await client.query(
        'UPDATE users SET gold_coins = gold_coins - $1, selected_skin = $2 WHERE id = $3 RETURNING gold_coins',
        [priceGold, skin.id, req.user.id]
      );
      goldCoins = Number(updated.rows[0]?.gold_coins || 0);
      await client.query(
        "INSERT INTO gold_transactions (user_id, amount, type, metadata) VALUES ($1, $2, 'purchase', $3)",
        [req.user.id, -priceGold, { itemType: 'card_skin', itemId: skin.id, priceDollars }]
      );
      await client.query(
        `INSERT INTO inventory (user_id, item_type, item_id, quantity) VALUES ($1, 'card_skin', $2, 1)
         ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
        [req.user.id, skin.id]
      );
    });
    res.json({ ok: true, skinId: skin.id, selectedSkin: skin.id, spentGold: alreadyOwned ? 0 : priceGold, goldCoins, alreadyOwned });
  } catch (err) { next(err); }
});

shopRouter.post('/buy/profile-frame', authRequired, async (req, res, next) => {
  try {
    const frame = await resolveProfileFrame(req.body?.frameId);
    if (!frame) return res.status(404).json({ error: 'frame not found' });
    let goldCoins = 0;
    let alreadyOwned = false;
    await withTransaction(async (client) => {
      const lock = await client.query('SELECT gold_coins FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      const already = await client.query(
        `SELECT 1 FROM inventory WHERE user_id = $1 AND item_type IN ('avatar_frame', 'frame') AND item_id = $2`,
        [req.user.id, frame.id]
      );
      if (already.rows[0]) {
        alreadyOwned = true;
        const updated = await client.query(
          'UPDATE users SET selected_avatar_frame = $1 WHERE id = $2 RETURNING gold_coins',
          [frame.id, req.user.id]
        );
        goldCoins = Number(updated.rows[0]?.gold_coins || 0);
      } else {
        if (Number(lock.rows[0]?.gold_coins || 0) < Number(frame.priceGold || 0)) {
          throw Object.assign(new Error('Gold Coin yetarli emas'), { status: 400 });
        }
        const updated = await client.query(
          'UPDATE users SET gold_coins = gold_coins - $1, selected_avatar_frame = $2 WHERE id = $3 RETURNING gold_coins',
          [frame.priceGold, frame.id, req.user.id]
        );
        goldCoins = Number(updated.rows[0]?.gold_coins || 0);
        await client.query(
          "INSERT INTO gold_transactions (user_id, amount, type, metadata) VALUES ($1, $2, 'purchase', $3)",
          [req.user.id, -frame.priceGold, { itemType: 'avatar_frame', itemId: frame.id }]
        );
        await client.query(
          `INSERT INTO inventory (user_id, item_type, item_id, quantity)
           VALUES ($1, 'avatar_frame', $2, 1)
           ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
          [req.user.id, frame.id]
        );
      }
    });
    res.json({ ok: true, frameId: frame.id, spent: alreadyOwned ? 0 : frame.priceGold, goldCoins, selectedAvatarFrame: frame.id, alreadyOwned });
  } catch (err) { next(err); }
});

/**
 * Legacy coin-bundle endpoint (v3). Dev only — production must route the
 * purchase through `/verify-iap` so we have a verified Apple/Google receipt
 * before crediting. Gated behind ALLOW_DEV_PURCHASES.
 */
shopRouter.post('/buy/coin-bundle', authRequired, async (req, res, next) => {
  try {
    if (!ALLOW_DEV_PURCHASES) return res.status(403).json({ error: 'real purchases must go through /verify-iap' });
    const bundle = COIN_BUNDLES.find((b) => b.id === req.body?.bundleId);
    if (!bundle) return res.status(404).json({ error: 'bundle not found' });
    const bal = await changeCoins(req.user.id, bundle.coins, 'purchase', null, { bundleId: bundle.id, priceUsd: bundle.priceUsd, dev: true });
    res.json({ ok: true, awarded: bundle.coins, coins: bal });
  } catch (err) { next(err); }
});

/**
 * TOR §4.2 — buy a Gold Coin bundle. Dev only — production must route the
 * purchase through `/verify-iap` with a real receipt; otherwise this is a
 * free Gold Coin tap.
 */
shopRouter.post('/buy/gold-bundle', authRequired, async (req, res, next) => {
  try {
    if (!ALLOW_DEV_PURCHASES) return res.status(403).json({ error: 'real purchases must go through /verify-iap' });
    const bundle = GOLD_BUNDLES.find((b) => b.id === req.body?.bundleId);
    if (!bundle) return res.status(404).json({ error: 'gold bundle not found' });
    const bal = await changeGoldCoins(req.user.id, bundle.goldCoins, 'iap', null, {
      bundleId: bundle.id,
      priceUsd: bundle.priceUsd,
      dev: true,
    });
    res.json({ ok: true, awarded: bundle.goldCoins, goldCoins: bal });
  } catch (err) { next(err); }
});

/**
 * TOR §4.2 — spend Gold Coins to receive Durak Dollars at the published
 * conversion ratios. The exchange is atomic.
 */
shopRouter.post('/buy/dollar-bundle', authRequired, async (req, res, next) => {
  try {
    const bundle = DOLLAR_BUNDLES.find((b) => b.id === req.body?.bundleId);
    if (!bundle) return res.status(404).json({ error: 'dollar bundle not found' });
    const balances = await convertGoldToDollars(
      req.user.id,
      bundle.costGoldCoins,
      bundle.dollars,
      bundle.id
    );
    res.json({ ok: true, ...balances, awarded: bundle.dollars });
  } catch (err) { next(err); }
});

shopRouter.post('/buy/premium', authRequired, async (req, res, next) => {
  try {
    const tier = PREMIUM_TIERS.find((p) => p.id === req.body?.tierId);
    if (!tier) return res.status(404).json({ error: 'tier not found' });
    // Premium must be paid for. Accepted payment paths:
    //  - `payWithGold = true` → debit Gold Coins (atomic; throws on shortfall).
    //  - Real-money flow      → client routes through `/verify-iap` instead
    //                            of this endpoint with productId premium_30 / 90 / 365.
    // Block the no-payment fallback so a logged-in user can't extend premium
    // for free by hitting the endpoint repeatedly.
    let goldCoins = null;
    if (!req.body?.payWithGold) {
      if (!ALLOW_DEV_PURCHASES) {
        return res.status(400).json({ error: 'premium requires Gold Coin payment or a verified IAP receipt (/verify-iap)' });
      }
      // Dev-only: allow free grant for QA.
    } else {
      if (!tier.priceGoldCoins) return res.status(400).json({ error: 'tier has no gold price' });
      goldCoins = await changeGoldCoins(req.user.id, -tier.priceGoldCoins, 'premium', null, { tierId: tier.id, days: tier.days });
    }
    const premium = await query(
      `UPDATE users SET premium_until = GREATEST(coalesce(premium_until, now()), now()) + ($1 || ' days')::interval
         WHERE id = $2 RETURNING premium_until`,
      [String(tier.days), req.user.id]
    );
    await query(
      "INSERT INTO transactions (user_id, amount, type, metadata) VALUES ($1, 0, 'premium', $2)",
      [req.user.id, { tierId: tier.id, days: tier.days, priceUsd: tier.priceUsd, payWithGold: !!req.body?.payWithGold }]
    );
    res.json({ ok: true, tierId: tier.id, goldCoins, premium_until: premium.rows[0]?.premium_until });
  } catch (err) { next(err); }
});

// ── IAP receipt verification (Google Play & App Store) ────────────────────
// `verifyIAP` is imported at the top of the file alongside the rest of the
// shop dependencies.

/**
 * POST /api/shop/verify-iap
 * Body: { platform: "android"|"ios", productId, receipt }
 * Verifies the receipt with the store, then atomically credits coins or premium.
 * Idempotent: the same receipt can be submitted multiple times safely.
 */
shopRouter.post('/verify-iap', authRequired, async (req, res, next) => {
  try {
    const { platform, productId, receipt } = req.body || {};
    if (!platform || !productId || !receipt) {
      return res.status(400).json({ error: 'platform, productId and receipt are required' });
    }

    // Idempotency is global per store receipt. It must not include userId,
    // otherwise one real receipt can be replayed across multiple accounts.
    const fingerprint = iapFingerprint(receipt);
    if (await hasIapFingerprint(fingerprint)) {
      return res.json({ ok: true, duplicate: true });
    }

    // Verify with store — throws HttpError on failure
    const grant = await verifyIAP(platform, productId, receipt);

    await withTransaction(async (client) => {
      if (grant.coins > 0) {
        await client.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [grant.coins, req.user.id]);
        await client.query(
          "INSERT INTO transactions (user_id, amount, type, metadata) VALUES ($1, $2, 'iap', $3)",
          [req.user.id, grant.coins, { platform, productId, iapFingerprint: fingerprint }]
        );
      }
      if (grant.gold_coins > 0) {
        await client.query('UPDATE users SET gold_coins = gold_coins + $1 WHERE id = $2', [grant.gold_coins, req.user.id]);
        await client.query(
          "INSERT INTO gold_transactions (user_id, amount, type, metadata) VALUES ($1, $2, 'iap', $3)",
          [req.user.id, grant.gold_coins, { platform, productId, iapFingerprint: fingerprint }]
        );
      }
      if (grant.premium_days > 0) {
        await client.query(
          `UPDATE users SET premium_until = GREATEST(coalesce(premium_until, now()), now()) + ($1 || ' days')::interval
             WHERE id = $2`,
          [String(grant.premium_days), req.user.id]
        );
        await client.query(
          "INSERT INTO transactions (user_id, amount, type, metadata) VALUES ($1, 0, 'iap_premium', $2)",
          [req.user.id, { platform, productId, days: grant.premium_days, iapFingerprint: fingerprint }]
        );
      }
    });

    res.json({ ok: true, credited: grant });
  } catch (err) { next(err); }
});
