import { query } from '../db.js';

export async function getPriceOverrides() {
  const r = await query(
    'SELECT item_type, item_id, price_coins, price_gold, price_usd FROM item_price_overrides'
  ).catch(() => ({ rows: [] }));
  return new Map(r.rows.map((row) => [`${row.item_type}:${row.item_id}`, row]));
}

export function applyPriceOverride(item, itemType, itemId, overrides) {
  const override = overrides?.get?.(`${itemType}:${itemId}`);
  if (!override) return item;
  return {
    ...item,
    price: override.price_coins === null || override.price_coins === undefined ? item.price : Number(override.price_coins),
    priceCoins: override.price_coins === null || override.price_coins === undefined ? item.priceCoins : Number(override.price_coins),
    priceGold: override.price_gold === null || override.price_gold === undefined ? item.priceGold : Number(override.price_gold),
    priceUsd: override.price_usd === null || override.price_usd === undefined ? item.priceUsd : Number(override.price_usd),
    adminPriceOverride: true,
  };
}

export async function getEnabledAdminItems(itemType = null) {
  const params = [];
  const where = ['enabled = TRUE'];
  if (itemType) {
    params.push(itemType);
    where.push(`item_type = $${params.length}`);
  }
  const r = await query(
    `SELECT id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_at
       FROM admin_items
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC`,
    params
  ).catch(() => ({ rows: [] }));
  return r.rows;
}

export async function getEnabledAdminItem(itemType, itemId) {
  const r = await query(
    `SELECT id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_at
       FROM admin_items
      WHERE enabled = TRUE AND item_type = $1 AND id = $2
      LIMIT 1`,
    [itemType, itemId]
  ).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

export function adminCardSkin(row, priceGoldFromDollars) {
  return {
    id: row.id,
    name: row.name,
    rarity: row.rarity || 'rare',
    premium: false,
    imageUrl: row.image_url || '',
    priceCoins: Number(row.price_coins || 0),
    priceGold: Number(row.price_gold || 0) || priceGoldFromDollars(row.price_coins || 0),
    collectionType: 'paid',
    adminCreated: true,
    palette: {
      bg: '#0d0d14',
      accent: '#f5a623',
    },
  };
}

export function adminEmojiPack(row, fallbackIcon = '*') {
  const icon = row.icon || fallbackIcon;
  const imageUrl = row.image_url || '';
  return {
    id: row.id,
    name: row.name,
    rarity: row.rarity || 'rare',
    premium: false,
    icon,
    imageUrl,
    price: Number(row.price_coins || 0),
    priceGold: Number(row.price_gold || 0),
    preview: imageUrl ? [{ id: `${row.id}_image`, img: imageUrl, label: row.name }] : [icon],
    features: ['admin-created'],
    emoji: [{ id: 'main', value: icon, label: row.name }],
    adminCreated: true,
  };
}

export function adminProfileFrame(row) {
  return {
    id: row.id,
    name: row.name,
    rarity: row.rarity || 'rare',
    icon: row.icon || '*',
    imageUrl: row.image_url || '',
    priceGold: Number(row.price_gold || 0),
    adminCreated: true,
  };
}
