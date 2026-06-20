import { query } from '../db.js';
import { SKIN_BY_ID } from '../data/cardSkins.js';

async function runQuery(client, text, params) {
  return client ? client.query(text, params) : query(text, params);
}

export function giftableInventoryCopies(totalQuantity, protectedCopies = 0) {
  const total = Math.max(0, Math.floor(Number(totalQuantity || 0)));
  const protectedCount = Math.max(1, Math.floor(Number(protectedCopies || 0)));
  return Math.max(0, total - protectedCount);
}

export async function paidStickerPackCopies(userId, packId, client = null) {
  const r = await runQuery(
    client,
    `SELECT COALESCE(COUNT(*), 0)::int AS count
       FROM gold_transactions
      WHERE user_id = $1
        AND amount < 0
        AND type = 'sticker_pack_buy'
        AND metadata->>'packId' = $2`,
    [userId, packId]
  );
  return Number(r.rows[0]?.count || 0);
}

export async function paidCardSkinCopies(userId, skinId, client = null) {
  const r = await runQuery(
    client,
    `SELECT COALESCE(COUNT(*), 0)::int AS count
       FROM gold_transactions
      WHERE user_id = $1
        AND amount < 0
        AND metadata->>'itemType' = 'card_skin'
        AND metadata->>'itemId' = $2`,
    [userId, skinId]
  );
  return Number(r.rows[0]?.count || 0);
}

export function isRandomGiftableCardSkin(skinId) {
  return SKIN_BY_ID[skinId]?.collectionType === 'random';
}

export async function stickerGiftableCopies(userId, packId, totalQuantity, client = null) {
  const paidCopies = await paidStickerPackCopies(userId, packId, client);
  return giftableInventoryCopies(totalQuantity, paidCopies);
}

export async function cardSkinGiftableCopies(userId, skinId, totalQuantity, client = null) {
  if (!isRandomGiftableCardSkin(skinId)) return 0;
  const paidCopies = await paidCardSkinCopies(userId, skinId, client);
  return giftableInventoryCopies(totalQuantity, paidCopies);
}
