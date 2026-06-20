// Friend collectible gifts. Only extra random drops can be transferred:
// sticker packs and random card skin copies.
import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { SKIN_BY_ID } from '../data/cardSkins.js';
import { STICKER_PACK_BY_ID } from '../data/stickerPacks.js';
import { cardSkinGiftableCopies, stickerGiftableCopies } from './giftEligibility.js';

async function ensureFriends(senderId, recipientId) {
  if (senderId === recipientId) throw new HttpError(400, 'cannot gift yourself');
  const r = await query(
    `SELECT f.status
       FROM friends f
       JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = $1
        AND f.friend_id = $2
        AND u.is_banned = FALSE
        AND u.is_bot IS NOT TRUE`,
    [senderId, recipientId]
  );
  if (!r.rows[0] || r.rows[0].status !== 'accepted') {
    throw new HttpError(403, 'not friends');
  }
}

export async function giftCardSkin({ senderId, recipientId, skinId, message, quantity = 1 }) {
  await ensureFriends(senderId, recipientId);
  const skin = SKIN_BY_ID[skinId];
  if (!skin) throw new HttpError(404, 'skin not found');
  if (skin.id === 'default') throw new HttpError(400, 'default skin cannot be gifted');
  if (skin.collectionType !== 'random') {
    throw new HttpError(403, 'only extra random card skins can be gifted');
  }
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
    const giftable = await cardSkinGiftableCopies(senderId, skin.id, ownedQty, client);
    if (giftable < amount) {
      throw new HttpError(400, 'only extra random card skin copies can be gifted');
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

export async function giftStickerPack({ senderId, recipientId, packId, message }) {
  await ensureFriends(senderId, recipientId);
  const pack = STICKER_PACK_BY_ID[packId];
  if (!pack) throw new HttpError(404, 'sticker pack not found');
  await withTransaction(async (client) => {
    const owned = await client.query(
      `SELECT quantity FROM inventory
        WHERE user_id = $1 AND item_type = 'sticker_pack' AND item_id = $2
        FOR UPDATE`,
      [senderId, pack.id]
    );
    if (!owned.rows[0] || Number(owned.rows[0].quantity || 0) <= 0) {
      throw new HttpError(403, 'you do not own this sticker pack');
    }
    const giftable = await stickerGiftableCopies(senderId, pack.id, Number(owned.rows[0].quantity || 0), client);
    if (giftable < 1) {
      throw new HttpError(400, 'only extra non-purchased sticker packs can be gifted');
    }
    const debit = await client.query(
      `UPDATE inventory
          SET quantity = quantity - 1
        WHERE user_id = $1 AND item_type = 'sticker_pack' AND item_id = $2 AND quantity > 0
        RETURNING quantity`,
      [senderId, pack.id]
    );
    if (!debit.rows[0]) throw new HttpError(409, 'sticker pack was already gifted');
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
