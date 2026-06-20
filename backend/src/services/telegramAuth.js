import { query } from '../db.js';
import { signToken } from '../util/jwt.js';
import { randomCode } from '../util/random.js';
import { HttpError } from '../middleware/error.js';
import { logger } from '../logger.js';
import { STARTING_PLAYER_COINS, STARTING_PLAYER_GOLD_COINS } from './economyDefaults.js';
import { verifyTelegramWebAppInitData } from './telegramBot.js';

const NICKNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

function cleanNickname(source) {
  let base = String(source || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (/^\d/.test(base)) base = `u_${base}`;
  base = base.slice(0, 24).replace(/_+$/g, '');
  if (!NICKNAME_RE.test(base)) base = `user_${randomCode(6).toLowerCase()}`;
  return base.slice(0, 24);
}

async function isNicknameTaken(nickname, excludeUserId = null) {
  const r = await query(
    `SELECT id
       FROM users
      WHERE (lower(username) = lower($1::text) OR lower(nickname) = lower($1::text))
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      LIMIT 1`,
    [nickname, excludeUserId]
  );
  return !!r.rows[0];
}

async function generateUniqueNickname(source, excludeUserId = null) {
  const base = cleanNickname(source);

  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 20)}_${i + 1}`;
    if (NICKNAME_RE.test(candidate) && !(await isNicknameTaken(candidate, excludeUserId))) {
      return candidate;
    }
  }

  for (let i = 0; i < 20; i++) {
    const candidate = `${base.slice(0, 18)}_${randomCode(4).toLowerCase()}`;
    if (NICKNAME_RE.test(candidate) && !(await isNicknameTaken(candidate, excludeUserId))) {
      return candidate;
    }
  }

  throw new HttpError(409, 'Could not allocate a unique nickname');
}

export async function telegramSignIn(initData) {
  if (!initData) throw new HttpError(400, 'initData is required');

  const tgData = verifyTelegramWebAppInitData(initData);
  if (!tgData || !tgData.user || !tgData.user.id) {
    logger.warn('[telegramAuth] initData verification failed');
    throw new HttpError(401, 'Telegram verification failed or session expired');
  }

  const tgUser = tgData.user;
  const tgId = tgUser.id;
  const username = tgUser.username || '';
  const firstName = tgUser.first_name || 'Player';
  const lastName = tgUser.last_name || '';

  // 1. Search by telegram_id
  let r = await query(
    `SELECT id, username, nickname, nickname_set, coins, gold_coins, games_played, premium_until, is_admin, is_banned, avatar_url, telegram_id
       FROM users WHERE telegram_id = $1`,
    [tgId]
  );

  let user = r.rows[0];
  let isNewUser = false;

  // 2. If not found, try searching by username (if they have one) to link old username/password accounts
  if (!user && username) {
    r = await query(
      `SELECT id, username, nickname, nickname_set, coins, gold_coins, games_played, premium_until, is_admin, is_banned, avatar_url, telegram_id
         FROM users WHERE lower(username) = lower($1) AND telegram_id IS NULL`,
      [username]
    );
    if (r.rows[0]) {
      user = r.rows[0];
      // Link the existing account
      await query('UPDATE users SET telegram_id = $1 WHERE id = $2', [tgId, user.id]);
      user.telegram_id = tgId;
    }
  }

  // 3. Register a new user if not found
  if (!user) {
    isNewUser = true;
    let refCode;
    for (let i = 0; i < 5; i++) {
      refCode = randomCode(8);
      const c = await query('SELECT id FROM users WHERE referral_code = $1', [refCode]);
      if (!c.rows[0]) break;
    }

    const preferredNick = username || `${firstName}_${lastName}`;
    const nick = await generateUniqueNickname(preferredNick);

    const ins = await query(
      `INSERT INTO users
         (username, nickname, telegram_id, referral_code, coins, gold_coins, nickname_set, locale)
       VALUES (($1::text)::varchar(32), $1::text, $2, ($3::text)::varchar(16), $4, $5, TRUE, $6)
       RETURNING id, username, nickname, nickname_set, coins, gold_coins, games_played, premium_until, is_admin, is_banned, avatar_url, telegram_id`,
      [nick, tgId, refCode, STARTING_PLAYER_COINS, STARTING_PLAYER_GOLD_COINS, tgUser.language_code || 'uz']
    );
    user = ins.rows[0];
  } else {
    // Optionally update user properties if they changed on Telegram
    const updates = [];
    const params = [];
    if (username && user.username !== username && !user.nickname_set) {
      updates.push(`username = $${updates.length + 1}`);
      params.push(username);
    }
    if (updates.length > 0) {
      params.push(user.id);
      await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}`,
        params
      );
    }
  }

  if (user.is_banned) throw new HttpError(403, 'banned');

  const token = signToken({ uid: user.id });
  user.display_name = user.nickname || user.username;
  const needsNickname = !user.nickname || !user.nickname_set;

  return { user, token, isNewUser, needsNickname };
}
