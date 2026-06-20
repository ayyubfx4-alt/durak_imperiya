// Sticker pack REST endpoints — TOR §10.
//   • GET    /api/stickers/packs              — list all packs (public)
//   • GET    /api/stickers/me                 — my inventory grouped by pack
//   • POST   /api/stickers/buy                — buy a pack with gold coins
//   • POST   /api/stickers/send               — send a sticker into a room
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { query, withTransaction } from '../db.js';
import { STICKER_PACKS, STICKER_PACK_BY_ID, findStickerById } from '../data/stickerPacks.js';
import { getRegistry } from '../game/socketRegistry.js';
import { logger } from '../logger.js';
import { stickerGiftableCopies } from '../services/giftEligibility.js';

export const stickersRouter = Router();

const STICKER_SEND_COOLDOWN_MS = 4000;
const routeStickerCooldown = new Map();

function normalizeRoomCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
}

function markRouteStickerCooldown(userId, roomCode) {
  const now = Date.now();
  const key = `${roomCode}:${userId}`;
  const last = routeStickerCooldown.get(key) || 0;
  if (now - last < STICKER_SEND_COOLDOWN_MS) return false;
  routeStickerCooldown.set(key, now);
  if (routeStickerCooldown.size > 1000) {
    for (const [cooldownKey, timestamp] of routeStickerCooldown) {
      if (now - timestamp > 60_000) routeStickerCooldown.delete(cooldownKey);
    }
  }
  return true;
}

function markRoomStickerCooldown(room, userId) {
  const now = Date.now();
  room._stickerCooldown = room._stickerCooldown || new Map();
  const last = room._stickerCooldown.get(userId) || 0;
  if (now - last < STICKER_SEND_COOLDOWN_MS) return false;
  room._stickerCooldown.set(userId, now);
  return true;
}

function adminStickerPackId(uniqueId) {
  return `admin_${String(uniqueId || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

async function getAdminStickerPacks() {
  const r = await query(
    `SELECT id, unique_id, name, image_url, rarity, type, status, price_gold, sold_count
       FROM stickers
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 500`
  ).catch(() => ({ rows: [] }));
  return r.rows.map((row) => ({
    id: adminStickerPackId(row.unique_id),
    adminStickerId: row.id,
    source: 'admin',
    name: row.name,
    tag: row.type || 'static',
    rarity: row.rarity || 'rare',
    premium: false,
    priceGold: Number(row.price_gold || 0),
    size: 1,
    themeColor: '#f5a623',
    themeGlow: '#f5a623',
    panelColor: '#111827',
    stickers: [{ id: row.unique_id, img: row.image_url, label: row.name }],
    soldCount: Number(row.sold_count || 0),
  }));
}

async function findAdminStickerPack(packId) {
  const packs = await getAdminStickerPacks();
  return packs.find((pack) => pack.id === packId) || null;
}

async function findAdminStickerById(stickerId) {
  const r = await query(
    `SELECT id, unique_id, name, image_url, rarity, type, price_gold
       FROM stickers
      WHERE unique_id = $1 AND status = 'active'
      LIMIT 1`,
    [stickerId]
  ).catch(() => ({ rows: [] }));
  const row = r.rows[0];
  if (!row) return null;
  const pack = {
    id: adminStickerPackId(row.unique_id),
    adminStickerId: row.id,
    source: 'admin',
    name: row.name,
    priceGold: Number(row.price_gold || 0),
  };
  return {
    pack,
    sticker: { id: row.unique_id, img: row.image_url, label: row.name },
  };
}

stickersRouter.get('/packs', async (_req, res, next) => {
  try {
    const adminPacks = await getAdminStickerPacks();
    res.json([...STICKER_PACKS.map((p) => ({
    id: p.id, name: p.name, tag: p.tag, rarity: p.rarity, premium: p.premium,
    priceGold: p.priceGold, size: p.size, themeColor: p.themeColor,
    themeGlow: p.themeGlow, panelColor: p.panelColor,
    stickers: p.stickers,
    preview: p.stickers.slice(0, 8),
    })), ...adminPacks.map((p) => ({ ...p, preview: p.stickers }))]);
  } catch (err) { next(err); }
});

stickersRouter.get('/free', async (_req, res, next) => {
  try {
    const adminPacks = await getAdminStickerPacks();
    const freeStatic = STICKER_PACKS
      .filter((p) => Number(p.priceGold || 0) <= 0 && !p.premium)
      .map((p) => ({
        id: p.id,
        name: p.name,
        tag: p.tag,
        rarity: p.rarity,
        premium: false,
        priceGold: 0,
        size: p.size,
        themeColor: p.themeColor,
        themeGlow: p.themeGlow,
        panelColor: p.panelColor,
        owned: 1,
        stickers: p.stickers,
        preview: p.stickers.slice(0, 8),
      }));
    const freeAdmin = adminPacks
      .filter((p) => Number(p.priceGold || 0) <= 0 && !p.premium)
      .map((p) => ({ ...p, priceGold: 0, owned: 1, preview: p.stickers }));
    res.json([...freeStatic, ...freeAdmin]);
  } catch (err) { next(err); }
});

stickersRouter.get('/me', authRequired, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT item_id, quantity FROM inventory
        WHERE user_id = $1 AND item_type = 'sticker_pack'`,
      [req.user.id]
    );
    const owned = new Map(r.rows.map((row) => [row.item_id, Number(row.quantity)]));
    const adminPacks = await getAdminStickerPacks();
    const giftable = new Map();
    await Promise.all(r.rows.map(async (row) => {
      giftable.set(row.item_id, await stickerGiftableCopies(req.user.id, row.item_id, Number(row.quantity || 0)));
    }));
    const list = [
      ...STICKER_PACKS.map((p) => ({
      id: p.id, name: p.name, tag: p.tag, rarity: p.rarity, premium: p.premium,
      priceGold: p.priceGold, themeColor: p.themeColor,
      themeGlow: p.themeGlow, panelColor: p.panelColor,
      size: p.size,
      total: p.size,
      owned: owned.get(p.id) || 0,
      giftable: giftable.get(p.id) || 0,
      stickers: p.stickers,
      preview: p.stickers.slice(0, 8),
      })),
      ...adminPacks.map((p) => ({
        ...p,
        owned: owned.get(p.id) || 0,
        giftable: giftable.get(p.id) || 0,
      })),
    ];
    res.json(list);
  } catch (err) { next(err); }
});

