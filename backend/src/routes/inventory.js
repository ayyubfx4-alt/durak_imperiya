import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { query, withTransaction } from '../db.js';
import { EMOJI_PACKS, PACK_BY_ID } from '../data/emojiPacks.js';
import { CARD_SKINS, SKIN_BY_ID } from '../data/cardSkins.js';
import { PROFILE_FRAMES, PROFILE_FRAME_BY_ID } from '../data/profileFrames.js';
import { isExclusiveItem, REFERRAL_GENERATIONS_FOR_EXCLUSIVE } from '../data/exclusiveItems.js';
import {
  adminCardSkin,
  adminEmojiPack,
  adminProfileFrame,
  applyPriceOverride,
  getEnabledAdminItem,
  getEnabledAdminItems,
  getPriceOverrides,
} from '../services/adminCatalog.js';
import { cardSkinGiftableCopies } from '../services/giftEligibility.js';
export { isExclusiveItem, REFERRAL_GENERATIONS_FOR_EXCLUSIVE };

export const inventoryRouter = Router();

inventoryRouter.get('/me', authRequired, async (req, res, next) => {
  try {
    const r = await query(
      'SELECT item_type, item_id, quantity, obtained_at FROM inventory WHERE user_id = $1',
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

const EMOJI_PACK_PRICE = { common: 200, uncommon: 500, rare: 1500, legendary: 5000 };
const SKIN_PRICE = { common: 0, uncommon: 800, rare: 2500, epic: 6000, legendary: 15000 };
const DOLLARS_PER_GOLD = 10000 / 55;
const priceGoldFromDollars = (dollars) => Math.max(0, Math.ceil(Number(dollars || 0) / DOLLARS_PER_GOLD));
const CHESTS = {
  bronze: { id: 'bronze', name: 'Bronze quti', priceGold: 0, weights: { common: 70, rare: 24, epic: 5, legendary: 1 } },
  silver: { id: 'silver', name: 'Silver quti', priceGold: 100, weights: { common: 45, rare: 35, epic: 15, legendary: 5 } },
  gold: { id: 'gold', name: 'Gold quti', priceGold: 300, weights: { common: 20, rare: 35, epic: 30, legendary: 15 } },
  diamond: { id: 'diamond', name: 'Diamond quti', priceGold: 590, weights: { common: 5, rare: 20, epic: 40, legendary: 35 } },
};
const PACK_ICONS = ['🐺','🐱','🦸','🐉','🏴‍☠️','🥷','⚔️','🤖','🌳','🧜','🧛','🐲','💾','🤠','👽','✨','🏹','🦊','🐼','🐯','🐲','⛵','⚙️','🪄','🔥','❄️','🏜️','🐙','☁️','🌋','🌑','💡','🌲','🏙️','🏝️','⛰️','🦊','🐶','🎤','🎧','🎌','🦄','🛡️','🗾','⚓','🏛️','🌞','🦜','🐳','🐰'];



export async function userQualifiesForExclusive(userId) {
  try {
    const r = await query(
      'SELECT COALESCE(MAX(level), 0)::int AS depth FROM referrals WHERE referrer_id = $1',
      [userId]
    );
    return (r.rows[0]?.depth || 0) >= REFERRAL_GENERATIONS_FOR_EXCLUSIVE;
  } catch (_) {
    return false;
  }
}

inventoryRouter.get('/catalog', async (_req, res, next) => {
  try {
    const [overrides, adminItems] = await Promise.all([
      getPriceOverrides(),
      getEnabledAdminItems(),
    ]);
    const adminByType = (type) => adminItems.filter((item) => item.item_type === type);
  res.json({
    emojiPacks: [
      ...EMOJI_PACKS.map(({ id, name, rarity, premium, priceGold, preview, features }, i) => applyPriceOverride({
      id,
      name,
      rarity,
      premium,
      icon: PACK_ICONS[i] || '😀',
      price: EMOJI_PACK_PRICE[rarity] || 1000,
      priceGold: Number(priceGold ?? priceGoldFromDollars(EMOJI_PACK_PRICE[rarity] || 1000)),
      preview: Array.isArray(preview) ? preview : [],
      features: Array.isArray(features) ? features : [],
      exclusive: isExclusiveItem('emoji_pack', id),
      requiredReferralGenerations: isExclusiveItem('emoji_pack', id) ? REFERRAL_GENERATIONS_FOR_EXCLUSIVE : 0,
      }, 'emoji_pack', id, overrides)),
      ...adminByType('emoji_pack').map((row) => adminEmojiPack(row, PACK_ICONS[0] || ':)')),
    ],
    cardSkins: [
      ...CARD_SKINS.map((s) => applyPriceOverride({
      ...s,
      price: s.priceCoins ?? SKIN_PRICE[s.rarity] ?? 1000,
      priceGold: priceGoldFromDollars(s.priceCoins ?? SKIN_PRICE[s.rarity] ?? 1000),
      randomOnly: s.collectionType === 'random',
      paid: s.collectionType === 'paid',
      exclusive: isExclusiveItem('card_skin', s.id),
      requiredReferralGenerations: isExclusiveItem('card_skin', s.id) ? REFERRAL_GENERATIONS_FOR_EXCLUSIVE : 0,
      }, 'card_skin', s.id, overrides)),
      ...adminByType('card_skin').map((row) => adminCardSkin(row, priceGoldFromDollars)),
    ],
    profileFrames: [
      ...PROFILE_FRAMES.filter((frame) => !frame.barabanOnly).map((frame) => applyPriceOverride(frame, 'avatar_frame', frame.id, overrides)),
      ...adminByType('avatar_frame').map(adminProfileFrame),
    ],
    cardChests: Object.values(CHESTS),
  });
  } catch (err) { next(err); }
});

inventoryRouter.get('/card-collection', authRequired, async (req, res, next) => {
  try {
    const [me, inv, adminSkins] = await Promise.all([
      query('SELECT selected_skin, gold_coins FROM users WHERE id = $1', [req.user.id]),
      query("SELECT item_id, quantity, obtained_at FROM inventory WHERE user_id = $1 AND item_type = 'card_skin'", [req.user.id]),
      getEnabledAdminItems('card_skin'),
    ]);
    const ownedMap = new Map(inv.rows.map((r) => [r.item_id, Number(r.quantity || 0)]));
    const skins = [
      ...CARD_SKINS,
      ...adminSkins.map((row) => adminCardSkin(row, priceGoldFromDollars)),
    ];
    res.json({
      selectedSkin: me.rows[0]?.selected_skin || 'default',
      goldCoins: Number(me.rows[0]?.gold_coins || 0),
      owned: inv.rows,
      chests: Object.values(CHESTS),
      skins: skins.map((s) => ({
        ...s,
        quantity: s.id === 'default' ? Math.max(1, ownedMap.get(s.id) || 1) : (ownedMap.get(s.id) || 0),
        owned: s.id === 'default' || (ownedMap.get(s.id) || 0) > 0,
        selected: (me.rows[0]?.selected_skin || 'default') === s.id,
        price: s.priceCoins ?? SKIN_PRICE[s.rarity] ?? 1000,
        priceGold: priceGoldFromDollars(s.priceCoins ?? SKIN_PRICE[s.rarity] ?? 1000),
        randomOnly: s.collectionType === 'random',
        paid: s.collectionType === 'paid',
      })),
    });
  } catch (err) { next(err); }
});

inventoryRouter.post('/card-collection/open-box', authRequired, async (req, res, next) => {
  try {
    const box = CHESTS[String(req.body?.boxType || 'bronze')];
    if (!box) return res.status(404).json({ error: 'box not found' });
    let result = null;
    await withTransaction(async (client) => {
      const user = await client.query('SELECT gold_coins FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      if (!user.rows[0]) throw Object.assign(new Error('user not found'), { status: 404 });
      if (Number(user.rows[0].gold_coins || 0) < box.priceGold) throw Object.assign(new Error('Gold Coin yetarli emas'), { status: 400 });
      if (box.priceGold > 0) {
        await client.query('UPDATE users SET gold_coins = gold_coins - $1 WHERE id = $2', [box.priceGold, req.user.id]);
        await client.query(
          "INSERT INTO gold_transactions (user_id, amount, type, metadata) VALUES ($1, $2, 'card_box', $3)",
          [req.user.id, -box.priceGold, { boxType: box.id }]
        );
      }
      const skin = rollRandomSkin(box);
      const quantity = rollDropQuantity(box);
      await client.query(
        `INSERT INTO inventory (user_id, item_type, item_id, quantity)
         VALUES ($1, 'card_skin', $2, $3)
         ON CONFLICT (user_id, item_type, item_id)
         DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity`,
        [req.user.id, skin.id, quantity]
      );
      const updated = await client.query('UPDATE users SET selected_skin = $1 WHERE id = $2 RETURNING gold_coins, selected_skin', [skin.id, req.user.id]);
      result = { ok: true, box: box.id, skin, quantity, goldCoins: Number(updated.rows[0]?.gold_coins || 0), selectedSkin: updated.rows[0]?.selected_skin };
    });
    res.json(result);
  } catch (err) { next(err); }
});

function rollRandomSkin(box) {
  const imagePool = CARD_SKINS.filter((s) => s.collectionType === 'random' && s.image);
  const randomPool = CARD_SKINS.filter((s) => s.collectionType === 'random');
  const premiumPool = CARD_SKINS.filter((s) => s.id !== 'default' && s.id !== 'classic_gold');
  const pool = imagePool.length ? imagePool : (randomPool.length ? randomPool : premiumPool);
  const roll = Math.random() * Object.values(box.weights).reduce((a, b) => a + b, 0);
  let acc = 0;
  let rarity = 'common';
  for (const [key, weight] of Object.entries(box.weights)) {
    acc += weight;
    if (roll <= acc) { rarity = key; break; }
  }
  const candidates = pool.filter((s) => s.rarity === rarity);
  const list = candidates.length ? candidates : pool;
  if (!list.length) return SKIN_BY_ID.default;
  return list[Math.floor(Math.random() * list.length)];
}

function rollDropQuantity(box) {
  const price = Number(box?.priceGold || 0);
  const roll = Math.random();
  if (price >= 500) {
    if (roll < 0.18) return 3;
    if (roll < 0.48) return 2;
    return 1;
  }
  if (price >= 250) {
    if (roll < 0.10) return 3;
    if (roll < 0.34) return 2;
    return 1;
  }
  if (roll < 0.06) return 3;
  if (roll < 0.22) return 2;
  return 1;
}

inventoryRouter.get('/catalog/emoji-pack/:id', (req, res) => {
  const pack = PACK_BY_ID[req.params.id];
  if (!pack) return res.status(404).json({ error: 'not found' });
  res.json(pack);
});

inventoryRouter.get('/catalog/card-skin/:id', async (req, res, next) => {
  const skin = SKIN_BY_ID[req.params.id];
  if (skin) return res.json(skin);
  try {
    const adminSkin = await getEnabledAdminItem('card_skin', req.params.id);
    if (!adminSkin) return res.status(404).json({ error: 'not found' });
    res.json(adminCardSkin(adminSkin, priceGoldFromDollars));
  } catch (err) { next(err); }
});

/**
 * PRO: GET /inventory/me/grouped — return owned emoji, card skins, and
 * badges in pre-grouped buckets so the Inventory page can render each
 * section without doing client-side joins. Pack metadata (name, rarity,
 * icon) is merged so the page never needs a second round-trip.
 */
inventoryRouter.get('/me/grouped', authRequired, async (req, res, next) => {
  try {
    const inv = await query(
      'SELECT item_type, item_id, quantity, obtained_at FROM inventory WHERE user_id = $1',
      [req.user.id]
    );
    const ownedEmojiByPack = new Map();   // packId -> array of {emojiId, qty, obtained}
    const ownedEmojiPackIds = new Set();
    const ownedSkins = [];
    const ownedBadges = [];
    const ownedFrames = [];
    for (const row of inv.rows) {
      if (row.item_type === 'emoji') {
        const [packId, emojiId] = String(row.item_id).split(':');
        if (!ownedEmojiByPack.has(packId)) ownedEmojiByPack.set(packId, []);
        ownedEmojiByPack.get(packId).push({ emojiId, qty: row.quantity, obtained: row.obtained_at });
      } else if (row.item_type === 'emoji_pack') {
        ownedEmojiPackIds.add(String(row.item_id));
      } else if (row.item_type === 'card_skin') {
        ownedSkins.push({ id: row.item_id, quantity: Number(row.quantity || 0), obtained: row.obtained_at });
      } else if (row.item_type === 'badge') {
        ownedBadges.push({ id: row.item_id, obtained: row.obtained_at });
      } else if (row.item_type === 'avatar_frame' || row.item_type === 'frame') {
        ownedFrames.push({ id: row.item_id, obtained: row.obtained_at });
      }
    }

    const emojiSections = EMOJI_PACKS.map((pack, i) => {
      const owned = ownedEmojiByPack.get(pack.id) || [];
      if (ownedEmojiPackIds.has(pack.id)) {
        const have = new Set(owned.map((item) => String(item.emojiId)));
        for (const emoji of (pack.emoji || [])) {
          if (!have.has(String(emoji.id))) owned.push({ emojiId: emoji.id, qty: 1, obtained: null });
        }
      }
      if (!owned.length) return null;
      return {
        packId: pack.id,
        name: pack.name,
        rarity: pack.rarity,
        premium: !!pack.premium,
        icon: PACK_ICONS[i] || '😀',
        preview: Array.isArray(pack.preview) ? pack.preview : [],
        emoji: Array.isArray(pack.emoji) ? pack.emoji : [],
        totalInPack: pack.emoji?.length || 30,
        owned,
      };
    }).filter(Boolean);
    const staticPackIds = new Set(EMOJI_PACKS.map((pack) => pack.id));
    const adminEmojiRows = await getEnabledAdminItems('emoji_pack');
    const adminEmojiById = new Map(adminEmojiRows.map((row) => [row.id, adminEmojiPack(row, PACK_ICONS[0] || ':)')]));
    for (const [packId, owned] of ownedEmojiByPack.entries()) {
      if (staticPackIds.has(packId)) continue;
      const pack = adminEmojiById.get(packId) || { id: packId, name: packId, rarity: 'rare', premium: false, icon: ':)' };
      emojiSections.push({
        packId,
        name: pack.name,
        rarity: pack.rarity,
        premium: !!pack.premium,
        icon: pack.icon || ':)',
        preview: Array.isArray(pack.preview) ? pack.preview : [],
        emoji: Array.isArray(pack.emoji) ? pack.emoji : [],
        totalInPack: pack.emoji?.length || owned.length,
        owned,
        adminCreated: !!pack.adminCreated,
      });
    }
    for (const packId of ownedEmojiPackIds) {
      if (staticPackIds.has(packId) || ownedEmojiByPack.has(packId)) continue;
      const pack = adminEmojiById.get(packId) || { id: packId, name: packId, rarity: 'rare', premium: false, icon: ':)' };
      const emoji = Array.isArray(pack.emoji) && pack.emoji.length
        ? pack.emoji
        : [{ id: 'main', value: pack.icon || ':)', label: pack.name || packId }];
      emojiSections.push({
        packId,
        name: pack.name,
        rarity: pack.rarity,
        premium: !!pack.premium,
        icon: pack.icon || ':)',
        preview: Array.isArray(pack.preview) ? pack.preview : [],
        emoji,
        totalInPack: emoji.length,
        owned: emoji.map((item) => ({ emojiId: item.id, qty: 1, obtained: null })),
        adminCreated: !!pack.adminCreated,
      });
    }

    const adminSkinRows = await getEnabledAdminItems('card_skin');
    const adminSkinMap = new Map(adminSkinRows.map((row) => [row.id, adminCardSkin(row, priceGoldFromDollars)]));
    const skins = await Promise.all(ownedSkins.map(async (o) => {
      const meta = SKIN_BY_ID[o.id] || adminSkinMap.get(o.id);
      const giftable = await cardSkinGiftableCopies(req.user.id, o.id, o.quantity);
      return meta ? { ...meta, quantity: o.quantity, giftable, obtained: o.obtained } : { id: o.id, name: o.id, quantity: o.quantity, giftable: 0, obtained: o.obtained };
    }));

    // Badge metadata is computed from the user record plus the monthly_badges table.
    // Older production databases do not have a users.monthly_badges column; monthly
    // awards live in their own table from migration 004.
    const u = await query(
      `SELECT badges_showcase, selected_avatar_frame
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    const showcase = u.rows[0]?.badges_showcase || [];
    let monthly = [];
    try {
      const monthlyRows = await query(
        `SELECT badge_key, period_year, period_month, metric_value, awarded_at
           FROM monthly_badges
          WHERE user_id = $1
          ORDER BY period_year DESC, period_month DESC, awarded_at DESC
          LIMIT 24`,
        [req.user.id]
      );
      monthly = monthlyRows.rows;
    } catch (_) {
      monthly = [];
    }

    res.json({
      emoji: emojiSections,
      cardSkins: skins,
      profileFrames: ownedFrames.map((o) => ({
        ...(PROFILE_FRAME_BY_ID[o.id] || { id: o.id, name: o.id, priceGold: 0, icon: '○' }),
        obtained: o.obtained,
      })),
      selectedAvatarFrame: u.rows[0]?.selected_avatar_frame || null,
      badges: { showcase, monthly, owned: ownedBadges },
      counts: {
        emojiPacksOwned: emojiSections.length,
        emojiUnique: emojiSections.reduce((a, s) => a + s.owned.length, 0),
        cardSkins: skins.length,
        profileFrames: ownedFrames.length,
        badges: ownedBadges.length + (Array.isArray(monthly) ? monthly.length : 0),
      },
    });
  } catch (err) { next(err); }
});

/** Set the currently selected card skin (the user must own it). */
inventoryRouter.post('/me/select-skin', authRequired, async (req, res, next) => {
  try {
    const skinId = String(req.body?.skinId || '').slice(0, 64);
    if (!skinId) return res.status(400).json({ error: 'skinId required' });
    if (skinId !== 'default') {
      const staticSkin = SKIN_BY_ID[skinId];
      const isFreeSelectableStaticSkin = staticSkin?.collectionType === 'paid' && Number(staticSkin.priceCoins || 0) <= 0;
      const owned = await query(
        `SELECT 1 FROM inventory WHERE user_id = $1 AND item_type = 'card_skin' AND item_id = $2`,
        [req.user.id, skinId]
      );
      if (!owned.rows[0] && !isFreeSelectableStaticSkin) return res.status(403).json({ error: 'skin not owned' });
    }
    await query('UPDATE users SET selected_skin = $1 WHERE id = $2', [skinId, req.user.id]);
    res.json({ ok: true, selectedSkin: skinId });
  } catch (err) { next(err); }
});

/** Set the currently selected profile/avatar frame (the user must own it). */
inventoryRouter.post('/me/select-avatar-frame', authRequired, async (req, res, next) => {
  try {
    const frameId = String(req.body?.frameId || '').slice(0, 64);
    if (!frameId || frameId === 'none') {
      await query('UPDATE users SET selected_avatar_frame = NULL WHERE id = $1', [req.user.id]);
      return res.json({ ok: true, selectedAvatarFrame: null });
    }
    if (!PROFILE_FRAME_BY_ID[frameId]) {
      const adminFrame = await getEnabledAdminItem('avatar_frame', frameId);
      if (!adminFrame) return res.status(404).json({ error: 'frame not found' });
    }
    const owned = await query(
      `SELECT 1 FROM inventory WHERE user_id = $1 AND item_type IN ('avatar_frame', 'frame') AND item_id = $2`,
      [req.user.id, frameId]
    );
    if (!owned.rows[0]) return res.status(403).json({ error: 'frame not owned' });
    await query('UPDATE users SET selected_avatar_frame = $1 WHERE id = $2', [frameId, req.user.id]);
    res.json({ ok: true, selectedAvatarFrame: frameId });
  } catch (err) { next(err); }
});

/** Update the badge showcase (up to 3 badge ids). */
inventoryRouter.post('/me/badges/showcase', authRequired, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.badges) ? req.body.badges.slice(0, 3).map(String) : [];
    await query('UPDATE users SET badges_showcase = $1 WHERE id = $2', [ids, req.user.id]);
    res.json({ ok: true, badges: ids });
  } catch (err) { next(err); }
});
