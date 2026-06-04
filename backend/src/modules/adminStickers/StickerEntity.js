import { HttpError } from '../../middleware/error.js';

export const STICKER_RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const STICKER_TYPES = ['static', 'animated'];
export const STICKER_STATUSES = ['active', 'inactive'];

function assertOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
}

function cleanString(value, field, { min = 1, max = 255 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min) throw new HttpError(400, `${field} is required`);
  if (text.length > max) throw new HttpError(400, `${field} is too long`);
  return text;
}

function cleanInteger(value, field, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${field} must be a non-negative number`);
  return Math.min(Math.floor(n), max);
}

export class StickerEntity {
  constructor(data) {
    this.id = data.id ?? null;
    this.uniqueId = cleanString(data.uniqueId ?? data.unique_id, 'unique_id', { max: 64 });
    this.name = cleanString(data.name, 'name', { max: 140 });
    this.imageUrl = cleanString(data.imageUrl ?? data.image_url, 'image_url', { max: 1000 });
    this.rarity = String(data.rarity ?? 'rare').toLowerCase();
    this.type = String(data.type ?? 'static').toLowerCase();
    this.status = String(data.status ?? 'active').toLowerCase();
    this.priceGold = cleanInteger(data.priceGold ?? data.price_gold, 'price_gold', { max: 2_000_000_000 });
    this.priceUzs = cleanInteger(data.priceUzs ?? data.price_uzs, 'price_uzs', { max: 9_000_000_000_000 });
    this.soldCount = cleanInteger(data.soldCount ?? data.sold_count, 'sold_count', { max: 9_000_000_000_000 });

    assertOneOf(this.rarity, STICKER_RARITIES, 'rarity');
    assertOneOf(this.type, STICKER_TYPES, 'type');
    assertOneOf(this.status, STICKER_STATUSES, 'status');
  }

  get isDynamicPrice() {
    return this.priceGold === 0 || this.priceUzs === 0;
  }

  toPersistence() {
    return {
      unique_id: this.uniqueId,
      name: this.name,
      image_url: this.imageUrl,
      rarity: this.rarity,
      type: this.type,
      status: this.status,
      price_gold: this.priceGold,
      price_uzs: this.priceUzs,
      sold_count: this.soldCount,
    };
  }

  static fromRow(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      uniqueId: row.unique_id,
      unique_id: row.unique_id,
      name: row.name,
      imageUrl: row.image_url,
      image_url: row.image_url,
      rarity: row.rarity,
      type: row.type,
      status: row.status,
      priceGold: Number(row.price_gold || 0),
      price_gold: Number(row.price_gold || 0),
      priceUzs: Number(row.price_uzs || 0),
      price_uzs: Number(row.price_uzs || 0),
      soldCount: Number(row.sold_count || 0),
      sold_count: Number(row.sold_count || 0),
      dynamicPrice: Number(row.price_gold || 0) === 0 || Number(row.price_uzs || 0) === 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
