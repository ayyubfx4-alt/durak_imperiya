// TOR §12 — friend gifts. Paid items (premium emoji packs, paid card
// skins) must be paid for by the sender at the public list price; free
// items (default skin, common badges) can be sent without charge.
import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { PACK_BY_ID, EMOJI_PACKS } from '../data/emojiPacks.js';
import { SKIN_BY_ID } from '../data/cardSkins.js';
import { STICKER_PACK_BY_ID } from '../data/stickerPacks.js';

const EMOJI_PACK_PRICE_COINS = { common: 200, uncommon: 500, rare: 1500, legendary: 5000 };
const DOLLARS_PER_GOLD = 10000 / 55;
const priceGoldFromDollars = (dollars) => Math.max(0, Math.ceil(Number(dollars || 0) / DOLLARS_PER_GOLD));

const PREMIUM_PACK_IDS = new Set(EMOJI_PACKS.filter((p) => p.premium).map((p) => p.id));

async function lookupOverride(itemType, itemId) {
  try {
    const r = await query(
      'SELECT price_coins, price_gold FROM item_price_overrides WHERE item_type = $1 AND item_id = $2',
      [itemType, itemId]
    );
    return r.rows[0] || null;
  } catch (_) {
    return null;
  }
}

async function ensureFriends(senderId, recipientId) {
  if (senderId === recipientId) throw new HttpError(400, 'cannot gift yourself');
  const r = await query(
    "SELECT status FROM friends WHERE user_id = $1 AND friend_id = $2",
    [senderId, recipientId]
  );
  if (!r.rows[0] || r.rows[0].status !== 'accepted') {
    throw new HttpError(403, 'not friends');
  }
}

/**
 * Gift Gold Coins. Sender pays 1:1; no markup. Recipients must be friends.
 */
export async function giftGold({ senderId, recipientId, amount }) {
  const amt = Math.max(1, Math.min(Math.floor(Number(amount) || 0), 1_000_000));
  await ensureFriends(senderId, recipientId);
  return withTransaction(async (client) => {
    const lock = await client.query('SELECT gold_coins FROM users WHERE id = $1 FOR UPDATE', [senderId]);
    if (!lock.rows[0]) throw new HttpError(404, 'sender not found');
    if (Number(lock.rows[0].gold_coins) < amt) throw new HttpError(400, 'insufficient gold coins');
    await client.query('UPDATE users SET gold_coins = gold_coins - $1 WHERE id = $2', [amt, senderId]);
    await client.query('UPDATE users SET gold_coins = gold_coins + $1 WHERE id = $2', [amt, recipientId]);
    await client.query(
      `INSERT INTO gold_transactions (user_id, amount, type, metadata)
       VALUES ($1, $2, 'gift', $3), ($4, $5, 'gift', $6)`,
      [
        senderId, -amt, { to: recipientId },
        recipientId, amt, { from: senderId },
      ]
    );
    await client.query(
      `INSERT INTO gifts (sender_id, recipient_id, item_type, quantity, paid_gold, message)
       VALUES ($1, $2, 'gold', $3, $4, $5)`,
      [senderId, recipientId, amt, amt, null]
    );
    return { ok: true };
  });
}

/**
 * Gift an emoji pack. Premium packs cost the sender; the recipient
 * receives all emoji of that pack in their inventory.
 */
export async function giftEmojiPack({ senderId, recipientId, packId, message }) {
  await ensureFriends(senderId, recipientId);
  const pack = PACK_BY_ID[packId];
  if (!pack) throw new HttpError(404, 'pack not found');
  if (PREMIUM_PACK_IDS.has(pack.id)) {
    // Premium packs may only be gifted by users who already own them OR
    // who pay the price. We enforce ownership as a guardrail.
    const owned = await query(
      `SELECT 1 FROM inventory WHERE user_id = $1 AND item_type = 'emoji_pack' AND item_id = $2`,
      [senderId, pack.id]
    );
    if (!owned.rows[0]) throw new HttpError(403, 'premium packs must be purchased before gifting');
  }
  const override = await lookupOverride('emoji_pack', pack.id);
  const price = Number(
    override?.price_gold
    ?? pack.priceGold
    ?? priceGoldFromDollars(override?.price_coins ?? (EMOJI_PACK_PRICE_COINS[pack.rarity] ?? 1000))
  );
  return withTransaction(async (client) => {
    const lock = await client.query('SELECT gold_coins FROM users WHERE id = $1 FOR UPDATE', [senderId]);
    if (!lock.rows[0]) throw new HttpError(404, 'sender not found');
    if (Number(lock.rows[0].gold_coins) < price) throw new HttpError(400, 'insufficient gold coins');
    if (price > 0) {
      await client.query('UPDATE users SET gold_coins = gold_coins - $1 WHERE id = $2', [price, senderId]);
      await client.query(
        `INSERT INTO gold_transactions (user_id, amount, type, metadata)
         VALUES ($1, $2, 'gift_emoji_pack', $3)`,
        [senderId, -price, { recipientId, packId: pack.id }]
      );
    }
    await client.query(
      `INSERT INTO inventory (user_id, item_type, item_id, quantity)
       VALUES ($1, 'emoji_pack', $2, 1)
       ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET quantity = GREATEST(inventory.quantity, 1)`,
      [recipientId, pack.id]
    );
    for (const e of pack.emoji) {
      await client.query(
        `INSERT INTO inventory (user_id, item_type, item_id, quantity)
         VALUES ($1, 'emoji', $2, 1)
         ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET quantity = inventory.quantity + 1`,
        [recipientId, `${pack.id}:${e.id}`]
      );
    }
    await client.query(
      `INSERT INTO gifts (sender_id, recipient_id, item_type, item_id, paid_gold, message)
       VALUES ($1, $2, 'emoji_pack', $3, $4, $5)`,
      [senderId, recipientId, pack.id, price, message ? String(message).slice(0, 200) : null]
    );
    return { ok: true, paidGold: price };
  });
}

