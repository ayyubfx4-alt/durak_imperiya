import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { query } from '../db.js';
import { googleSignIn, checkNickname, setNickname } from '../services/googleAuth.js';
import { guestLogin, login, register } from '../services/auth.js';
import { syncUserGameStats } from '../services/gameStats.js';

export const authRouter = Router();

authRouter.get('/firebase-config', (_req, res) => {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
  };
  const required = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
  const missing = required.filter((key) => !String(config[key] || '').trim());
  res.json({
    ...config,
    configured: missing.length === 0,
    missing,
  });
});

// TOR §16: Guest login is disabled in production.
// Anonymous accounts cause issues with anti-cheat, nickname system, and account persistence.
// Only enabled in development/test environments.
authRouter.post('/guest', async (_req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'guest login is disabled in production' });
    }
    const result = await guestLogin();
    res.json(result);
  } catch (err) { next(err); }
});

// Username/password registration. Rate-limited at the app level (see index.js).
authRouter.post('/register', async (req, res, next) => {
  try {
    res.json(await register({
      ...req.body,
      referralCode: req.body?.referralCode || req.body?.referral_code || null,
    }));
  } catch (err) { next(err); }
});

// Username/email + password login. Rate-limited at the app level.
authRouter.post('/login', async (req, res, next) => {
  try {
    res.json(await login(req.body));
  } catch (err) { next(err); }
});

// ── Google Sign-In ────────────────────────────────────────────────────────
authRouter.post('/google', async (req, res, next) => {
  try {
    const { idToken } = req.body;
    const result = await googleSignIn(idToken);
    res.json(result);
  } catch (err) { next(err); }
});

// ── Nickname availability check (no auth required) ────────────────────────
authRouter.get('/nickname/check', async (req, res, next) => {
  try {
    const result = await checkNickname(req.query.nick);
    res.json(result);
  } catch (err) { next(err); }
});

// ── Set nickname on first login ───────────────────────────────────────────
authRouter.post('/nickname', authRequired, async (req, res, next) => {
  try {
    const result = await setNickname(req.user.id, req.body.nickname);
    res.json(result);
  } catch (err) { next(err); }
});

// ── Current user profile ──────────────────────────────────────────────────
authRouter.get('/me', authRequired, async (req, res, next) => {
  try {
    await syncUserGameStats(req.user.id);
    const r = await query(
      `SELECT id, username, nickname, username AS display_name, avatar_url, email,
              coins, gold_coins, COALESCE(tournament_tickets, 0) AS tournament_tickets, elon_stickers, sheriff_marks,
              rank_wins, rank_color, rank_lines, rank_pluses, rank_progress,
              games_played, games_won, games_lost, games_draw,
              win_streak, loss_streak, bluffs_caught, bluffs_made,
              premium_until, referral_code, is_admin,
              badges_showcase, selected_skin, selected_avatar_frame, locale,
              total_donated_cents, nickname_set, settings_json AS settings, created_at
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    const me = r.rows[0];
    if (!me) return res.status(404).json({ error: 'user not found' });
    const rank = await query(
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY rank_wins DESC, games_won DESC, id ASC) AS global_rank
           FROM users
          WHERE is_banned = FALSE AND is_bot IS NOT TRUE
       )
       SELECT global_rank FROM ranked WHERE id = $1`,
      [req.user.id]
    );
    res.json({ ...me, global_rank: Number(rank.rows[0]?.global_rank || 0) });
  } catch (err) { next(err); }
});

// ── Update locale ─────────────────────────────────────────────────────────
authRouter.post('/me/locale', authRequired, async (req, res, next) => {
  try {
    const SUPPORTED = ['uz', 'ru', 'en'];
    const locale = SUPPORTED.includes(req.body?.locale) ? req.body.locale : 'en';
    await query('UPDATE users SET locale = $1 WHERE id = $2', [locale, req.user.id]);
    res.json({ ok: true, locale });
  } catch (err) { next(err); }
});

// ── Register / update FCM push token ─────────────────────────────────────
authRouter.post('/me/fcm-token', authRequired, async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').slice(0, 512);
    const platform = ['android', 'ios', 'web'].includes(req.body?.platform)
      ? req.body.platform : 'web';
    if (!token) return res.status(400).json({ error: 'token required' });
    await query('UPDATE users SET fcm_token = $1 WHERE id = $2', [token, req.user.id]);
    res.json({ ok: true, platform });
  } catch (err) { next(err); }
});

// ── Select card skin ──────────────────────────────────────────────────────
authRouter.post('/me/skin', authRequired, async (req, res, next) => {
  try {
    const skin = String(req.body?.skin || 'default').slice(0, 64);
    const owned = await query(
      "SELECT 1 FROM inventory WHERE user_id = $1 AND item_type = 'card_skin' AND item_id = $2",
      [req.user.id, skin]
    );
    if (skin !== 'default' && !owned.rows[0]) return res.status(400).json({ error: 'skin not owned' });
    await query('UPDATE users SET selected_skin = $1 WHERE id = $2', [skin, req.user.id]);
    res.json({ ok: true, skin });
  } catch (err) { next(err); }
});

// ── Badges showcase ───────────────────────────────────────────────────────
authRouter.post('/me/badges', authRequired, async (req, res, next) => {
  try {
    const badges = Array.isArray(req.body?.badges) ? req.body.badges.slice(0, 3) : [];
    await query('UPDATE users SET badges_showcase = $1::jsonb WHERE id = $2', [JSON.stringify(badges), req.user.id]);
    res.json({ ok: true, badges });
  } catch (err) { next(err); }
});
