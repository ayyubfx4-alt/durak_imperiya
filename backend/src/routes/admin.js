import { Router } from 'express';
import { authRequired, adminRequired, hasAdminPermission } from '../middleware/auth.js';
import { query, withTransaction } from '../db.js';
import { changeCoins } from '../services/coins.js';
import { changeGoldCoins } from '../services/goldCoins.js';
import { config } from '../config.js';
import { settlePlacements } from './tournaments.js';
import { settleCunningFox, snapshotBluffCounters } from '../services/monthlyBadges.js';
import { adminBanUser, adminUnbanUser } from '../services/reports.js';
import { signToken } from '../util/jwt.js';
import { seedBracket, recordMatchResult, payoutPlacements, bracketSnapshot } from '../services/tournamentEngine.js';
import { scalingMode } from '../scaling/sessionStore.js';
import { countOnline, listAllRooms, unregisterRoom } from '../scaling/redisAdapter.js';
import { getRoomManager } from '../game/socketRegistry.js';
import { getAntibotList, clearAntibotScore, bulkClearAntibotCategory, deleteAntibotUser, bulkDeleteAntibotUsers } from '../services/antibot.js';
import { createAdminStickersRouter } from '../modules/adminStickers/routes.js';
import { saveAdminAsset } from '../services/adminAssets.js';
import { PRODUCTION_RESET_CONFIRMATION, productionResetPreview, runProductionReset } from '../services/productionReset.js';
import { login as userLogin } from '../services/auth.js';
import { hashPassword, verifyPassword } from '../util/passwords.js';
import { clearThresholdCache, getThresholdRows } from '../services/progression.js';
import { DEFAULT_ADMIN_SETTINGS } from '../services/adminSettings.js';

export const adminRouter = Router();

const CATALOG_TYPES = {
  decks: 'card_skin',
  chests: 'chest',
  'emoji-packs': 'emoji_pack',
  frames: 'avatar_frame',
  tasks: 'task',
  'shop/items': null,
};

const DEFAULT_SETTINGS = DEFAULT_ADMIN_SETTINGS;
const ROOM_REGISTRY_STALE_MS = 45_000;

const ADMIN_PERMISSION_RULES = [
  { prefix: '/me', any: null },
  { prefix: '/dashboard', any: ['users.view', 'game.watch', 'security.view'] },
  { prefix: '/stats', any: ['users.view', 'game.watch'] },
  { prefix: '/scaling', any: ['game.watch', 'security.view'] },
  { prefix: '/users', any: ['users.view', 'users.moderate', 'users.manage'], write: ['users.manage', 'users.moderate'] },
  { prefix: '/rooms', any: ['game.watch', 'game.manage'], write: ['game.manage'] },
  { prefix: '/games', any: ['game.watch', 'game.manage'] },
  { prefix: '/tournaments', any: ['tournaments.manage', 'game.watch'], write: ['tournaments.manage'] },
  { prefix: '/monthly-badges', any: ['tournaments.manage'] },
  { prefix: '/economy', any: ['economy.manage'] },
  { prefix: '/gold', any: ['economy.manage'] },
  { prefix: '/item-prices', any: ['economy.manage', 'shop.manage'], write: ['economy.manage', 'shop.manage'] },
  { prefix: '/shop', any: ['shop.manage', 'economy.manage'], write: ['shop.manage'] },
  { prefix: '/items', any: ['shop.manage'], write: ['shop.manage'] },
  { prefix: '/stickers', any: ['shop.manage'], write: ['shop.manage'] },
  { prefix: '/decks', any: ['shop.manage'], write: ['shop.manage'] },
  { prefix: '/chests', any: ['shop.manage'], write: ['shop.manage'] },
  { prefix: '/emoji-packs', any: ['shop.manage'], write: ['shop.manage'] },
  { prefix: '/frames', any: ['shop.manage'], write: ['shop.manage'] },
  { prefix: '/tasks', any: ['shop.manage'], write: ['shop.manage'] },
  { prefix: '/ranking', any: ['game.manage', 'game.watch'], write: ['game.manage'] },
  { prefix: '/messages/broadcast', any: ['notifications.send'], write: ['notifications.send'] },
  { prefix: '/messages/send-to-user', any: ['notifications.send'], write: ['notifications.send'] },
  { prefix: '/messages', any: ['reports.view', 'reports.manage', 'notifications.send'], write: ['reports.manage'] },
  { prefix: '/reports', any: ['reports.view', 'reports.manage'], write: ['reports.manage'] },
  { prefix: '/analytics', any: ['reports.view', 'reports.manage', 'security.view'] },
  { prefix: '/settings/antibot', any: ['security.manage'] },
  { prefix: '/settings/game-config', any: ['game.manage', 'voice.manage'] },
  { prefix: '/settings', any: ['game.manage', 'security.manage', 'economy.manage'] },
  { prefix: '/assets', any: ['shop.manage', 'game.manage'], write: ['shop.manage', 'game.manage'] },
  { prefix: '/production', any: ['security.manage', 'backup.manage'], write: ['security.manage', 'backup.manage'] },
  { prefix: '/antibot', any: ['security.view', 'security.manage'], write: ['security.manage'] },
  { prefix: '/security', any: ['security.view', 'security.manage'], write: ['security.manage'] },
  { prefix: '/backups', any: ['backup.manage'], write: ['backup.manage'] },
  { prefix: '/roles', any: ['roles.manage'], write: ['roles.manage'] },
  { prefix: '/audit', any: ['security.view', 'roles.manage'] },
  { prefix: '/promotions', any: ['economy.manage'], write: ['economy.manage'] },
  { prefix: '/progression', any: ['game.manage'], write: ['game.manage'] },
];

function intParam(value, fallback, min = 0, max = 500) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeAdminRoom(raw, { now = Date.now(), instance = scalingMode().instanceId } = {}) {
  if (!raw?.code) return null;
  const realPlayers = Number(raw.realPlayers ?? raw.realCount ?? 0) || 0;
  const taken = Number(raw.taken ?? 0) || 0;
  const bots = Number(raw.bots ?? Math.max(0, taken - realPlayers)) || 0;
  const updatedAt = Number(raw.updatedAt || now);
  return {
    code: String(raw.code),
    phase: raw.phase || 'lobby',
    mode: raw.mode || 'classic',
    stake: Number(raw.stake || 0),
    maxPlayers: Number(raw.maxPlayers || raw.max_players || 0),
    realPlayers,
    bots,
    host: raw.host || null,
    isPrivate: !!raw.isPrivate,
    bluffEnabled: !!raw.bluffEnabled,
    instance: raw.instance || instance,
    updatedAt,
  };
}

function isVisibleAdminRoom(room, now = Date.now()) {
  if (!room?.code || room.phase === 'ended') return false;
  if ((room.realPlayers || 0) <= 0) return false;
  if (room.updatedAt && now - Number(room.updatedAt) > ROOM_REGISTRY_STALE_MS) return false;
  return true;
}

function pageParams(req, fallbackLimit = 25) {
  const page = intParam(req.query.page, 1, 1, 100000);
  const limit = intParam(req.query.limit, fallbackLimit, 1, 100);
  return { page, limit, offset: (page - 1) * limit };
}

function cleanText(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function toCamelItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemType: row.item_type,
    name: row.name,
    icon: row.icon,
    imageUrl: row.image_url || '',
    image_url: row.image_url || '',
    description: row.description || '',
    rarity: row.rarity,
    priceCoins: Number(row.price_coins || 0),
    priceGold: Number(row.price_gold || 0),
    enabled: !!row.enabled,
    createdAt: row.created_at,
  };
}

function routePermissions(req) {
  if (/^\/users\/[^/]+\/role$/.test(req.path)) return ['roles.manage'];
  if (/^\/users\/[^/]+\/premium$/.test(req.path)) return ['users.manage', 'economy.manage'];
  if (/^\/users\/[^/]+\/(coins|gold|gift)$/.test(req.path)) return ['economy.manage'];
  const rule = ADMIN_PERMISSION_RULES.find((item) => req.path === item.prefix || req.path.startsWith(`${item.prefix}/`));
  if (!rule) return ['*'];
  if (rule.any === null) return null;
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  return isWrite && rule.write ? rule.write : rule.any;
}

function enforceAdminRoutePermission(req, res, next) {
  const needed = routePermissions(req);
  if (!needed) return next();
  if (hasAdminPermission(req.user, needed)) return next();
  return res.status(403).json({ error: 'permission denied', required: needed });
}

async function writeEvent(level, category, message, metadata = {}) {
  await query(
    `INSERT INTO admin_events (level, category, message, metadata)
     VALUES ($1, $2, $3, $4)`,
    [level, category, message, metadata]
  ).catch(() => {});
}

