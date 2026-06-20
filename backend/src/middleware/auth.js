import { verifyToken } from '../util/jwt.js';
import { query } from '../db.js';
import { updateUserGeo } from '../services/geoip.js';

/**
 * TOR §14 — time-limited bans expire automatically. When a banned user
 * authenticates and their `banned_until` is in the past, lift the flag in
 * the same query that loaded the row. Permanent bans (banned_until IS NULL
 * while is_banned = TRUE) are left alone.
 */
export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'auth required' });
  const payload = verifyToken(token);
  if (!payload || !payload.uid) return res.status(401).json({ error: 'invalid token' });
  const r = await query(
    `WITH lifted AS (
       UPDATE users
          SET is_banned = FALSE, banned_until = NULL
        WHERE id = $1
          AND is_banned = TRUE
          AND banned_until IS NOT NULL
          AND banned_until <= now()
        RETURNING id
     )
     SELECT id, username, nickname, email, coins, gold_coins, games_played,
            is_admin, admin_role, is_banned, banned_until, banned_reason,
            is_muted, muted_until, muted_reason, premium_until,
            last_ip, device_id, country_code
       FROM users WHERE id = $1`,
    [payload.uid]
  );
  if (!r.rows[0]) return res.status(401).json({ error: 'user not found' });
  if (r.rows[0].is_banned) {
    const until = r.rows[0].banned_until;
    return res.status(403).json({
      error: 'banned',
      bannedUntil: until,
      bannedReason: r.rows[0].banned_reason || null,
      permanent: !until,
    });
  }
  req.user = r.rows[0];

  // Fire-and-forget: fonda IP va davlat kodini yangilash.
  // Foydalanuvchini kutishga majburlamaymiz — xato bo'lsa jim o'tadi.
  const currentIp = req.ip || req.socket?.remoteAddress || null;
  if (currentIp && currentIp !== r.rows[0].last_ip) {
    updateUserGeo(r.rows[0].id, currentIp).catch(() => {});
  }

  next();
}

function normalizePermissions(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

export function hasAdminPermission(user, permissions = []) {
  const needed = Array.isArray(permissions) ? permissions : [permissions];
  const granted = normalizePermissions(user?.permissions);
  if (granted.includes('*')) return true;
  return needed.some((permission) => {
    if (granted.includes(permission)) return true;
    const [domain, action] = String(permission).split('.');
    if ((action === 'view' || action === 'watch') && granted.includes(`${domain}.manage`)) return true;
    if (domain === 'users' && action === 'view' && granted.includes('users.moderate')) return true;
    if (domain === 'security' && action === 'view' && granted.includes('security.manage')) return true;
    if (domain === 'reports' && action === 'view' && granted.includes('reports.manage')) return true;
    return false;
  });
}

export async function adminRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth required' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  const role = req.user.admin_role || 'super_admin';
  try {
    const r = await query(
      'SELECT permissions FROM admin_role_permissions WHERE role = $1',
      [role]
    );
    req.user.admin_role = role;
    req.user.permissions = normalizePermissions(r.rows[0]?.permissions || (role === 'owner' ? ['*'] : []));
  } catch (_) {
    req.user.admin_role = role;
    req.user.permissions = role === 'owner' || role === 'super_admin'
      ? ['*']
      : [];
  }
  next();
}

export function adminPermission(permissions) {
  return (req, res, next) => {
    if (!hasAdminPermission(req.user, permissions)) {
      return res.status(403).json({ error: 'permission denied', required: Array.isArray(permissions) ? permissions : [permissions] });
    }
    next();
  };
}
