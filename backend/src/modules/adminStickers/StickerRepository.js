import { query } from '../../db.js';
import { HttpError } from '../../middleware/error.js';
import { StickerEntity } from './StickerEntity.js';
import { StickerRepositoryInterface } from './StickerRepositoryInterface.js';

const SORT_FIELDS = new Map([
  ['created_at', 'created_at'],
  ['updated_at', 'updated_at'],
  ['unique_id', 'unique_id'],
  ['name', 'name'],
  ['sold_count', 'sold_count'],
  ['price_gold', 'price_gold'],
  ['price_uzs', 'price_uzs'],
]);

function normalizePagination(pagination = {}) {
  const page = Math.max(1, Math.floor(Number(pagination.page || 1)));
  const limit = Math.max(1, Math.min(Math.floor(Number(pagination.limit || 10)), 100));
  const sortBy = SORT_FIELDS.get(String(pagination.sortBy || 'unique_id')) || 'unique_id';
  const order = String(pagination.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return { page, limit, offset: (page - 1) * limit, sortBy, order };
}

function buildWhere(filters = {}) {
  const where = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };

  if (filters.search) {
    values.push(`%${filters.search}%`, `%${filters.search}%`);
    where.push(`(name ILIKE $${values.length - 1} OR unique_id ILIKE $${values.length})`);
  }
  if (filters.rarity && filters.rarity !== 'all') add('rarity = ?', filters.rarity);
  if (filters.type && filters.type !== 'all') add('type = ?', filters.type);
  if (filters.status && filters.status !== 'all') add('status = ?', filters.status);

  return {
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    values,
  };
}

export class StickerRepository extends StickerRepositoryInterface {
  async getAll(filters = {}, pagination = {}) {
    const { page, limit, offset, sortBy, order } = normalizePagination(pagination);
    const { clause, values } = buildWhere(filters);
    const listParams = [...values, limit, offset];
    const list = await query(
      `SELECT id, unique_id, name, image_url, rarity, type, status, price_gold, price_uzs, sold_count, created_at, updated_at
         FROM stickers
         ${clause}
         ORDER BY ${sortBy} ${order}, id DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      listParams
    );
    const total = await query(`SELECT COUNT(*)::int AS total FROM stickers ${clause}`, values);
    return {
      data: list.rows.map(StickerEntity.fromRow),
      pagination: {
        page,
        limit,
        total: total.rows[0]?.total || 0,
        pages: Math.max(1, Math.ceil((total.rows[0]?.total || 0) / limit)),
      },
    };
  }

  async findById(id) {
    const r = await query(
      `SELECT id, unique_id, name, image_url, rarity, type, status, price_gold, price_uzs, sold_count, created_at, updated_at
         FROM stickers
        WHERE id = $1`,
      [id]
    );
    return StickerEntity.fromRow(r.rows[0]);
  }

  async create(data) {
    const sticker = new StickerEntity(data).toPersistence();
    const r = await query(
      `INSERT INTO stickers (unique_id, name, image_url, rarity, type, status, price_gold, price_uzs, sold_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, unique_id, name, image_url, rarity, type, status, price_gold, price_uzs, sold_count, created_at, updated_at`,
      [
        sticker.unique_id,
        sticker.name,
        sticker.image_url,
        sticker.rarity,
        sticker.type,
        sticker.status,
        sticker.price_gold,
        sticker.price_uzs,
        sticker.sold_count,
      ]
    ).catch((err) => {
      if (err.code === '23505') throw new HttpError(409, 'unique_id already exists');
      throw err;
    });
    return StickerEntity.fromRow(r.rows[0]);
  }

  async update(id, data) {
    const existing = await this.findById(id);
    if (!existing) return null;
    const merged = new StickerEntity({
      ...existing,
      ...data,
      uniqueId: data.uniqueId ?? data.unique_id ?? existing.uniqueId,
      imageUrl: data.imageUrl ?? data.image_url ?? existing.imageUrl,
      priceGold: data.priceGold ?? data.price_gold ?? existing.priceGold,
      priceUzs: data.priceUzs ?? data.price_uzs ?? existing.priceUzs,
      soldCount: data.soldCount ?? data.sold_count ?? existing.soldCount,
    }).toPersistence();
    const r = await query(
      `UPDATE stickers
          SET unique_id = $2,
              name = $3,
              image_url = $4,
              rarity = $5,
              type = $6,
              status = $7,
              price_gold = $8,
              price_uzs = $9,
              sold_count = $10,
              updated_at = now()
        WHERE id = $1
        RETURNING id, unique_id, name, image_url, rarity, type, status, price_gold, price_uzs, sold_count, created_at, updated_at`,
      [
        id,
        merged.unique_id,
        merged.name,
        merged.image_url,
        merged.rarity,
        merged.type,
        merged.status,
        merged.price_gold,
        merged.price_uzs,
        merged.sold_count,
      ]
    ).catch((err) => {
      if (err.code === '23505') throw new HttpError(409, 'unique_id already exists');
      throw err;
    });
    return StickerEntity.fromRow(r.rows[0]);
  }

  async delete(id) {
    const r = await query('DELETE FROM stickers WHERE id = $1 RETURNING id', [id]);
    return r.rowCount > 0;
  }

  async stats() {
    const [stickers, system, users, revenue, online] = await Promise.all([
      query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'active')::int AS active,
               COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive,
               COALESCE(SUM(sold_count),0)::bigint AS sold
          FROM stickers
      `),
      query('SELECT total_users, total_revenue_uzs, online_users, server_status FROM system_stats WHERE id = 1'),
      query('SELECT COUNT(*)::bigint AS total_users FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE').catch(() => ({ rows: [{ total_users: 0 }] })),
      query('SELECT COALESCE(SUM(price_uzs * sold_count),0)::bigint AS total_revenue_uzs FROM stickers').catch(() => ({ rows: [{ total_revenue_uzs: 0 }] })),
      query("SELECT COUNT(*)::bigint AS online_users FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE AND updated_at > now() - INTERVAL '5 minutes'").catch(() => ({ rows: [{ online_users: 0 }] })),
    ]);
    const s = stickers.rows[0] || {};
    const systemRow = system.rows[0] || {};
    return {
      totalUsers: Number(users.rows[0]?.total_users || 0),
      totalRevenueUzs: Number(revenue.rows[0]?.total_revenue_uzs || 0),
      onlineUsers: Number(online.rows[0]?.online_users || 0),
      serverStatus: systemRow.server_status || 'stable',
      totalStickers: Number(s.total || 0),
      activeStickers: Number(s.active || 0),
      inactiveStickers: Number(s.inactive || 0),
      totalSold: Number(s.sold || 0),
      activePercent: Number(s.total || 0) ? Math.round((Number(s.active || 0) / Number(s.total || 1)) * 1000) / 10 : 0,
      inactivePercent: Number(s.total || 0) ? Math.round((Number(s.inactive || 0) / Number(s.total || 1)) * 1000) / 10 : 0,
    };
  }
}
