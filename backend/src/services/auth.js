import { z } from 'zod';
import { query } from '../db.js';
import { hashPassword, verifyPassword } from '../util/passwords.js';
import { signToken } from '../util/jwt.js';
import { randomCode } from '../util/random.js';
import { recordReferralChain } from './referral.js';
import { HttpError } from '../middleware/error.js';
import { STARTING_PLAYER_COINS, STARTING_PLAYER_GOLD_COINS } from './economyDefaults.js';

const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[A-Za-z0-9_]+$/),
  email: z.string().email().optional().nullable(),
  password: z.string().min(8).max(128),
  referralCode: z.string().max(16).optional().nullable(),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional().nullable(),
});

const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1).max(128),
});

export async function register(body) {
  const data = registerSchema.parse(body);
  // Treat the username as both the login handle and the public @nickname so
  // the user can start playing immediately after register without an extra
  // round trip to `/api/auth/nickname`.
  const exists = await query(
    `SELECT id FROM users
       WHERE lower(username) = lower($1)
          OR lower(nickname) = lower($1)
          OR ($2::text IS NOT NULL AND lower(email) = lower($2::text))`,
    [data.username, data.email || null]
  );
  if (exists.rows[0]) throw new HttpError(409, 'username or email taken');

  const passwordHash = await hashPassword(data.password);
  let code;
  for (let i = 0; i < 5; i++) {
    code = randomCode(8);
    const c = await query('SELECT id FROM users WHERE referral_code = $1', [code]);
    if (!c.rows[0]) break;
  }
  const r = await query(
    `INSERT INTO users (username, nickname, nickname_set, email, password_hash, referral_code, coins, gold_coins, country_code)
     VALUES ($1::text, $1::text, TRUE, $2::text, $3::text, $4::text, $5, $6, $7)
     RETURNING id, username, nickname, nickname_set, email, coins, gold_coins, games_played,
               premium_until, referral_code, is_admin, locale, country_code, selected_skin, selected_avatar_frame, badges_showcase`,
    [data.username, data.email || null, passwordHash, code, STARTING_PLAYER_COINS, STARTING_PLAYER_GOLD_COINS, data.countryCode || null]
  );
  const user = { ...r.rows[0], display_name: r.rows[0].username, avatar_url: null };

  if (data.referralCode) {
    try { await recordReferralChain(user.id, data.referralCode); } catch (_) { /* ignore */ }
  }

  const token = signToken({ uid: user.id });
  return { user, token, isNewUser: true };
}

export async function login(body) {
  const data = loginSchema.parse(body);
  const r = await query(
    `SELECT id, username, nickname, nickname_set, email, password_hash,
            coins, gold_coins, games_played, premium_until, referral_code, is_admin,
            is_banned, locale, country_code, selected_skin, selected_avatar_frame, badges_showcase, avatar_url
       FROM users
       WHERE lower(username) = lower($1)
          OR lower(nickname) = lower($1)
          OR lower(email)    = lower($1)`,
    [data.identifier]
  );
  const user = r.rows[0];
  if (!user) throw new HttpError(401, 'invalid credentials');
  if (user.is_banned) throw new HttpError(403, 'banned');
  const ok = await verifyPassword(data.password, user.password_hash || '');
  if (!ok) throw new HttpError(401, 'invalid credentials');
  const token = signToken({ uid: user.id });
  // Strip sensitive / internal fields before returning to the client.
  delete user.password_hash;
  delete user.is_banned;
  user.display_name = user.username;
  return { user, token };
}

export async function guestLogin() {
  let username;
  let refCode;

  for (let i = 0; i < 10; i++) {
    username = `guest_${randomCode(6).toLowerCase()}`;
    refCode = randomCode(8);
    const exists = await query(
      'SELECT id FROM users WHERE lower(username) = lower($1) OR referral_code = $2',
      [username, refCode]
    );
    if (!exists.rows[0]) break;
  }

  const r = await query(
    `INSERT INTO users (username, nickname, nickname_set, email, password_hash, referral_code, coins, gold_coins)
     VALUES ($1, $2, TRUE, NULL, NULL, $3, $4, $5)
     RETURNING id, username, nickname, nickname_set, email, coins, gold_coins, games_played,
               premium_until, referral_code, is_admin, locale, country_code, selected_skin, selected_avatar_frame, badges_showcase`,
    [username, username, refCode, STARTING_PLAYER_COINS, STARTING_PLAYER_GOLD_COINS]
  );
  const user = {
    ...r.rows[0],
    display_name: r.rows[0].username,
    avatar_url: null,
  };
  const token = signToken({ uid: user.id });
  return { user, token, isNewUser: false };
}

export async function bootstrapAdmin(email, password) {
  const r = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (r.rows[0]) {
    await query('UPDATE users SET is_admin = TRUE WHERE id = $1', [r.rows[0].id]);
    return r.rows[0].id;
  }
  const passwordHash = await hashPassword(password);
  const ins = await query(
    `INSERT INTO users (username, email, password_hash, referral_code, is_admin, coins)
     VALUES ($1, $2, $3, $4, TRUE, 0) RETURNING id`,
    ['admin', email, passwordHash, randomCode(8)]
  );
  return ins.rows[0].id;
}
