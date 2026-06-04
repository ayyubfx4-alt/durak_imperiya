import { HttpError } from '../../middleware/error.js';
import { STICKER_RARITIES, STICKER_STATUSES, STICKER_TYPES } from './StickerEntity.js';

export function parseStickerFilters(query) {
  const filters = {};
  const search = String(query.search || '').trim();
  if (search) filters.search = search.slice(0, 120);

  for (const [field, allowed] of [
    ['rarity', STICKER_RARITIES],
    ['type', STICKER_TYPES],
    ['status', STICKER_STATUSES],
  ]) {
    const value = String(query[field] || 'all').toLowerCase();
    if (value !== 'all' && !allowed.includes(value)) throw new HttpError(400, `${field} filter is invalid`);
    filters[field] = value;
  }

  return filters;
}

export function parsePagination(query) {
  return {
    page: Math.max(1, Math.floor(Number(query.page || 1))),
    limit: Math.max(1, Math.min(Math.floor(Number(query.limit || 10)), 100)),
    sortBy: String(query.sortBy || 'unique_id'),
    order: String(query.order || 'asc'),
  };
}

export function normalizeStickerInput(body, { partial = false } = {}) {
  const out = {};
  const fields = [
    ['uniqueId', 'unique_id'],
    ['name', 'name'],
    ['imageUrl', 'image_url'],
    ['rarity', 'rarity'],
    ['type', 'type'],
    ['status', 'status'],
    ['priceGold', 'price_gold'],
    ['priceUzs', 'price_uzs'],
    ['soldCount', 'sold_count'],
  ];

  for (const [camel, snake] of fields) {
    if (Object.prototype.hasOwnProperty.call(body, camel)) out[camel] = body[camel];
    else if (Object.prototype.hasOwnProperty.call(body, snake)) out[camel] = body[snake];
  }

  if (!partial) {
    for (const required of ['uniqueId', 'name', 'imageUrl']) {
      if (out[required] === undefined || String(out[required]).trim() === '') {
        throw new HttpError(400, `${required} is required`);
      }
    }
  }
  return out;
}