async function upsertSetting(key, value, adminId = null) {
  await query(
    `INSERT INTO admin_settings (key, value, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [key, value, adminId]
  );
  return value;
}

async function readSetting(key) {
  const r = await query('SELECT value FROM admin_settings WHERE key = $1', [key]);
  return r.rows[0]?.value ?? DEFAULT_SETTINGS[key] ?? {};
}

async function listCatalog(itemType, req) {
  const { page, limit, offset } = pageParams(req);
  const search = cleanText(req.query.search, 120);
  const status = cleanText(req.query.status, 32);
  const where = [];
  const params = [];
  if (itemType) {
    params.push(itemType);
    where.push(`item_type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR id ILIKE $${params.length})`);
  }
  if (status === 'active') where.push('enabled = TRUE');
  if (status === 'inactive') where.push('enabled = FALSE');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `SELECT id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_at
       FROM admin_items
       ${clause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  const total = await query(`SELECT COUNT(*)::int AS total FROM admin_items ${clause}`, params);
  return {
    data: rows.rows.map(toCamelItem),
    pagination: { page, limit, total: total.rows[0]?.total || 0, pages: Math.max(1, Math.ceil((total.rows[0]?.total || 0) / limit)) },
  };
}

async function saveCatalogItem(req, itemType, id = null) {
  const body = req.body || {};
  const nextId = id || cleanText(body.id, 64) || `${itemType}_${Date.now()}`;
  const name = cleanText(body.name, 120);
  if (!name) {
    const err = new Error('name required');
    err.status = 400;
    throw err;
  }
  const icon = cleanText(body.icon, 32) || null;
  const imageUrl = cleanText(body.imageUrl ?? body.image_url, 1000) || null;
  const description = cleanText(body.description, 500) || null;
  const rarity = cleanText(body.rarity || 'common', 24);
  const priceCoins = intParam(body.priceCoins ?? body.price_coins, 0, 0, 1000000000);
  const priceGold = intParam(body.priceGold ?? body.price_gold, 0, 0, 1000000000);
  const enabled = body.enabled === undefined ? true : !!body.enabled;
  const r = await query(
    `INSERT INTO admin_items (id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (id) DO UPDATE
       SET item_type = EXCLUDED.item_type,
           name = EXCLUDED.name,
           icon = EXCLUDED.icon,
           image_url = EXCLUDED.image_url,
           description = EXCLUDED.description,
           rarity = EXCLUDED.rarity,
           price_coins = EXCLUDED.price_coins,
           price_gold = EXCLUDED.price_gold,
           enabled = EXCLUDED.enabled,
           updated_at = now()
     RETURNING id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_at`,
    [nextId, itemType, name, icon, imageUrl, description, rarity, priceCoins, priceGold, enabled, req.user?.id || null]
  );
  return toCamelItem(r.rows[0]);
}

adminRouter.post('/pin-login', async (req, res, next) => {
  try {
    const pin = String(req.body?.pin || '');
    const expectedPin = process.env.ADMIN_PIN || '2202';
    if (pin !== expectedPin) return res.status(401).json({ error: 'invalid pin' });

    const email = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@durak.local';
    const r = await query(
      `SELECT id, username, email, is_admin
         FROM users
        WHERE lower(email) = lower($1) OR is_admin = TRUE
        ORDER BY lower(email) = lower($1) DESC, id ASC
        LIMIT 1`,
      [email]
    );
    const user = r.rows[0];
    if (!user || !user.is_admin) return res.status(403).json({ error: 'admin account not found' });
    res.json({ user, token: signToken({ uid: user.id }) });
  } catch (err) { next(err); }
});

adminRouter.post('/login', async (req, res, next) => {
  try {
    const identifier = req.body?.username || req.body?.identifier || req.body?.email;
    const result = await userLogin({ identifier, password: req.body?.password || '' });
    if (!result.user?.is_admin) return res.status(403).json({ error: 'admin only' });
    res.json(result);
  } catch (err) { next(err); }
});

adminRouter.use(authRequired, adminRequired);

adminRouter.get('/progression/thresholds', async (_req, res, next) => {
  try {
    res.json(await getThresholdRows({ includeDisabled: true }));
  } catch (err) { next(err); }
});

adminRouter.put('/progression/thresholds/:feature', async (req, res, next) => {
  try {
    const feature = cleanText(req.params.feature, 80);
    const requiredGamesRaw = req.body?.requiredGames ?? req.body?.required_games;
    const requiredGames = requiredGamesRaw === undefined ? null : intParam(requiredGamesRaw, 0, 0, 100000);
    const enabled = req.body?.enabled === undefined ? null : !!req.body.enabled;
    const r = await query(
      `INSERT INTO unlock_thresholds (feature, required_games, enabled, updated_at)
       VALUES ($1, COALESCE($2, 0), COALESCE($3, TRUE), now())
       ON CONFLICT (feature) DO UPDATE
         SET required_games = COALESCE($2, unlock_thresholds.required_games),
             enabled = COALESCE($3, unlock_thresholds.enabled),
             updated_at = now()
       RETURNING feature, required_games, enabled, updated_at`,
      [feature, requiredGames, enabled]
    );
    clearThresholdCache();
    await audit(req, 'progression_threshold_update', null, { feature, requiredGames, enabled });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.get('/progression/analytics', async (_req, res, next) => {
  try {
    const [totalUsers, byFeature, distribution] = await Promise.all([
      query('SELECT COUNT(*)::int AS total FROM users'),
      query(
        `SELECT feature,
                COUNT(*)::int AS unlocked_users,
                COALESCE(ROUND(AVG(games_played_at_unlock)::numeric, 2), 0)::float AS avg_games
           FROM feature_unlocks
          GROUP BY feature
          ORDER BY avg_games ASC, feature ASC`
      ),
      query(
        `SELECT CASE
                  WHEN games_played >= 30 THEN '30+'
                  WHEN games_played >= 20 THEN '20-29'
                  WHEN games_played >= 15 THEN '15-19'
                  WHEN games_played >= 10 THEN '10-14'
                  WHEN games_played >= 5 THEN '5-9'
                  WHEN games_played >= 3 THEN '3-4'
                  ELSE '0-2'
                END AS bucket,
                COUNT(*)::int AS users
           FROM users
          GROUP BY bucket
          ORDER BY MIN(games_played) ASC`
      ),
    ]);
    res.json({
      totalUsers: Number(totalUsers.rows[0]?.total || 0),
      features: byFeature.rows,
      distribution: distribution.rows,
    });
  } catch (err) { next(err); }
});

adminRouter.get('/me', async (req, res) => {
  res.json({
    ...req.user,
    role: req.user.admin_role || (req.user.is_admin ? 'super_admin' : 'player'),
    permissions: req.user.permissions || [],
  });
});

adminRouter.put('/me/password', async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 4 || newPassword.length > 128) {
      return res.status(400).json({ error: 'new password must be 4-128 characters' });
    }
    if (newPassword !== String(req.body?.confirmPassword || '')) {
      return res.status(400).json({ error: 'password confirmation does not match' });
    }
    const r = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const passwordHash = r.rows[0]?.password_hash || '';
    const ok = passwordHash ? await verifyPassword(currentPassword, passwordHash) : false;
    if (!ok) return res.status(401).json({ error: 'current password is wrong' });
    const nextHash = await hashPassword(newPassword);
    await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [nextHash, req.user.id]);
    await audit(req, 'admin_password_changed', req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

async function audit(req, action, targetId, metadata = null) {
  const target = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(targetId || ''))
    ? targetId
    : null;
  const meta = target === targetId ? metadata : { ...(metadata || {}), targetId: targetId ?? null };
  await query(
    'INSERT INTO audit_log (admin_id, action, target_id, metadata) VALUES ($1, $2, $3, $4)',
    [req.user.id, action, target, meta]
  );
}

adminRouter.use((req, _res, next) => {
  req.adminAudit = (action, targetId, metadata = null) => audit(req, action, targetId, metadata);
  next();
});

adminRouter.use(enforceAdminRoutePermission);

adminRouter.post('/assets/upload', async (req, res, next) => {
  try {
    const saved = await saveAdminAsset({
      dataUrl: req.body?.dataUrl || req.body?.data_url,
      filename: req.body?.filename,
      category: req.body?.category || 'catalog',
    });
    await audit(req, 'admin_asset_upload', null, saved);
    res.status(201).json(saved);
  } catch (err) { next(err); }
});

adminRouter.get('/production/reset-preview', async (_req, res, next) => {
  try {
    res.json(await productionResetPreview());
  } catch (err) { next(err); }
});

adminRouter.post('/production/reset', async (req, res, next) => {
  try {
    const result = await runProductionReset({
      confirmation: String(req.body?.confirmation || ''),
      adminId: req.user?.id,
    });
    await writeEvent('warn', 'production', 'Production data reset completed', {
      before: result.before,
      after: result.after,
      confirmation: PRODUCTION_RESET_CONFIRMATION,
    });
    res.json(result);
  } catch (err) { next(err); }
});

adminRouter.get('/roles', async (_req, res, next) => {
  try {
    const [roles, counts] = await Promise.all([
      query('SELECT role, permissions, updated_at FROM admin_role_permissions ORDER BY role ASC'),
      query('SELECT admin_role AS role, COUNT(*)::int AS admins FROM users WHERE is_admin = TRUE GROUP BY admin_role'),
    ]);
    const countMap = new Map(counts.rows.map((row) => [row.role, row.admins]));
    res.json(roles.rows.map((row) => ({
      ...row,
      adminCount: countMap.get(row.role) || 0,
    })));
  } catch (err) { next(err); }
});

adminRouter.put('/roles/:role', async (req, res, next) => {
  try {
    const role = cleanText(req.params.role, 32);
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : [];
    if (!role) return res.status(400).json({ error: 'role required' });
    if (role === 'owner' && !permissions.includes('*')) permissions.unshift('*');
    const r = await query(
      `INSERT INTO admin_role_permissions (role, permissions, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now()
       RETURNING role, permissions, updated_at`,
      [role, JSON.stringify(permissions)]
    );
    await audit(req, 'admin_role_update', null, { role, permissions });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.use('/stickers', createAdminStickersRouter());

adminRouter.post('/stickers/:id/toggle', async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE stickers
          SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END,
              updated_at = now()
        WHERE id = $1
        RETURNING id, unique_id, name, image_url, rarity, type, status, price_gold, price_uzs, sold_count, created_at, updated_at`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'sticker not found' });
    await audit(req, 'sticker_toggle', req.params.id, { status: r.rows[0].status });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.get('/stickers/:id/owners', async (req, res, next) => {
  try {
    const sticker = await query('SELECT unique_id FROM stickers WHERE id = $1', [req.params.id]);
    if (!sticker.rows[0]) return res.status(404).json({ error: 'sticker not found' });
    const r = await query(
      `SELECT u.id, u.username, u.email, i.quantity, i.obtained_at
         FROM inventory i
         JOIN users u ON u.id = i.user_id
        WHERE i.item_type = 'sticker' AND i.item_id = $1
        ORDER BY i.obtained_at DESC
        LIMIT 200`,
      [sticker.rows[0].unique_id]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.post('/stickers/upload-svg', async (req, res, next) => {
  try {
    const filename = cleanText(req.body?.filename || `sticker-${Date.now()}.svg`, 80).replace(/[^a-zA-Z0-9_.-]/g, '-');
    const svg = String(req.body?.svg || req.body?.content || '');
    if (!svg.includes('<svg')) return res.status(400).json({ error: 'valid svg content required' });
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const targetDir = path.resolve(process.cwd(), '..', 'web-client', 'public', 'stickers');
    await fs.mkdir(targetDir, { recursive: true });
    const target = path.join(targetDir, filename.endsWith('.svg') ? filename : `${filename}.svg`);
    await fs.writeFile(target, svg, 'utf8');
    res.json({ ok: true, path: `/stickers/${path.basename(target)}` });
  } catch (err) { next(err); }
});

// PRO: live scaling diagnostics — surfaces Redis adapter status, instance
// id, and total instance count so the admin dashboard can show the live
// scaling badge.
adminRouter.get('/scaling', async (_req, res, next) => {
  try {
    const mode = scalingMode();
    const online = await countOnline();
    res.json({ ...mode, onlineFromRedis: online });
  } catch (err) { next(err); }
});

adminRouter.get('/dashboard/stats', async (_req, res, next) => {
  try {
    const [users, newUsers, games, revenue, online, topPlayers, settings] = await Promise.all([
      query('SELECT COUNT(*)::int AS total FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE'),
      query("SELECT COUNT(*)::int AS total FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE AND created_at >= date_trunc('day', now())"),
      query(`SELECT COUNT(*) FILTER (WHERE ended_at IS NULL)::int AS active,
                    COUNT(*) FILTER (WHERE started_at >= date_trunc('day', now()))::int AS today
               FROM games`),
      query(`SELECT COALESCE(SUM(amount),0)::bigint AS coins
               FROM transactions
              WHERE type IN ('purchase','admin_purchase','gold_convert')
                AND amount > 0
                AND created_at >= date_trunc('day', now())`),
      query("SELECT COUNT(*)::int AS total FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE AND updated_at > now() - INTERVAL '5 minutes'"),
      query(`SELECT id, username, avatar_url, games_won, rank_wins, coins, gold_coins
               FROM users
              WHERE is_banned = FALSE AND is_admin IS NOT TRUE AND is_bot IS NOT TRUE
              ORDER BY games_won DESC, rank_wins DESC
              LIMIT 5`),
      query('SELECT key, value FROM admin_settings'),
    ]);
    const settingsMap = Object.fromEntries(settings.rows.map((row) => [row.key, row.value]));
    res.json({
      totalUsers: users.rows[0].total,
      activeGames: games.rows[0].active,
      onlineNow: online.rows[0].total,
      revenueToday: Number(revenue.rows[0].coins),
      newUsersToday: newUsers.rows[0].total,
      gamesPlayedToday: games.rows[0].today,
      topPlayers: topPlayers.rows,
      server: {
        status: 'stable',
        redis: 'connected',
        db: 'connected',
        uptimeSeconds: Math.floor(process.uptime()),
        instance: scalingMode().instanceId,
      },
      settings: settingsMap,
    });
  } catch (err) { next(err); }
});

adminRouter.get('/dashboard/events', async (req, res, next) => {
  try {
    const limit = intParam(req.query.limit, 50, 1, 100);
    const r = await query(
      `SELECT id, level, category, message, metadata, created_at
         FROM admin_events
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.get('/dashboard/charts', async (_req, res, next) => {
  try {
    const days = await query(
      `WITH d AS (
         SELECT generate_series(current_date - interval '29 days', current_date, interval '1 day')::date AS day
       )
       SELECT d.day::text,
              COUNT(DISTINCT u.id)::int AS active_users,
              COUNT(g.id)::int AS games,
              COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0),0)::bigint AS revenue
         FROM d
         LEFT JOIN users u ON u.updated_at::date = d.day AND u.is_admin IS NOT TRUE AND u.is_bot IS NOT TRUE
         LEFT JOIN games g ON g.started_at::date = d.day
         LEFT JOIN transactions t ON t.created_at::date = d.day AND t.type IN ('purchase','admin_purchase','gold_convert')
        GROUP BY d.day
        ORDER BY d.day ASC`
    );
    res.json({
      dailyActiveUsers: days.rows.map((r) => ({ date: r.day, value: Number(r.active_users) })),
      games: days.rows.slice(-7).map((r) => ({ date: r.day, value: Number(r.games) })),
      revenue: days.rows.map((r) => ({ date: r.day, value: Number(r.revenue) })),
    });
  } catch (err) { next(err); }
});

adminRouter.get('/realtime/ping', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  let closed = false;
  req.on('close', () => { closed = true; });
  const send = async () => {
    if (closed) return;
    const online = await countOnline().catch(() => null);
    res.write(`event: ping\n`);
    res.write(`data: ${JSON.stringify({ ts: Date.now(), onlineNow: online })}\n\n`);
  };
  await send();
  const timer = setInterval(send, 5000);
  req.on('close', () => clearInterval(timer));
});

// PRO: admin event feed — backs the live event panel on the dashboard.
adminRouter.get('/events', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const category = req.query.category ? String(req.query.category) : null;
    const params = category ? [limit, category] : [limit];
    const where = category ? 'WHERE category = $2' : '';
    const r = await query(
      `SELECT id, level, category, message, metadata, created_at
         FROM admin_events ${where}
         ORDER BY created_at DESC LIMIT $1`,
      params
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// PRO: Room Monitor — list every live room (across instances when Redis
// is enabled; otherwise just the local manager).
adminRouter.get('/rooms', async (_req, res, next) => {
  try {
    const localMgr = getRoomManager();
    const now = Date.now();
    const instance = scalingMode().instanceId;
    const local = localMgr ? Array.from(localMgr.rooms.values())
      .map((r) => normalizeAdminRoom({
        code: r.code,
        phase: r.state.phase,
        mode: r.mode,
        stake: r.stake,
        maxPlayers: r.maxPlayers,
        realPlayers: r.seats.filter((s) => s && !s.isBot).length,
        bots: r.seats.filter((s) => s && s.isBot).length,
        host: r.host?.username,
        isPrivate: r.isPrivate,
        bluffEnabled: r.bluffEnabled,
        instance,
        updatedAt: now,
      }, { now, instance }))
      .filter(Boolean) : [];
    const remote = (await listAllRooms().catch(() => []))
      .map((room) => normalizeAdminRoom(room, { now, instance }))
      .filter(Boolean);
    // Dedupe by code; local wins.
    const seen = new Set(local.map((r) => r.code));
    const merged = local.concat(remote.filter((r) => !seen.has(r.code)));
    res.json(merged.filter((room) => isVisibleAdminRoom(room, now)));
  } catch (err) { next(err); }
});

adminRouter.post('/rooms/cleanup-stale', async (req, res, next) => {
  try {
    const mgr = getRoomManager();
    const now = Date.now();
    const rooms = mgr ? Array.from(mgr.rooms.values()) : [];
    const removed = new Set();
    for (const room of rooms) {
      const hasHumans = room.seats?.some((s) => s && !s.isBot);
      if (room.state?.phase === 'ended' || !hasHumans) {
        mgr.destroy(room.code);
        await unregisterRoom(room.code);
        removed.add(room.code);
      }
    }
    const remote = await listAllRooms().catch(() => []);
    for (const raw of remote) {
      const room = normalizeAdminRoom(raw, { now });
      if (!room) continue;
      if (!isVisibleAdminRoom(room, now)) {
        await unregisterRoom(room.code);
        removed.add(room.code);
      }
    }
    const removedList = Array.from(removed);
    await audit(req, 'room_cleanup_stale', null, { removed: removedList });
    await writeEvent('info', 'room', `Stale rooms cleaned: ${removedList.length}`, { removed: removedList });
    res.json({ ok: true, removed: removedList, count: removedList.length });
  } catch (err) { next(err); }
});

adminRouter.get('/rooms/:code', async (req, res, next) => {
  try {
    const mgr = getRoomManager();
    const room = mgr?.get(req.params.code);
    if (!room) return res.status(404).json({ error: 'room not found (or on another instance)' });
    res.json({
      code: room.code,
      phase: room.state.phase,
      trump: room.gameState?.trump,
      deckLeft: room.gameState?.deck?.length,
      turnDeadline: room.turnDeadline,
      seats: room.seats.map((s) => s ? {
        id: s.id, username: s.username, isBot: !!s.isBot, handSize: s.hand?.length,
      } : null),
      table: room.gameState?.table,
    });
  } catch (err) { next(err); }
});

adminRouter.post('/rooms/:code/close', async (req, res, next) => {
  try {
    const mgr = getRoomManager();
    const room = mgr?.get(req.params.code);
    if (!room) return res.status(404).json({ error: 'room not found' });
    // Refund any charged stakes (best-effort).
    for (const id of room.stakeChargedHumanIds || []) {
      try { await changeCoins(id, room.stake, 'stake_refund', null, { roomCode: room.code, reason: 'admin_force_close' }); }
      catch (_) { /* ignore */ }
    }
    room.cleanup?.();
    mgr.destroy(room.code);
    await audit(req, 'room_force_close', room.code, { stake: room.stake });
    await query(
      `INSERT INTO admin_events (level, category, message, metadata)
       VALUES ('warn', 'room', $1, $2)`,
      [`Room ${room.code} force-closed`, { code: room.code, stake: room.stake }]
    ).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.delete('/rooms/:code', async (req, res, next) => {
  try {
    const mgr = getRoomManager();
    const room = mgr?.get(req.params.code);
    if (!room) return res.status(404).json({ error: 'room not found' });
    for (const id of room.stakeChargedHumanIds || []) {
      try { await changeCoins(id, room.stake, 'stake_refund', null, { roomCode: room.code, reason: 'admin_force_close' }); }
      catch (_) { /* ignore */ }
    }
    room.cleanup?.();
    mgr.destroy(room.code);
    await audit(req, 'room_force_close', room.code, { stake: room.stake });
    await writeEvent('warn', 'room', `Room ${room.code} force-closed`, { code: room.code, stake: room.stake });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/rooms/:code/kick/:userId', async (req, res, next) => {
  try {
    const mgr = getRoomManager();
    const room = mgr?.get(req.params.code);
    if (!room) return res.status(404).json({ error: 'room not found' });
    const userId = String(req.params.userId);
    const seat = room.seats.find((s) => s && String(s.id) === userId);
    if (!seat) return res.status(404).json({ error: 'player not in room' });
    room.seats = room.seats.map((s) => (s && String(s.id) === userId ? null : s));
    await audit(req, 'room_kick_player', userId, { roomCode: room.code });
    await writeEvent('warn', 'room', `Player kicked from room ${room.code}`, { roomCode: room.code, userId });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.get('/games/history', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req, 25);
    const r = await query(
      `SELECT id, room_code, mode, stake, player_ids, winner_id, loser_id, is_draw, started_at, ended_at
         FROM games
        ORDER BY started_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = await query('SELECT COUNT(*)::int AS total FROM games');
    res.json({ data: r.rows, pagination: { page, limit, total: total.rows[0].total, pages: Math.max(1, Math.ceil(total.rows[0].total / limit)) } });
  } catch (err) { next(err); }
});

adminRouter.get('/games/stats', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS total_games,
              COUNT(*) FILTER (WHERE ended_at IS NULL)::int AS active_games,
              ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL))::int AS avg_duration_seconds,
              COUNT(*) FILTER (WHERE is_draw = TRUE)::int AS draws
         FROM games`
    );
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.get('/games/:id', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'game not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// PRO: Bracket engine — seed, view, advance, auto-settle.
adminRouter.get('/tournaments/:id/bracket', async (req, res, next) => {
  try {
    const snap = await withTransaction((client) => bracketSnapshot(client, req.params.id));
    if (!snap) return res.status(404).json({ error: 'tournament not found' });
    res.json(snap);
  } catch (err) { next(err); }
});

adminRouter.post('/tournaments/:id/seed', async (req, res, next) => {
  try {
    const result = await seedBracket(req.params.id);
    await audit(req, 'bracket_seed', req.params.id, result);
    await query(
      `INSERT INTO admin_events (level, category, message, metadata)
       VALUES ('info', 'bracket', $1, $2)`,
      [`Bracket seeded (${result.slots} slots, ${result.rounds} rounds)`, result]
    ).catch(() => {});
    res.json(result);
  } catch (err) { next(err); }
});

adminRouter.post('/tournaments/matches/:matchId/result', async (req, res, next) => {
  try {
    const winnerEntryId = String(req.body?.winnerEntryId || '');
    const result = await recordMatchResult({ matchId: req.params.matchId, winnerEntryId });
    await audit(req, 'bracket_result', req.params.matchId, result);
    res.json(result);
  } catch (err) { next(err); }
});

adminRouter.post('/tournaments/:id/auto-settle', async (req, res, next) => {
  try {
    const payouts = await payoutPlacements(req.params.id);
    await audit(req, 'bracket_auto_settle', req.params.id, { payouts });
    res.json({ ok: true, payouts });
  } catch (err) { next(err); }
});

adminRouter.get('/stats', async (_req, res, next) => {
  try {
    const [users, games, txs, online] = await Promise.all([
      query('SELECT COUNT(*)::int AS c FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE'),
      query('SELECT COUNT(*)::int AS c, COUNT(*) FILTER (WHERE ended_at IS NULL)::int AS active FROM games'),
      query("SELECT COALESCE(SUM(amount),0)::bigint AS total FROM transactions WHERE type = 'purchase' AND amount > 0"),
      query("SELECT COUNT(*)::int AS c FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE AND updated_at > now() - INTERVAL '5 minutes'"),
    ]);
    res.json({
      users: users.rows[0].c,
      games: games.rows[0].c,
      activeGames: games.rows[0].active,
      coinsPurchased: Number(txs.rows[0].total),
      onlineApprox: online.rows[0].c,
    });
  } catch (err) { next(err); }
});

adminRouter.get('/economy', async (_req, res, next) => {
  try {
    const [
      balances,
      dollarLedger,
      goldLedger,
      donations,
      tournamentPayouts,
      recentDollarTx,
      recentGoldTx,
    ] = await Promise.all([
      query(`SELECT COALESCE(SUM(coins),0)::bigint AS dollars,
                    COALESCE(SUM(gold_coins),0)::bigint AS gold
               FROM users`),
      query(`SELECT type, COALESCE(SUM(amount),0)::bigint AS amount, COUNT(*)::int AS count
               FROM transactions
              GROUP BY type
              ORDER BY abs(COALESCE(SUM(amount),0)) DESC`),
      query(`SELECT type, COALESCE(SUM(amount),0)::bigint AS amount, COUNT(*)::int AS count
               FROM gold_transactions
              GROUP BY type
              ORDER BY abs(COALESCE(SUM(amount),0)) DESC`),
      query(`SELECT COALESCE(SUM(amount_usd_cents) FILTER (WHERE is_fake = FALSE),0)::bigint AS real_cents,
                    COUNT(*) FILTER (WHERE is_fake = FALSE)::int AS real_count,
                    COUNT(*) FILTER (WHERE is_fake = TRUE)::int AS fake_count
               FROM donations`),
      query(`SELECT COALESCE(SUM(gold_coins),0)::bigint AS gold,
                    COUNT(*)::int AS count
               FROM tournament_payouts`),
      query(`SELECT id, user_id, amount, type, metadata, created_at
               FROM transactions
              ORDER BY created_at DESC
              LIMIT 25`),
      query(`SELECT id, user_id, amount, type, metadata, created_at
               FROM gold_transactions
              ORDER BY created_at DESC
              LIMIT 25`),
    ]);
    res.json({
      balances: {
        dollars: Number(balances.rows[0].dollars),
        gold: Number(balances.rows[0].gold),
      },
      donations: {
        realUsd: Number(donations.rows[0].real_cents) / 100,
        realCount: Number(donations.rows[0].real_count),
        fakeCount: Number(donations.rows[0].fake_count),
      },
      tournamentPayouts: {
        gold: Number(tournamentPayouts.rows[0].gold),
        count: Number(tournamentPayouts.rows[0].count),
      },
      dollarLedger: dollarLedger.rows,
      goldLedger: goldLedger.rows,
      recentDollarTx: recentDollarTx.rows,
      recentGoldTx: recentGoldTx.rows,
    });
  } catch (err) { next(err); }
});

adminRouter.get('/economy/overview', async (_req, res, next) => {
  try {
    const [balances, spent, topSpenders, coinFlow, goldFlow] = await Promise.all([
      query(`SELECT COALESCE(SUM(coins),0)::bigint AS total_coins,
                    COALESCE(SUM(gold_coins),0)::bigint AS total_gold
               FROM users WHERE is_bot IS NOT TRUE`),
      query(`SELECT COALESCE(SUM(ABS(amount)),0)::bigint AS spent
               FROM transactions
               WHERE amount < 0`),
      query(`SELECT u.id, u.username, COALESCE(SUM(ABS(t.amount)),0)::bigint AS spent
               FROM transactions t
               JOIN users u ON u.id = t.user_id
               WHERE t.amount < 0 AND u.is_bot IS NOT TRUE
               GROUP BY u.id, u.username
               ORDER BY spent DESC
               LIMIT 10`),
      query(
        `SELECT
            COALESCE(SUM(CASE WHEN type IN ('game_win','win','daily_reward','daily','ad_bonus','ad','referral_bonus','referral','admin_grant','admin') AND amount > 0 THEN amount ELSE 0 END),0)::bigint AS total_coins_awarded,
            COALESCE(SUM(CASE WHEN type IN ('stake','shop_purchase','purchase') OR amount < 0 THEN ABS(amount) ELSE 0 END),0)::bigint AS total_coins_spent,
            COUNT(DISTINCT user_id)::int AS unique_transacting_users
           FROM transactions
          WHERE created_at > now() - interval '30 days'`
      ),
      query(
        `SELECT
            COALESCE(SUM(amount) FILTER (WHERE amount > 0),0)::bigint AS total_gold_granted,
            COALESCE(SUM(ABS(amount)) FILTER (WHERE amount < 0),0)::bigint AS total_gold_spent,
            COUNT(DISTINCT user_id)::int AS unique_gold_users
           FROM gold_transactions
          WHERE created_at > now() - interval '30 days'`
      ),
    ]);
    res.json({
      totalCoins: Number(balances.rows[0].total_coins),
      totalGold: Number(balances.rows[0].total_gold),
      totalSpent: Number(spent.rows[0].spent),
      totalCoinsAwarded30d: Number(coinFlow.rows[0].total_coins_awarded),
      totalCoinsSpent30d: Number(coinFlow.rows[0].total_coins_spent),
      uniqueTransactingUsers30d: Number(coinFlow.rows[0].unique_transacting_users),
      totalGoldGranted30d: Number(goldFlow.rows[0].total_gold_granted),
      totalGoldSpent30d: Number(goldFlow.rows[0].total_gold_spent),
      uniqueGoldUsers30d: Number(goldFlow.rows[0].unique_gold_users),
      topSpenders: topSpenders.rows.map((r) => ({ ...r, spent: Number(r.spent) })),
    });
  } catch (err) { next(err); }
});

adminRouter.get('/economy/transactions', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req, 25);
    const type = cleanText(req.query.type, 32);
    const userId = cleanText(req.query.userId, 64);
    const where = [];
    const params = [];
    if (type) { params.push(type); where.push(`t.type = $${params.length}`); }
    if (userId) { params.push(userId); where.push(`t.user_id = $${params.length}`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await query(
      `SELECT t.id, t.user_id, u.username, t.amount, t.type, t.metadata, t.created_at, 'coins' AS currency
         FROM transactions t
         LEFT JOIN users u ON u.id = t.user_id
         ${clause}
        ORDER BY t.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const total = await query(`SELECT COUNT(*)::int AS total FROM transactions t ${clause}`, params);
    res.json({ data: r.rows, pagination: { page, limit, total: total.rows[0].total, pages: Math.max(1, Math.ceil(total.rows[0].total / limit)) } });
  } catch (err) { next(err); }
});

adminRouter.post('/economy/airdrop', async (req, res, next) => {
  try {
    const currency = req.body?.currency === 'gold' ? 'gold' : 'coins';
    const amount = Math.floor(Number(req.body?.amount) || 0);
    const reason = cleanText(req.body?.reason || 'airdrop', 300);
    if (!amount) return res.status(400).json({ error: 'amount required' });
    let userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String).filter(Boolean) : [];
    if (!userIds.length || req.body?.target === 'all_active') {
      const r = await query("SELECT id FROM users WHERE is_banned = FALSE AND updated_at > now() - INTERVAL '30 days' LIMIT 1000");
      userIds = r.rows.map((row) => row.id);
    }
    for (const userId of userIds) {
      if (currency === 'gold') await changeGoldCoins(userId, amount, 'admin_airdrop', null, { adminId: req.user.id, reason });
      else await changeCoins(userId, amount, 'admin_airdrop', null, { adminId: req.user.id, reason });
    }
    await audit(req, 'economy_airdrop', null, { count: userIds.length, amount, currency, reason });
    await writeEvent('info', 'economy', `Airdrop sent to ${userIds.length} users`, { amount, currency });
    res.json({ ok: true, affected: userIds.length });
  } catch (err) { next(err); }
});

adminRouter.get('/economy/shop-stats', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT id AS item_id, item_type, name,
              price_coins, price_gold, enabled,
              0::bigint AS sold,
              0::bigint AS revenue
         FROM admin_items
        ORDER BY item_type, name`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.put('/economy/prices', async (req, res, next) => {
  try {
    const itemId = cleanText(req.body?.itemId, 64);
    if (!itemId) return res.status(400).json({ error: 'itemId required' });
    const priceCoins = req.body?.newPrice === undefined ? req.body?.priceCoins : req.body.newPrice;
    const priceGold = req.body?.priceGold ?? null;
    const r = await query(
      `UPDATE admin_items
          SET price_coins = COALESCE($2, price_coins),
              price_gold = COALESCE($3, price_gold),
              updated_at = now()
        WHERE id = $1
        RETURNING id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_at`,
      [itemId, priceCoins === null ? null : intParam(priceCoins, 0, 0, 1000000000), priceGold === null ? null : intParam(priceGold, 0, 0, 1000000000)]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'item not found' });
    await audit(req, 'economy_price_update', null, { itemId, priceCoins, priceGold });
    res.json(toCamelItem(r.rows[0]));
  } catch (err) { next(err); }
});

adminRouter.get('/users', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req, 25);
    const q = String(req.query.q || req.query.search || '').trim().replace(/^@+/, '');
    const status = cleanText(req.query.status, 24);
    const role = cleanText(req.query.role, 24);
    // Escape LIKE wildcards so the search is a literal substring match,
    // not a pattern. Without this, `%` or `_` in the query become wildcards.
    const escaped = q.replace(/[%_\\]/g, '\\$&');
    const whereParts = [];
    const values = [];
    if (q) {
      values.push(`%${escaped}%`);
      whereParts.push(`(
        lower(username) LIKE lower($${values.length}) ESCAPE '\\'
        OR lower(COALESCE(nickname, '')) LIKE lower($${values.length}) ESCAPE '\\'
        OR lower(COALESCE(email, '')) LIKE lower($${values.length}) ESCAPE '\\'
      )`);
    }
    if (status === 'banned') whereParts.push('is_banned = TRUE');
    if (status === 'active') whereParts.push('is_banned = FALSE');
    if (role === 'admin') whereParts.push('is_admin = TRUE');
    else if (role === 'player') whereParts.push('is_admin = FALSE AND is_bot IS NOT TRUE');
    else if (role) {
      values.push(role);
      whereParts.push(`admin_role = $${values.length}`);
    } else if (req.query.includeAdmins !== '1') {
      whereParts.push('is_admin = FALSE AND is_bot IS NOT TRUE');
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const r = await query(
      `SELECT id, username, nickname, email, avatar_url, coins, gold_coins, rank_wins, games_played, games_won,
              is_admin, admin_role, is_banned, banned_reason, banned_until,
              is_muted, muted_until, muted_reason, premium_until, created_at, updated_at
         FROM users ${where}
         ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    const total = await query(`SELECT COUNT(*)::int AS total FROM users ${where}`, values);
    res.json({
      data: r.rows,
      pagination: { page, limit, total: total.rows[0]?.total || 0, pages: Math.max(1, Math.ceil((total.rows[0]?.total || 0) / limit)) },
    });
  } catch (err) { next(err); }
});

adminRouter.get('/users/:id', async (req, res, next) => {
  try {
    const [user, inventory, tx, goldTx, games, sessions] = await Promise.all([
      query(`SELECT id, username, nickname, email, avatar_url, coins, gold_coins, rank_wins,
                    games_played, games_won, games_lost, games_draw, win_streak, loss_streak,
                    is_admin, admin_role, is_banned, banned_reason, banned_until,
                    is_muted, muted_until, muted_reason, last_ip, device_id,
                    premium_until, selected_skin, selected_avatar_frame, created_at, updated_at
               FROM users WHERE id = $1`, [req.params.id]),
      query(`SELECT item_type, item_id, quantity, obtained_at FROM inventory WHERE user_id = $1 ORDER BY obtained_at DESC LIMIT 100`, [req.params.id]).catch(() => ({ rows: [] })),
      query(`SELECT id, amount, type, metadata, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.params.id]),
      query(`SELECT id, amount, type, metadata, created_at FROM gold_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.params.id]).catch(() => ({ rows: [] })),
      query(`SELECT id, room_code, mode, stake, winner_id, loser_id, is_draw, started_at, ended_at
               FROM games WHERE $1 = ANY(player_ids) ORDER BY started_at DESC LIMIT 50`, [req.params.id]).catch(() => ({ rows: [] })),
      query(`SELECT id, created_at, updated_at FROM users WHERE id = $1`, [req.params.id]).catch(() => ({ rows: [] })),
    ]);
    if (!user.rows[0]) return res.status(404).json({ error: 'user not found' });
    res.json({
      user: user.rows[0],
      inventory: inventory.rows,
      transactions: tx.rows,
      goldTransactions: goldTx.rows,
      games: games.rows,
      sessions: sessions.rows.map((row) => ({ id: `session-${row.id}`, createdAt: row.created_at, lastSeenAt: row.updated_at, status: 'active' })),
    });
  } catch (err) { next(err); }
});

adminRouter.put('/users/:id', async (req, res, next) => {
  try {
    const username = cleanText(req.body?.username, 32);
    const email = cleanText(req.body?.email, 255) || null;
    const isAdmin = !!req.body?.isAdmin || !!req.body?.is_admin;
    if (!username) return res.status(400).json({ error: 'username required' });
    const r = await query(
      `UPDATE users
          SET username = $2,
              nickname = COALESCE(nickname, $2),
              email = $3,
              is_admin = $4
        WHERE id = $1
        RETURNING id, username, email, is_admin, is_banned, coins, gold_coins, updated_at`,
      [req.params.id, username, email, isAdmin]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'user not found' });
    await audit(req, 'user_update', req.params.id, { username, email, isAdmin });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// TOR §14: ban for a duration (one_month / three_months / six_months /
// one_year / permanent). Default permanent if no duration provided. Old
// callers that just sent { reason } continue to get a permanent ban.
adminRouter.post('/users/:id/ban', async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').slice(0, 500);
    let key = req.body?.duration || null;
    if (!key && req.body?.duration_hours !== undefined) {
      const hours = Math.floor(Number(req.body.duration_hours));
      if (hours > 0 && hours <= 24 * 31) key = 'one_month';
      else if (hours > 24 * 31 && hours <= 24 * 92) key = 'three_months';
      else if (hours > 24 * 92 && hours <= 24 * 186) key = 'six_months';
      else if (hours > 24 * 186) key = 'one_year';
    }
    if (key && !(key in config.game.banDurations)) {
      return res.status(400).json({ error: 'invalid duration' });
    }
    const r = await adminBanUser({ adminId: req.user.id, userId: req.params.id, key, reason });
    await audit(req, 'ban', req.params.id, { reason, duration: key, bannedUntil: r.bannedUntil });
    res.json(r);
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/unban', async (req, res, next) => {
  try {
    await adminUnbanUser({ userId: req.params.id });
    await audit(req, 'unban', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// TOR §15: admins can gift Gold Coins / Durak Dollars to a user.
adminRouter.post('/users/:id/mute', async (req, res, next) => {
  try {
    const reason = cleanText(req.body?.reason || 'admin mute', 500);
    const minutesRaw = Math.floor(Number(req.body?.minutes ?? req.body?.durationMinutes ?? 60));
    const minutes = Math.max(1, Math.min(minutesRaw, 60 * 24 * 365));
    const r = await query(
      `UPDATE users
          SET is_muted = TRUE,
              muted_until = now() + ($2 || ' minutes')::interval,
              muted_reason = $3
        WHERE id = $1
        RETURNING id, username, nickname, is_muted, muted_until, muted_reason`,
      [req.params.id, String(minutes), reason]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'user not found' });
    await audit(req, 'mute', req.params.id, { reason, minutes });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/unmute', async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE users
          SET is_muted = FALSE,
              muted_until = NULL,
              muted_reason = NULL
        WHERE id = $1
        RETURNING id, username, nickname, is_muted, muted_until, muted_reason`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'user not found' });
    await audit(req, 'unmute', req.params.id);
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.put('/users/:id/role', async (req, res, next) => {
  try {
    const role = cleanText(req.body?.role || 'player', 32);
    const exists = await query('SELECT 1 FROM admin_role_permissions WHERE role = $1', [role]);
    if (!exists.rows[0]) return res.status(400).json({ error: 'unknown role' });
    const r = await query(
      `UPDATE users
          SET admin_role = $2,
              is_admin = ($2 <> 'player')
        WHERE id = $1
        RETURNING id, username, nickname, is_admin, admin_role`,
      [req.params.id, role]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'user not found' });
    await audit(req, 'admin_role_assign', req.params.id, { role });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/gift', async (req, res, next) => {
  try {
    const dollars = Math.floor(Number(req.body?.coins) || 0);
    const gold = Math.floor(Number(req.body?.goldCoins) || 0);
    if (!dollars && !gold) return res.status(400).json({ error: 'coins or goldCoins required' });
    let coinsBal = null;
    let goldBal = null;
    if (dollars) coinsBal = await changeCoins(req.params.id, dollars, 'admin_gift', null, { adminId: req.user.id });
    if (gold) goldBal = await changeGoldCoins(req.params.id, gold, 'admin_gift', null, { adminId: req.user.id });
    await audit(req, 'admin_gift', req.params.id, { dollars, gold });
    res.json({ ok: true, coins: coinsBal, goldCoins: goldBal });
  } catch (err) { next(err); }
});

// TOR §15: admin overrides for item prices (emoji_pack / card_skin /
// badge / gold_bundle). Setting NULL on a column reverts to code default.
adminRouter.get('/item-prices', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT item_type, item_id, price_coins, price_gold, price_usd, updated_at
         FROM item_price_overrides ORDER BY updated_at DESC`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.post('/item-prices', async (req, res, next) => {
  try {
    const itemType = String(req.body?.itemType || '').slice(0, 32);
    const itemId = String(req.body?.itemId || '').slice(0, 64);
    if (!itemType || !itemId) return res.status(400).json({ error: 'itemType and itemId required' });
    const coins = req.body?.priceCoins === null || req.body?.priceCoins === undefined
      ? null : Math.max(0, Math.floor(Number(req.body.priceCoins)));
    const gold = req.body?.priceGold === null || req.body?.priceGold === undefined
      ? null : Math.max(0, Math.floor(Number(req.body.priceGold)));
    const usd = req.body?.priceUsd === null || req.body?.priceUsd === undefined
      ? null : Math.max(0, Number(req.body.priceUsd));
    await query(
      `INSERT INTO item_price_overrides (item_type, item_id, price_coins, price_gold, price_usd, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (item_type, item_id)
         DO UPDATE SET price_coins = EXCLUDED.price_coins,
                       price_gold  = EXCLUDED.price_gold,
                       price_usd   = EXCLUDED.price_usd,
                       updated_by  = EXCLUDED.updated_by,
                       updated_at  = now()`,
      [itemType, itemId, coins, gold, usd, req.user.id]
    );
    await audit(req, 'price_override', `${itemType}:${itemId}`, { coins, gold, usd });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.delete('/item-prices/:type/:id', async (req, res, next) => {
  try {
    await query(
      `DELETE FROM item_price_overrides WHERE item_type = $1 AND item_id = $2`,
      [String(req.params.type), String(req.params.id)]
    );
    await audit(req, 'price_override_clear', `${req.params.type}:${req.params.id}`);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// TOR §15: admin-managed catalog items (extra emoji packs / card skins
// / badges layered on top of the static catalog).
adminRouter.get('/items', async (req, res, next) => {
  try {
    const type = req.query.type ? String(req.query.type) : null;
    const r = await query(
      `SELECT id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_at
         FROM admin_items ${type ? 'WHERE item_type = $1' : ''}
         ORDER BY created_at DESC`,
      type ? [type] : []
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.post('/items', async (req, res, next) => {
  try {
    const id = String(req.body?.id || '').slice(0, 64);
    const itemType = String(req.body?.itemType || '').slice(0, 32);
    const name = String(req.body?.name || '').slice(0, 120);
    if (!id || !itemType || !name) return res.status(400).json({ error: 'id, itemType, name required' });
    const icon = String(req.body?.icon || '').slice(0, 32) || null;
    const imageUrl = cleanText(req.body?.imageUrl ?? req.body?.image_url, 1000) || null;
    const description = cleanText(req.body?.description, 500) || null;
    const rarity = String(req.body?.rarity || 'common').slice(0, 16);
    const priceCoins = Math.max(0, Math.floor(Number(req.body?.priceCoins) || 0));
    const priceGold = Math.max(0, Math.floor(Number(req.body?.priceGold) || 0));
    await query(
      `INSERT INTO admin_items (id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10, now())
       ON CONFLICT (id) DO UPDATE SET
         item_type = EXCLUDED.item_type,
         name      = EXCLUDED.name,
         icon      = EXCLUDED.icon,
         image_url = EXCLUDED.image_url,
         description = EXCLUDED.description,
         rarity    = EXCLUDED.rarity,
         price_coins = EXCLUDED.price_coins,
         price_gold  = EXCLUDED.price_gold,
         updated_at = now()`,
      [id, itemType, name, icon, imageUrl, description, rarity, priceCoins, priceGold, req.user.id]
    );
    await audit(req, 'item_upsert', id, { itemType, priceCoins, priceGold });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.delete('/items/:id', async (req, res, next) => {
  try {
    await query('UPDATE admin_items SET enabled = FALSE WHERE id = $1', [req.params.id]);
    await audit(req, 'item_disable', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

for (const [routeName, itemType] of Object.entries(CATALOG_TYPES)) {
  if (!itemType) continue;
  adminRouter.get(`/${routeName}`, async (req, res, next) => {
    try { res.json(await listCatalog(itemType, req)); } catch (err) { next(err); }
  });
  adminRouter.post(`/${routeName}`, async (req, res, next) => {
    try {
      const saved = await saveCatalogItem(req, itemType);
      await audit(req, `${routeName}_create`, null, saved);
      res.status(201).json(saved);
    } catch (err) { next(err); }
  });
  adminRouter.put(`/${routeName}/:id`, async (req, res, next) => {
    try {
      const saved = await saveCatalogItem(req, itemType, req.params.id);
      await audit(req, `${routeName}_update`, null, saved);
      res.json(saved);
    } catch (err) { next(err); }
  });
  adminRouter.delete(`/${routeName}/:id`, async (req, res, next) => {
    try {
      await query('DELETE FROM admin_items WHERE id = $1 AND item_type = $2', [req.params.id, itemType]);
      await audit(req, `${routeName}_delete`, null, { id: req.params.id });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
  adminRouter.post(`/${routeName}/:id/toggle`, async (req, res, next) => {
    try {
      const r = await query(
        `UPDATE admin_items
            SET enabled = NOT enabled
          WHERE id = $1 AND item_type = $2
          RETURNING id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_at`,
        [req.params.id, itemType]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'item not found' });
      await audit(req, `${routeName}_toggle`, null, { id: req.params.id, enabled: r.rows[0].enabled });
      res.json(toCamelItem(r.rows[0]));
    } catch (err) { next(err); }
  });
}

adminRouter.get('/chests/opens', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT id, user_id, type, metadata, created_at
         FROM transactions
        WHERE type = 'chest_open'
        ORDER BY created_at DESC
        LIMIT 100`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.get('/tasks/completion-stats', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT item_id AS task_id, COUNT(*)::int AS completed
         FROM inventory
        WHERE item_type = 'task_complete'
        GROUP BY item_id`
    ).catch(() => ({ rows: [] }));
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.get('/shop/items', async (req, res, next) => {
  try { res.json(await listCatalog(null, req)); } catch (err) { next(err); }
});

adminRouter.put('/shop/items/:id', async (req, res, next) => {
  try {
    const r = await query('SELECT item_type FROM admin_items WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'item not found' });
    res.json(await saveCatalogItem(req, r.rows[0].item_type, req.params.id));
  } catch (err) { next(err); }
});

adminRouter.post('/shop/items/:id/toggle', async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE admin_items SET enabled = NOT enabled WHERE id = $1
       RETURNING id, item_type, name, icon, image_url, description, rarity, price_coins, price_gold, enabled, created_at`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'item not found' });
    res.json(toCamelItem(r.rows[0]));
  } catch (err) { next(err); }
});

adminRouter.get('/shop/purchases', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req, 25);
    const r = await query(
      `SELECT t.id, t.user_id, u.username, t.amount, t.type, t.metadata, t.created_at
         FROM transactions t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.type IN ('shop_buy','purchase','gold_convert')
        ORDER BY t.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = await query("SELECT COUNT(*)::int AS total FROM transactions WHERE type IN ('shop_buy','purchase','gold_convert')");
    res.json({ data: r.rows, pagination: { page, limit, total: total.rows[0].total, pages: Math.max(1, Math.ceil(total.rows[0].total / limit)) } });
  } catch (err) { next(err); }
});

// TOR §15: runtime settings (fake bots, fake donations, etc.). Stored as
// JSONB so we can extend the schema without migrations.
adminRouter.get('/settings', async (_req, res, next) => {
  try {
    const r = await query('SELECT key, value, updated_at FROM admin_settings ORDER BY key');
    const map = { ...DEFAULT_SETTINGS };
    for (const row of r.rows) map[row.key] = row.value;
    res.json(map);
  } catch (err) { next(err); }
});

adminRouter.get('/settings/fake-bots', async (_req, res, next) => {
  try { res.json(await readSetting('fake_bots')); } catch (err) { next(err); }
});

adminRouter.put('/settings/fake-bots', async (req, res, next) => {
  try {
    const value = {
      enabled: !!req.body?.enabled,
      count: intParam(req.body?.count, 0, 0, 100),
      level: ['easy', 'medium', 'hard'].includes(req.body?.level) ? req.body.level : 'easy',
    };
    await upsertSetting('fake_bots', value, req.user.id);
    await audit(req, 'setting_update', null, { key: 'fake_bots', value });
    res.json(value);
  } catch (err) { next(err); }
});

adminRouter.get('/settings/maintenance', async (_req, res, next) => {
  try { res.json(await readSetting('maintenance')); } catch (err) { next(err); }
});

adminRouter.put('/settings/maintenance', async (req, res, next) => {
  try {
    const value = { enabled: !!req.body?.enabled, message: cleanText(req.body?.message, 500) };
    await upsertSetting('maintenance', value, req.user.id);
    await audit(req, 'setting_update', null, { key: 'maintenance', value });
    res.json(value);
  } catch (err) { next(err); }
});

adminRouter.get('/settings/game-config', async (_req, res, next) => {
  try { res.json(await readSetting('game_config')); } catch (err) { next(err); }
});

adminRouter.put('/settings/game-config', async (req, res, next) => {
  try {
    const value = {
      startingCards: intParam(req.body?.startingCards, 6, 1, 12),
      maxPlayersPerRoom: intParam(req.body?.maxPlayersPerRoom, 6, 2, 6),
      allowBots: !!req.body?.allowBots,
      voiceChat: !!req.body?.voiceChat,
      turnTimeLimit: intParam(req.body?.turnTimeLimit, 30, 5, 180),
    };
    await upsertSetting('game_config', value, req.user.id);
    await audit(req, 'setting_update', null, { key: 'game_config', value });
    res.json(value);
  } catch (err) { next(err); }
});

adminRouter.get('/settings/fake-donations', async (_req, res, next) => {
  try { res.json(await readSetting('fake_donations')); } catch (err) { next(err); }
});

adminRouter.put('/settings/fake-donations', async (req, res, next) => {
  try {
    const value = { enabled: !!req.body?.enabled, countPerHour: intParam(req.body?.countPerHour ?? req.body?.count, 0, 0, 1000) };
    await upsertSetting('fake_donations', value, req.user.id);
    await audit(req, 'setting_update', null, { key: 'fake_donations', value });
    res.json(value);
  } catch (err) { next(err); }
});

adminRouter.put('/settings/antibot', async (req, res, next) => {
  try {
    const value = { enabled: !!req.body?.enabled, sensitivity: intParam(req.body?.sensitivity, 5, 1, 10) };
    await upsertSetting('antibot', value, req.user.id);
    await audit(req, 'setting_update', null, { key: 'antibot', value });
    res.json(value);
  } catch (err) { next(err); }
});

adminRouter.put('/settings/:key', async (req, res, next) => {
  try {
    const key = String(req.params.key).slice(0, 64);
    if (!key) return res.status(400).json({ error: 'key required' });
    const value = req.body?.value ?? req.body ?? null;
    await upsertSetting(key, value, req.user.id);
    await audit(req, 'setting_update', key, { value });
    res.json({ ok: true, key, value });
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/coins', async (req, res, next) => {
  try {
    const amount = Math.floor(Number(req.body?.amount) || 0);
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const reason = cleanText(req.body?.reason || 'admin adjustment', 300);
    const bal = await changeCoins(req.params.id, amount, 'admin', null, { adminId: req.user.id, reason });
    await audit(req, 'grant_coins', req.params.id, { amount, reason });
    res.json({ ok: true, coins: bal });
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/gold', async (req, res, next) => {
  try {
    const amount = Math.floor(Number(req.body?.amount) || 0);
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const reason = cleanText(req.body?.reason || 'admin adjustment', 300);
    const bal = await changeGoldCoins(req.params.id, amount, 'admin', null, { adminId: req.user.id, reason });
    await audit(req, 'grant_gold', req.params.id, { amount, reason });
    res.json({ ok: true, goldCoins: bal });
  } catch (err) { next(err); }
});

adminRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE users
          SET is_banned = TRUE,
              banned_reason = 'soft deleted by admin',
              email = NULL
        WHERE id = $1`,
      [req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'user not found' });
    await audit(req, 'user_soft_delete', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    await audit(req, 'password_reset_requested', req.params.id);
    res.json({ ok: true, message: 'Password reset event recorded' });
  } catch (err) { next(err); }
});

adminRouter.get('/users/:id/sessions', async (req, res, next) => {
  try {
    const r = await query('SELECT id, created_at, updated_at FROM users WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'user not found' });
    res.json([{ id: `session-${r.rows[0].id}`, createdAt: r.rows[0].created_at, lastSeenAt: r.rows[0].updated_at, status: 'active' }]);
  } catch (err) { next(err); }
});

adminRouter.delete('/users/:id/sessions', async (req, res, next) => {
  try {
    await query('UPDATE users SET updated_at = now() WHERE id = $1', [req.params.id]);
    await audit(req, 'sessions_killed', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/premium', async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(Number(req.body?.days) || 30, 3650));
    const r = await query(
      `UPDATE users SET premium_until = GREATEST(coalesce(premium_until, now()), now()) + ($1 || ' days')::interval
         WHERE id = $2
         RETURNING id`,
      [String(days), req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'user not found' });
    await audit(req, 'grant_premium', req.params.id, { days });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.get('/games', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const r = await query(
      `SELECT id, room_code, mode, stake, started_at, ended_at, winner_id, loser_id, is_draw
         FROM games ORDER BY started_at DESC LIMIT $1`,
      [limit]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.get('/audit', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const r = await query(
      'SELECT id, admin_id, action, target_id, metadata, created_at FROM audit_log ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// Tournaments — TOR §5 ------------------------------------------------------
adminRouter.get('/tournaments', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT id, name, starts_at, prize_coins, max_players, status, created_at,
              entry_gold_coins, prize_first_gold_coins, prize_second_gold_coins,
              prize_third_gold_coins, table_size, bluff_enabled
         FROM tournaments
        ORDER BY starts_at NULLS LAST, created_at DESC LIMIT 200`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// TOR §15: admin assigns winners to a finished tournament. Pays out Gold
// Coins and records the medal (gold / silver / bronze). Idempotent per
// (tournament_id, placement) — re-running the same placement is a no-op
// for the payout but updates the medal/coins record.
adminRouter.post('/tournaments/:id/winners', async (req, res, next) => {
  try {
    const tournamentId = req.params.id;
    const winners = Array.isArray(req.body?.winners) ? req.body.winners : [];
    if (!winners.length) return res.status(400).json({ error: 'winners[] required' });
    const payouts = await settlePlacements({
      tournamentId,
      placements: winners.map((w) => ({ userId: w.userId, placement: w.placement })),
      adminId: req.user.id,
    });
    await audit(req, 'tournament_winners', tournamentId, { payouts });
    res.json({ ok: true, payouts });
  } catch (err) { next(err); }
});

adminRouter.get('/tournaments/:id/winners', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT p.placement, p.medal, p.gold_coins, p.user_id, u.username, p.awarded_at
         FROM tournament_payouts p
         LEFT JOIN users u ON u.id = p.user_id
         WHERE p.tournament_id = $1
         ORDER BY p.placement ASC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.post('/tournaments', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const entryGold = Math.max(0, Math.floor(Number(req.body?.entryGoldCoins) || config.game.tournament.entryGoldCoins));
    const prizeFirst = Math.max(0, Math.floor(Number(req.body?.prizeFirstGoldCoins) || config.game.tournament.prizeFirstGoldCoins));
    const prizeSecond = Math.max(0, Math.floor(Number(req.body?.prizeSecondGoldCoins) || config.game.tournament.prizeSecondGoldCoins));
    const prizeThird = Math.max(0, Math.floor(Number(req.body?.prizeThirdGoldCoins) || config.game.tournament.prizeThirdGoldCoins));
    const maxPlayers = Math.max(2, Math.min(256, Math.floor(Number(req.body?.maxPlayers) || 16)));
    const tableSize = config.game.allowedTableSizes.includes(Number(req.body?.tableSize)) ? Number(req.body.tableSize) : 4;
    const bluffEnabled = !!req.body?.bluffEnabled;
    const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : null;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await query(
      `INSERT INTO tournaments (
         name, starts_at, prize_coins, max_players, status, created_by,
         entry_gold_coins, prize_first_gold_coins, prize_second_gold_coins, prize_third_gold_coins,
         table_size, bluff_enabled
       )
       VALUES ($1, $2, 0, $3, 'scheduled', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, startsAt, maxPlayers, req.user.id, entryGold, prizeFirst, prizeSecond, prizeThird, tableSize, bluffEnabled]
    );
    await audit(req, 'tournament_create', r.rows[0].id, { name, entryGold, prizeFirst, prizeSecond, prizeThird, maxPlayers });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// Promotions ----------------------------------------------------------------
adminRouter.get('/promotions', async (_req, res, next) => {
  try {
    const r = await query(
      'SELECT id, name, bonus_coins, starts_at, ends_at, active, created_at FROM promotions ORDER BY starts_at DESC LIMIT 200'
    );
    // Mark expired promos as inactive on read.
    res.json(r.rows.map((p) => ({ ...p, active: p.active && new Date(p.ends_at) > new Date() })));
  } catch (err) { next(err); }
});

adminRouter.post('/promotions', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const bonusCoins = Math.max(0, Math.floor(Number(req.body?.bonusCoins) || 0));
    const days = Math.max(1, Math.min(365, Math.floor(Number(req.body?.durationDays) || 7)));
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await query(
      `INSERT INTO promotions (name, bonus_coins, starts_at, ends_at, active, created_by)
       VALUES ($1, $2, now(), now() + ($3 || ' days')::interval, TRUE, $4) RETURNING *`,
      [name, bonusCoins, String(days), req.user.id]
    );
    await audit(req, 'promotion_create', r.rows[0].id, { name, bonusCoins, days });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.put('/promotions/:id', async (req, res, next) => {
  try {
    const name = cleanText(req.body?.name, 120);
    const bonusCoins = intParam(req.body?.bonusCoins ?? req.body?.bonus_coins, 0, 0, 1000000000);
    const active = req.body?.active === undefined ? true : !!req.body.active;
    const r = await query(
      `UPDATE promotions
          SET name = COALESCE(NULLIF($2,''), name),
              bonus_coins = $3,
              active = $4
        WHERE id = $1
        RETURNING *`,
      [req.params.id, name, bonusCoins, active]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'promotion not found' });
    await audit(req, 'promotion_update', req.params.id, { name, bonusCoins, active });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.delete('/promotions/:id', async (req, res, next) => {
  try {
    await query('UPDATE promotions SET active = FALSE WHERE id = $1', [req.params.id]);
    await audit(req, 'promotion_delete', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.get('/promotions/:id/uses', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT t.id, t.user_id, u.username, t.amount, t.created_at
         FROM transactions t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.metadata->>'promotionId' = $1
        ORDER BY t.created_at DESC
        LIMIT 100`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.post('/promotions/generate-bulk', async (req, res, next) => {
  try {
    const count = intParam(req.body?.count, 10, 1, 100);
    const bonusCoins = intParam(req.body?.bonusCoins, 1000, 0, 1000000000);
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      const code = `PROMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const r = await query(
        `INSERT INTO promotions (name, bonus_coins, starts_at, ends_at, active, created_by)
         VALUES ($1, $2, now(), now() + interval '30 days', TRUE, $3)
         RETURNING *`,
        [code, bonusCoins, req.user.id]
      );
      rows.push(r.rows[0]);
    }
    await audit(req, 'promotion_bulk_generate', null, { count, bonusCoins });
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

adminRouter.put('/tournaments/:id', async (req, res, next) => {
  try {
    const name = cleanText(req.body?.name, 120);
    const maxPlayers = intParam(req.body?.maxPlayers ?? req.body?.max_players, 16, 2, 256);
    const status = cleanText(req.body?.status || 'scheduled', 32);
    const r = await query(
      `UPDATE tournaments
          SET name = COALESCE(NULLIF($2,''), name),
              max_players = $3,
              status = $4
        WHERE id = $1
        RETURNING *`,
      [req.params.id, name, maxPlayers, status]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'tournament not found' });
    await audit(req, 'tournament_update', req.params.id, { name, maxPlayers, status });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.delete('/tournaments/:id', async (req, res, next) => {
  try {
    await query("UPDATE tournaments SET status = 'cancelled' WHERE id = $1", [req.params.id]);
    await audit(req, 'tournament_cancel', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/tournaments/:id/start', async (req, res, next) => {
  try {
    await query("UPDATE tournaments SET status = 'active' WHERE id = $1", [req.params.id]);
    await audit(req, 'tournament_start', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/tournaments/:id/end', async (req, res, next) => {
  try {
    await query("UPDATE tournaments SET status = 'finished' WHERE id = $1", [req.params.id]);
    await audit(req, 'tournament_end', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/tournaments/:id/disqualify/:userId', async (req, res, next) => {
  try {
    await query('DELETE FROM tournament_entries WHERE tournament_id = $1 AND user_id = $2', [req.params.id, req.params.userId]).catch(() => {});
    await audit(req, 'tournament_disqualify', req.params.userId, { tournamentId: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// TOR §9 monthly Cunning Fox settlement -------------------------------------
adminRouter.post('/monthly-badges/cunning-fox/snapshot', async (req, res, next) => {
  try {
    await snapshotBluffCounters();
    await audit(req, 'cunning_fox_snapshot', null, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/monthly-badges/cunning-fox/settle', async (req, res, next) => {
  try {
    const now = new Date();
    const year = Number(req.body?.year) || now.getUTCFullYear();
    const month = Number(req.body?.month) || (now.getUTCMonth() + 1);
    const result = await settleCunningFox(year, month);
    await audit(req, 'cunning_fox_settle', result.winnerId, { year, month, delta: result.delta });
    res.json({ ok: true, ...result, year, month });
  } catch (err) { next(err); }
});

// ── Antibot Panel — Feature 32 ───────────────────────────────────────────────

// GET /api/admin/antibot?category=bot|suspicious|watch
// Lists all flagged users (system bots excluded). Filter by category.
adminRouter.get('/antibot', async (req, res, next) => {
  try {
    const category = req.query.category ? String(req.query.category) : null;
    const limit  = Math.min(Number(req.query.limit)  || 200, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const list = await getAntibotList({ category, limit, offset });
    res.json(list);
  } catch (err) { next(err); }
});

adminRouter.get('/ranking/leaderboard', async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const offset = (page - 1) * limit;
    const sort = String(req.query.sort || 'rank_wins');
    const orderBy = sort === 'coins'
      ? 'coins DESC, rank_wins DESC'
      : ['games_won', 'wins', 'won'].includes(sort)
        ? 'games_won DESC, rank_wins DESC'
        : ['donation', 'donations', 'donated'].includes(sort)
          ? 'total_donated_cents DESC, rank_wins DESC'
          : 'rank_wins DESC, games_won DESC';
    const r = await query(
      `SELECT id, username, nickname, avatar_url, rank_wins, rank_color, rank_lines, rank_pluses,
              games_won, games_played, win_streak, coins, gold_coins, total_donated_cents,
              ROW_NUMBER() OVER (ORDER BY ${orderBy}, id ASC)::int AS position
         FROM users
        WHERE is_banned = FALSE AND is_bot IS NOT TRUE
        ORDER BY ${orderBy}, id ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const totals = await query(
      `SELECT COUNT(*)::int AS players,
              COALESCE(SUM(coins),0)::bigint AS total_coins,
              COALESCE(SUM(gold_coins),0)::bigint AS total_gold,
              COALESCE(MAX(rank_wins),0)::int AS max_rank_wins
         FROM users
        WHERE is_banned = FALSE AND is_bot IS NOT TRUE`
    );
    res.json({ players: r.rows, rows: r.rows, totals: totals.rows[0] || {}, page, limit });
  } catch (err) { next(err); }
});

adminRouter.get('/ranking/seasons', async (_req, res) => {
  res.json([{ id: 'current', name: 'Current Season', status: 'active', startsAt: null, endsAt: null }]);
});

adminRouter.post('/ranking/seasons', async (req, res, next) => {
  try {
    const name = cleanText(req.body?.name || 'New Season', 120);
    await audit(req, 'ranking_season_start', null, { name });
    res.status(201).json({ id: `season-${Date.now()}`, name, status: 'active' });
  } catch (err) { next(err); }
});

adminRouter.put('/ranking/seasons/:id', async (req, res, next) => {
  try {
    const name = cleanText(req.body?.name || 'Season', 120);
    await audit(req, 'ranking_season_update', null, { id: req.params.id, name });
    res.json({ id: req.params.id, name, status: req.body?.status || 'active' });
  } catch (err) { next(err); }
});

adminRouter.post('/ranking/reset', async (req, res, next) => {
  try {
    if (!['RESET', 'RESET_RANKING'].includes(String(req.body?.confirmationToken || ''))) {
      return res.status(400).json({ error: 'confirmation token required' });
    }
    await query('UPDATE users SET rank_wins = 0, games_won = 0, games_lost = 0, games_draw = 0 WHERE is_bot IS NOT TRUE');
    await audit(req, 'ranking_reset', null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.get('/ranking/distribution', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT CASE
                WHEN rank_wins >= 100 THEN 'legend'
                WHEN rank_wins >= 50 THEN 'master'
                WHEN rank_wins >= 20 THEN 'gold'
                WHEN rank_wins >= 5 THEN 'silver'
                ELSE 'bronze'
              END AS tier,
              COUNT(*)::int AS users
         FROM users
        GROUP BY tier
        ORDER BY users DESC`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.get('/messages/broadcast-history', async (_req, res, next) => {
  try {
    const r = await query('SELECT id, title, message AS body, audience, type, created_at FROM admin_broadcasts ORDER BY created_at DESC LIMIT 100');
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.post('/messages/broadcast', async (req, res, next) => {
  try {
    const title = cleanText(req.body?.title, 160);
    const body = cleanText(req.body?.body || req.body?.message, 1000);
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    const audience = cleanText(req.body?.targetGroup || req.body?.audience || 'all', 32);
    const type = cleanText(req.body?.type || 'both', 32);
    const r = await query(
      `INSERT INTO admin_broadcasts (admin_id, title, message, audience, type)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, title, message AS body, audience, type, created_at`,
      [req.user.id, title, body, audience, type]
    );
    await audit(req, 'broadcast_send', null, { title, audience, type });
    await writeEvent('info', 'message', `Broadcast sent: ${title}`, { audience, type });
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.post('/messages/send-to-user', async (req, res, next) => {
  try {
    const userId = cleanText(req.body?.userId, 64);
    const message = cleanText(req.body?.message, 1000);
    if (!userId || !message) return res.status(400).json({ error: 'userId and message required' });
    await query(
      `INSERT INTO admin_events (level, category, message, metadata)
       VALUES ('info', 'direct_message', $1, $2)`,
      [`Direct message sent to ${userId}`, { userId, message, type: req.body?.type || 'in-app' }]
    );
    await audit(req, 'direct_message_send', userId, { message });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.get('/messages/inbox', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT r.id, r.reporter_id AS user_id, u.username, r.reason AS title, r.details AS body, r.status, r.created_at
         FROM reports r
         LEFT JOIN users u ON u.id = r.reporter_id
        ORDER BY r.created_at DESC
        LIMIT 100`
    ).catch(() => ({ rows: [] }));
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.put('/messages/inbox/:id/read', async (req, res, next) => {
  try {
    await query("UPDATE reports SET status = 'reviewed' WHERE id = $1", [req.params.id]).catch(() => {});
    await audit(req, 'message_mark_read', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.delete('/messages/inbox/:id', async (req, res, next) => {
  try {
    await query("UPDATE reports SET status = 'closed' WHERE id = $1", [req.params.id]).catch(() => {});
    await audit(req, 'message_delete', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.get('/gold/transactions', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageParams(req, 25);
    const r = await query(
      `SELECT g.id, g.user_id, u.username, g.amount, g.type, g.metadata, g.created_at
         FROM gold_transactions g
         LEFT JOIN users u ON u.id = g.user_id
        ORDER BY g.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = await query('SELECT COUNT(*)::int AS total FROM gold_transactions');
    res.json({ data: r.rows, pagination: { page, limit, total: total.rows[0].total, pages: Math.max(1, Math.ceil(total.rows[0].total / limit)) } });
  } catch (err) { next(err); }
});

adminRouter.get('/gold/stats', async (_req, res, next) => {
  try {
    const [wallets, ledger] = await Promise.all([
      query('SELECT COALESCE(SUM(gold_coins),0)::bigint AS in_wallets FROM users'),
      query(`SELECT COALESCE(SUM(amount) FILTER (WHERE amount > 0),0)::bigint AS minted,
                    COALESCE(SUM(ABS(amount)) FILTER (WHERE amount < 0),0)::bigint AS spent
               FROM gold_transactions`),
    ]);
    res.json({ totalGoldMinted: Number(ledger.rows[0].minted), totalGoldSpent: Number(ledger.rows[0].spent), inWallets: Number(wallets.rows[0].in_wallets) });
  } catch (err) { next(err); }
});

adminRouter.post('/gold/grant', async (req, res, next) => {
  try {
    const userId = cleanText(req.body?.userId, 64);
    const amount = Math.floor(Number(req.body?.amount) || 0);
    const reason = cleanText(req.body?.reason || 'admin grant', 300);
    if (!userId || !amount) return res.status(400).json({ error: 'userId and amount required' });
    const bal = await changeGoldCoins(userId, amount, 'admin_grant', null, { adminId: req.user.id, reason });
    await audit(req, 'gold_grant', userId, { amount, reason });
    res.json({ ok: true, goldCoins: bal });
  } catch (err) { next(err); }
});

adminRouter.get('/analytics/overview', async (_req, res, next) => {
  try {
    const [activity, sessions, topDonators, activeUsers, popularTables] = await Promise.all([
      query(`SELECT
               COUNT(*) FILTER (WHERE updated_at >= now() - interval '1 day')::int AS dau,
               COUNT(*) FILTER (WHERE updated_at >= now() - interval '30 days')::int AS mau,
               COUNT(*) FILTER (WHERE created_at >= now() - interval '1 day')::int AS new_today,
               COUNT(*) FILTER (WHERE premium_until > now())::int AS premium_active
             FROM users`),
      query(`SELECT
               COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at)))::numeric), 0)::int AS avg_seconds,
               COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ended_at - started_at)))::numeric), 0)::int AS median_seconds
             FROM games
             WHERE ended_at IS NOT NULL AND started_at IS NOT NULL`).catch(() => ({ rows: [{ avg_seconds: 0, median_seconds: 0 }] })),
      query(`SELECT u.id, u.username, u.nickname,
                    COALESCE(SUM(d.amount_usd_cents), 0)::bigint AS amount_cents
               FROM donations d
               JOIN users u ON u.id = d.user_id
              GROUP BY u.id, u.username, u.nickname
              ORDER BY amount_cents DESC
              LIMIT 10`).catch(() => ({ rows: [] })),
      query(`SELECT id, username, nickname, games_played, games_won, updated_at
               FROM users
              ORDER BY games_played DESC, updated_at DESC
              LIMIT 10`),
      query(`SELECT stake, mode, COUNT(*)::int AS games
               FROM games
              GROUP BY stake, mode
              ORDER BY games DESC, stake ASC
              LIMIT 10`),
    ]);
    res.json({
      activity: activity.rows[0] || {},
      sessionTime: sessions.rows[0] || { avg_seconds: 0, median_seconds: 0 },
      topDonators: topDonators.rows,
      activeUsers: activeUsers.rows,
      popularTables: popularTables.rows,
    });
  } catch (err) { next(err); }
});

adminRouter.get('/security/overview', async (_req, res, next) => {
  try {
    const [multiIp, multiDevice, suspicious, muted, banned] = await Promise.all([
      query(`SELECT last_ip, COUNT(*)::int AS accounts,
                    json_agg(json_build_object('id', id, 'username', username, 'nickname', nickname)) AS users
               FROM users
              WHERE last_ip IS NOT NULL AND last_ip <> ''
              GROUP BY last_ip
             HAVING COUNT(*) >= 2
              ORDER BY accounts DESC
              LIMIT 30`).catch(() => ({ rows: [] })),
      query(`SELECT device_id, COUNT(*)::int AS accounts,
                    json_agg(json_build_object('id', id, 'username', username, 'nickname', nickname)) AS users
               FROM users
              WHERE device_id IS NOT NULL AND device_id <> ''
              GROUP BY device_id
             HAVING COUNT(*) >= 2
              ORDER BY accounts DESC
              LIMIT 30`).catch(() => ({ rows: [] })),
      query(`SELECT a.user_id, u.username, u.nickname, u.last_ip, u.device_id, a.score, a.category, a.details, a.last_updated
               FROM antibot_scores a
               JOIN users u ON u.id = a.user_id
              WHERE a.category <> 'clean'
              ORDER BY a.score DESC, a.last_updated DESC
              LIMIT 50`).catch(() => ({ rows: [] })),
      query(`SELECT id, username, nickname, muted_until, muted_reason
               FROM users
              WHERE is_muted = TRUE AND (muted_until IS NULL OR muted_until > now())
              ORDER BY muted_until NULLS FIRST
              LIMIT 50`).catch(() => ({ rows: [] })),
      query(`SELECT id, username, nickname, banned_until, banned_reason
               FROM users
              WHERE is_banned = TRUE
              ORDER BY banned_until NULLS FIRST
              LIMIT 50`).catch(() => ({ rows: [] })),
    ]);
    res.json({ multiIp: multiIp.rows, multiDevice: multiDevice.rows, suspicious: suspicious.rows, muted: muted.rows, banned: banned.rows });
  } catch (err) { next(err); }
});

adminRouter.get('/reports/moderation', async (req, res, next) => {
  try {
    const type = cleanText(req.query.type || 'all', 32);
    const typeMap = {
      toxic: ['abuse', 'toxic', 'insult'],
      voice_abuse: ['voice_abuse', 'voice', 'voice-abuse'],
      cheat: ['cheating', 'cheat', 'bot'],
      spam: ['spam'],
    };
    const where = [];
    const params = [];
    if (type !== 'all') {
      const list = typeMap[type] || [type];
      params.push(list);
      where.push(`lower(r.reason) = ANY($${params.length}::text[])`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows, counts] = await Promise.all([
      query(
        `SELECT r.id, r.reason, r.details, r.status, r.room_code, r.created_at,
                reporter.id AS reporter_id, reporter.username AS reporter_username, reporter.nickname AS reporter_nickname,
                reported.id AS reported_id, reported.username AS reported_username, reported.nickname AS reported_nickname
           FROM reports r
           LEFT JOIN users reporter ON reporter.id = r.reporter_id
           LEFT JOIN users reported ON reported.id = r.reported_id
           ${clause}
          ORDER BY r.created_at DESC
          LIMIT 200`,
        params
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT lower(reason) AS reason, status, COUNT(*)::int AS count
           FROM reports
          GROUP BY lower(reason), status
          ORDER BY count DESC`
      ).catch(() => ({ rows: [] })),
    ]);
    res.json({ data: rows.rows, counts: counts.rows });
  } catch (err) { next(err); }
});

adminRouter.get('/backups', async (_req, res, next) => {
  try {
    const r = await query('SELECT id, admin_id, backup_type, status, metadata, created_at FROM admin_backups ORDER BY created_at DESC LIMIT 100');
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.post('/backups/database', async (req, res, next) => {
  try {
    const tables = ['users', 'games', 'inventory', 'transactions', 'gold_transactions', 'reports', 'admin_items', 'stickers'];
    const counts = {};
    for (const table of tables) {
      const r = await query(`SELECT COUNT(*)::int AS count FROM ${table}`).catch(() => ({ rows: [{ count: 0 }] }));
      counts[table] = Number(r.rows[0]?.count || 0);
    }
    const r = await query(
      `INSERT INTO admin_backups (admin_id, backup_type, status, metadata)
       VALUES ($1, 'database', 'created', $2)
       RETURNING id, admin_id, backup_type, status, metadata, created_at`,
      [req.user.id, { counts, note: cleanText(req.body?.note || '', 300) }]
    );
    await audit(req, 'database_backup_create', r.rows[0].id, { counts });
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.post('/backups/source', async (req, res, next) => {
  try {
    const r = await query(
      `INSERT INTO admin_backups (admin_id, backup_type, status, metadata)
       VALUES ($1, 'source', 'created', $2)
       RETURNING id, admin_id, backup_type, status, metadata, created_at`,
      [req.user.id, { note: cleanText(req.body?.note || '', 300), cwd: process.cwd() }]
    );
    await audit(req, 'source_backup_create', r.rows[0].id, {});
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.post('/backups/:id/restore', async (req, res, next) => {
  try {
    const backup = await query('SELECT id, backup_type FROM admin_backups WHERE id = $1', [req.params.id]);
    if (!backup.rows[0]) return res.status(404).json({ error: 'backup not found' });
    await query(
      `UPDATE admin_backups
          SET status = 'restore_requested',
              metadata = metadata || $2::jsonb
        WHERE id = $1`,
      [req.params.id, JSON.stringify({ restoreRequestedBy: req.user.id, requestedAt: new Date().toISOString() })]
    );
    await audit(req, 'backup_restore_requested', req.params.id, { backupType: backup.rows[0].backup_type });
    res.json({ ok: true, status: 'restore_requested' });
  } catch (err) { next(err); }
});

adminRouter.get('/reports/revenue', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT created_at::date::text AS day, type, COALESCE(SUM(amount),0)::bigint AS amount
         FROM transactions
        WHERE amount > 0
        GROUP BY day, type
        ORDER BY day DESC
        LIMIT 120`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.get('/reports/retention', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT created_at::date::text AS cohort,
              COUNT(*)::int AS registered,
              COUNT(*) FILTER (WHERE updated_at >= created_at + interval '1 day')::int AS d1,
              COUNT(*) FILTER (WHERE updated_at >= created_at + interval '7 days')::int AS d7,
              COUNT(*) FILTER (WHERE updated_at >= created_at + interval '30 days')::int AS d30
         FROM users
        GROUP BY cohort
        ORDER BY cohort DESC
        LIMIT 30`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

adminRouter.get('/reports/funnel', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT (SELECT COUNT(*)::int FROM users) AS registered,
              (SELECT COUNT(DISTINCT p)::int FROM games, unnest(player_ids) AS p) AS played,
              (SELECT COUNT(DISTINCT user_id)::int FROM transactions WHERE amount > 0) AS purchased,
              (SELECT COUNT(*)::int FROM users WHERE premium_until > now()) AS premium`
    );
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

adminRouter.get('/reports/export', async (req, res, next) => {
  try {
    const fromDate = cleanText(req.query.from, 32) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const toDate = cleanText(req.query.to, 32) || new Date().toISOString();
    const [payments, users, games] = await Promise.all([
      query(
        `SELECT date_trunc('day', created_at)::date::text AS day,
                COUNT(*)::int AS payments,
                COALESCE(SUM(amount_cents),0)::bigint AS revenue_cents
           FROM stripe_payments
          WHERE status = 'completed' AND created_at BETWEEN $1 AND $2
          GROUP BY 1 ORDER BY 1`,
        [fromDate, toDate]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT date_trunc('day', created_at)::date::text AS day, COUNT(*)::int AS new_users
           FROM users
          WHERE created_at BETWEEN $1 AND $2
          GROUP BY 1 ORDER BY 1`,
        [fromDate, toDate]
      ),
      query(
        `SELECT date_trunc('day', ended_at)::date::text AS day, COUNT(*)::int AS games_completed
           FROM games
          WHERE ended_at IS NOT NULL AND ended_at BETWEEN $1 AND $2
          GROUP BY 1 ORDER BY 1`,
        [fromDate, toDate]
      ).catch(() => ({ rows: [] })),
    ]);
    const byDay = new Map();
    const touch = (day) => {
      if (!byDay.has(day)) byDay.set(day, { day, revenueCents: 0, payments: 0, newUsers: 0, gamesCompleted: 0 });
      return byDay.get(day);
    };
    for (const row of payments.rows) {
      const day = touch(row.day);
      day.revenueCents = Number(row.revenue_cents || 0);
      day.payments = Number(row.payments || 0);
    }
    for (const row of users.rows) touch(row.day).newUsers = Number(row.new_users || 0);
    for (const row of games.rows) touch(row.day).gamesCompleted = Number(row.games_completed || 0);
    const header = 'date,revenue_usd,payments,new_users,games_completed';
    const lines = [...byDay.values()]
      .sort((a, b) => String(a.day).localeCompare(String(b.day)))
      .map((row) => [
        row.day,
        (row.revenueCents / 100).toFixed(2),
        row.payments,
        row.newUsers,
        row.gamesCompleted,
      ].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="durak-report-${String(fromDate).slice(0, 10)}.csv"`);
    res.send([header, ...lines].join('\n'));
  } catch (err) { next(err); }
});

// DELETE /api/admin/antibot/:userId   — clear score record only
adminRouter.delete('/antibot/:userId', async (req, res, next) => {
  try {
    await clearAntibotScore(req.params.userId);
    await audit(req, 'antibot_clear_score', req.params.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/admin/antibot/:userId/user   — hard-delete the user from DB
adminRouter.delete('/antibot/:userId/user', async (req, res, next) => {
  try {
    const deleted = await deleteAntibotUser(req.params.userId);
    await audit(req, 'antibot_delete_user', req.params.userId, { deleted });
    res.json({ ok: true, deleted });
  } catch (err) { next(err); }
});

// DELETE /api/admin/antibot?category=bot   — bulk clear score records
adminRouter.delete('/antibot', async (req, res, next) => {
  try {
    const category = String(req.query.category || '');
    const validCats = ['bot', 'suspicious', 'watch'];
    if (!validCats.includes(category))
      return res.status(400).json({ error: 'category must be bot|suspicious|watch' });
    const hardDelete = req.query.hardDelete === '1';
    let affected;
    if (hardDelete) {
      affected = await bulkDeleteAntibotUsers(category);
      await audit(req, 'antibot_bulk_delete_users', null, { category, count: affected.length });
    } else {
      affected = await bulkClearAntibotCategory(category);
      await audit(req, 'antibot_bulk_clear', null, { category, count: affected.length });
    }
    res.json({ ok: true, affected: affected.length });
  } catch (err) { next(err); }
});