stickersRouter.post('/buy', authRequired, async (req, res, next) => {
  try {
    const packId = String(req.body?.packId || '');
    const pack = STICKER_PACK_BY_ID[packId] || await findAdminStickerPack(packId);
    if (!pack) return res.status(404).json({ error: 'pack not found' });
    if (!pack.priceGold) return res.status(403).json({ error: 'this pack is not for sale' });
    if (pack.premium) {
      const u = await query('SELECT premium_until FROM users WHERE id = $1', [req.user.id]);
      const isPremium = u.rows[0]?.premium_until && new Date(u.rows[0].premium_until) > new Date();
      if (!isPremium) return res.status(403).json({ error: 'premium-only sticker pack' });
    }
    let alreadyOwned = false;
    const goldCoins = await withTransaction(async (client) => {
      const lock = await client.query('SELECT gold_coins FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      const owned = await client.query(
        `SELECT quantity FROM inventory WHERE user_id = $1 AND item_type = 'sticker_pack' AND item_id = $2`,
        [req.user.id, packId]
      );
      if (Number(owned.rows[0]?.quantity || 0) > 0) {
        alreadyOwned = true;
        return Number(lock.rows[0]?.gold_coins ?? 0);
      }
      const current = Number(lock.rows[0]?.gold_coins ?? 0);
      if (current < pack.priceGold) throw Object.assign(new Error('insufficient gold coins'), { status: 400 });
      const nextGold = current - pack.priceGold;
      await client.query('UPDATE users SET gold_coins = $1 WHERE id = $2', [nextGold, req.user.id]);
      await client.query(
        `INSERT INTO gold_transactions (user_id, amount, type, metadata)
         VALUES ($1, $2, 'sticker_pack_buy', $3)`,
        [req.user.id, -pack.priceGold, { packId }]
      );
      await client.query(
        `INSERT INTO inventory (user_id, item_type, item_id, quantity)
         VALUES ($1, 'sticker_pack', $2, 1)
         ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET quantity = inventory.quantity + 1`,
        [req.user.id, packId]
      );
      if (pack.source === 'admin' && pack.adminStickerId) {
        await client.query('UPDATE stickers SET sold_count = sold_count + 1, updated_at = now() WHERE id = $1', [pack.adminStickerId]).catch(() => {});
      }
      return nextGold;
    });
    res.json({ ok: true, packId, spentGold: alreadyOwned ? 0 : pack.priceGold, goldCoins, alreadyOwned });
  } catch (err) {
    if (err.message === 'insufficient gold coins') return res.status(400).json({ error: err.message });
    next(err);
  }
});

stickersRouter.post('/send', authRequired, async (req, res, next) => {
  try {
    const stickerId = String(req.body?.stickerId || '');
    const roomCode = normalizeRoomCode(req.body?.roomCode);
    if (!stickerId || !roomCode) return res.status(400).json({ error: 'stickerId and roomCode required' });
    const found = findStickerById(stickerId) || await findAdminStickerById(stickerId);
    if (!found) return res.status(404).json({ error: 'sticker not found' });
    // Verify ownership of the pack
    const own = await query(
      `SELECT 1 FROM inventory WHERE user_id = $1 AND item_type = 'sticker_pack' AND item_id = $2`,
      [req.user.id, found.pack.id]
    );
    if (!own.rows[0] && found.pack.priceGold) {
      return res.status(403).json({ error: 'sticker pack not owned' });
    }
    // Broadcast to the room
    const { io, manager } = getRegistry();
    if (!io) return res.status(503).json({ error: 'socket server unavailable' });
    const room = manager?.get(roomCode);
    // Anti-spam: max 1 sticker every 4s per user. In production the REST
    // request may hit a different backend than the room owner, so keep a route
    // fallback instead of dropping the sticker when the local room is absent.
    const allowed = room
      ? markRoomStickerCooldown(room, req.user.id)
      : markRouteStickerCooldown(req.user.id, roomCode);
    if (!allowed) {
      return res.status(429).json({ error: 'too fast' });
    }
    const payload = {
      roomCode,
      senderId: req.user.id,
      senderName: req.user.username,
      stickerId,
      packId: found.pack.id,
      img: found.sticker.img,
      durationMs: 2200,
      ts: Date.now(),
    };
    io.to(`room:${roomCode}`).emit('sticker:show', payload);
    res.json({ ok: true, sticker: payload });
  } catch (err) {
    logger.warn('sticker send failed:', err.message);
    next(err);
  }
});