/**
 * Gift a card skin. Sender must already own premium skins; default skin
 * is free.
 */
export async function giftCardSkin({ senderId, recipientId, skinId, message, quantity = 1 }) {
  await ensureFriends(senderId, recipientId);
  const skin = SKIN_BY_ID[skinId];
  if (!skin) throw new HttpError(404, 'skin not found');
  if (skin.id === 'default') throw new HttpError(400, 'default skin cannot be gifted');
  const amount = Math.max(1, Math.min(Math.floor(Number(quantity) || 1), 99));
  return withTransaction(async (client) => {
    const owned = await client.query(
      `SELECT quantity FROM inventory
        WHERE user_id = $1 AND item_type = 'card_skin' AND item_id = $2
        FOR UPDATE`,
      [senderId, skin.id]
    );
    const ownedQty = Number(owned.rows[0]?.quantity || 0);
    if (ownedQty <= 0) throw new HttpError(403, 'you do not own this card skin');
    if (ownedQty - amount < 1) {
      throw new HttpError(400, 'you must keep one copy of this card skin');
    }
    await client.query(
      `UPDATE inventory
          SET quantity = quantity - $3
        WHERE user_id = $1 AND item_type = 'card_skin' AND item_id = $2`,
      [senderId, skin.id, amount]
    );
    await client.query(
      `INSERT INTO inventory (user_id, item_type, item_id, quantity)
       VALUES ($1, 'card_skin', $2, $3)
       ON CONFLICT (user_id, item_type, item_id)
       DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity`,
      [recipientId, skin.id, amount]
    );
    await client.query(
      `INSERT INTO gifts (sender_id, recipient_id, item_type, item_id, quantity, paid_gold, message)
       VALUES ($1, $2, 'card_skin', $3, $4, 0, $5)`,
      [senderId, recipientId, skin.id, amount, message ? String(message).slice(0, 200) : null]
    );
    return { ok: true, paidGold: 0, quantity: amount, skinId: skin.id };
  });
}

/**
 * Gift a badge (achievement / collectible). Sender must already own it.
 */
export async function giftBadge({ senderId, recipientId, badgeId, message }) {
  await ensureFriends(senderId, recipientId);
  if (!badgeId) throw new HttpError(400, 'badgeId required');
  const owned = await query(
    `SELECT 1 FROM inventory WHERE user_id = $1 AND item_type = 'badge' AND item_id = $2`,
    [senderId, String(badgeId)]
  );
  if (!owned.rows[0]) throw new HttpError(403, 'you do not own this badge');
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO inventory (user_id, item_type, item_id, quantity)
       VALUES ($1, 'badge', $2, 1)
       ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
      [recipientId, String(badgeId)]
    );
    await client.query(
      `INSERT INTO gifts (sender_id, recipient_id, item_type, item_id, message)
       VALUES ($1, $2, 'badge', $3, $4)`,
      [senderId, recipientId, String(badgeId), message ? String(message).slice(0, 200) : null]
    );
  });
  return { ok: true };
}

export async function giftStickerPack({ senderId, recipientId, packId, message }) {
  await ensureFriends(senderId, recipientId);
  const pack = STICKER_PACK_BY_ID[packId];
  if (!pack) throw new HttpError(404, 'sticker pack not found');
  const owned = await query(
    `SELECT quantity FROM inventory
      WHERE user_id = $1 AND item_type = 'sticker_pack' AND item_id = $2`,
    [senderId, pack.id]
  );
  if (!owned.rows[0] || Number(owned.rows[0].quantity || 0) <= 0) {
    throw new HttpError(403, 'you do not own this sticker pack');
  }
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE inventory
          SET quantity = quantity - 1
        WHERE user_id = $1 AND item_type = 'sticker_pack' AND item_id = $2 AND quantity > 0`,
      [senderId, pack.id]
    );
    await client.query(
      `DELETE FROM inventory
        WHERE user_id = $1 AND item_type = 'sticker_pack' AND item_id = $2 AND quantity <= 0`,
      [senderId, pack.id]
    );
    await client.query(
      `INSERT INTO inventory (user_id, item_type, item_id, quantity)
       VALUES ($1, 'sticker_pack', $2, 1)
       ON CONFLICT (user_id, item_type, item_id)
       DO UPDATE SET quantity = inventory.quantity + 1`,
      [recipientId, pack.id]
    );
    await client.query(
      `INSERT INTO gifts (sender_id, recipient_id, item_type, item_id, quantity, message)
       VALUES ($1, $2, 'sticker_pack', $3, 1, $4)`,
      [senderId, recipientId, pack.id, message ? String(message).slice(0, 200) : null]
    );
  });
  return { ok: true, packId: pack.id };
}

export async function recentGiftsForUser(userId, limit = 30) {
  const cap = Math.max(1, Math.min(100, Number(limit) || 30));
  const r = await query(
    `SELECT g.id, g.item_type, g.item_id, g.quantity, g.paid_coins, g.paid_gold, g.message, g.created_at,
            su.username AS sender_username
       FROM gifts g
       LEFT JOIN users su ON su.id = g.sender_id
       WHERE g.recipient_id = $1
       ORDER BY g.created_at DESC
       LIMIT $2`,
    [userId, cap]
  );
  return r.rows;
}
