/**
 * Google/Firebase auth service.
 * Verifies Firebase ID tokens against Google's public securetoken certs and
 * upserts the Durak Imperia user row.
 */

import crypto from 'node:crypto';
import { query } from '../db.js';
import { signToken } from '../util/jwt.js';
import { randomCode } from '../util/random.js';
import { HttpError } from '../middleware/error.js';
import { logger } from '../logger.js';
import { STARTING_PLAYER_COINS, STARTING_PLAYER_GOLD_COINS } from './economyDefaults.js';

let certCache = null;
let certCacheExpiresAt = 0;
const NICKNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function fetchFirebaseCerts() {
  const now = Date.now();
  if (certCache && certCacheExpiresAt > now + 60_000) return certCache;
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', {
    cache: 'no-store',
  });
  if (!res.ok) throw new HttpError(503, 'Firebase public keys unavailable');
  certCache = await res.json();
  const maxAge = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 3600);
  certCacheExpiresAt = now + maxAge * 1000;
  return certCache;
}

async function verifyFirebaseToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Google token invalid');

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId && process.env.NODE_ENV !== 'production') {
    logger.warn('[googleAuth] WARNING: skipping Firebase token verification (dev mode)');
    const payload = decodeJwtPart(parts[1]);
    return {
      uid: payload.user_id || payload.sub,
      email: payload.email || null,
      name: payload.name || payload.email?.split('@')[0] || 'Player',
      picture: payload.picture || null,
    };
  }
  if (!projectId) throw new HttpError(503, 'Firebase project id is not configured');

  const [headB64, payB64, sigB64] = parts;
  const header = decodeJwtPart(headB64);
  const payload = decodeJwtPart(payB64);
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'Google token invalid');

  const certs = await fetchFirebaseCerts();
  const cert = certs[header.kid];
  if (!cert) throw new HttpError(401, 'Google token key is unknown');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headB64}.${payB64}`);
  verifier.end();
  if (!verifier.verify(cert, Buffer.from(sigB64, 'base64url'))) {
    throw new HttpError(401, 'Google token signature invalid');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new HttpError(401, 'Google token audience invalid');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new HttpError(401, 'Google token issuer invalid');
  }
  if (!payload.sub || typeof payload.sub !== 'string') throw new HttpError(401, 'Google token subject invalid');
  if (Number(payload.exp || 0) <= now) throw new HttpError(401, 'Google token expired');
  if (Number(payload.iat || 0) > now + 60) throw new HttpError(401, 'Google token issued in the future');

  return {
    uid: payload.user_id || payload.sub,
    email: payload.email || null,
    name: payload.name || payload.email?.split('@')[0] || 'Player',
    picture: payload.picture || null,
  };
}

function nicknameBaseFromGoogle(decoded) {
  const source = decoded.name || decoded.email?.split('@')[0] || `player_${randomCode(6).toLowerCase()}`;
  let base = String(source)
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

function withSuffix(base, suffix) {
  const safeSuffix = String(suffix || '');
  const maxBase = Math.max(3, 24 - safeSuffix.length);
  return `${base.slice(0, maxBase).replace(/_+$/g, '')}${safeSuffix}`;
}

async function handleTaken(nickname, excludeUserId = null) {
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

async function uniqueGoogleNickname(decoded, excludeUserId = null) {
  const base = nicknameBaseFromGoogle(decoded);

  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : withSuffix(base, i + 1);
    if (NICKNAME_RE.test(candidate) && !(await handleTaken(candidate, excludeUserId))) {
      return candidate;
    }
  }

  for (let i = 0; i < 20; i++) {
    const candidate = withSuffix(base, `_${randomCode(4).toLowerCase()}`);
    if (NICKNAME_RE.test(candidate) && !(await handleTaken(candidate, excludeUserId))) {
      return candidate;
    }
  }

  throw new HttpError(409, 'could not allocate nickname');
}

async function hydrateGoogleUserProfile(user, decoded) {
  const { email, picture } = decoded;
  if (user.nickname && user.nickname_set) {
    const r = await query(
      `UPDATE users
          SET avatar_url = COALESCE(avatar_url, $1),
              email = COALESCE(email, ($2::text)::varchar(255))
        WHERE id = $3
        RETURNING id, username, nickname, nickname_set, email, coins, gold_coins, games_played,
                  premium_until, is_admin, is_banned, avatar_url`,
      [picture, email, user.id]
    );
    return r.rows[0] || user;
  }

  const nickname = user.nickname && NICKNAME_RE.test(user.nickname)
    ? user.nickname
    : await uniqueGoogleNickname(decoded, user.id);

  const r = await query(
    `UPDATE users
        SET avatar_url = COALESCE(avatar_url, $1),
            email = COALESCE(email, ($2::text)::varchar(255)),
            nickname = $3::text,
            nickname_set = TRUE,
            username = CASE
              WHEN username ~ '^user_[a-z0-9]{6}$' THEN ($3::text)::varchar(32)
              ELSE username
            END
      WHERE id = $4
      RETURNING id, username, nickname, nickname_set, email, coins, gold_coins, games_played,
                premium_until, is_admin, is_banned, avatar_url`,
    [picture, email, nickname, user.id]
  );
  return r.rows[0] || user;
}

export async function googleSignIn(idToken) {
  if (!idToken) throw new HttpError(400, 'idToken is required');

  let decoded;
  try {
    decoded = await verifyFirebaseToken(idToken);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.warn('[googleAuth] token verification failed', err.message);
    throw new HttpError(401, 'Google token invalid or expired');
  }
  const { uid, email, picture } = decoded;

  let r = await query(
    `SELECT id, username, nickname, nickname_set, coins, gold_coins, games_played, premium_until, is_admin, is_banned, avatar_url
       FROM users WHERE google_id = $1`,
    [uid]
  );

  let user = r.rows[0];
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    let refCode;
    for (let i = 0; i < 5; i++) {
      refCode = randomCode(8);
      const c = await query('SELECT id FROM users WHERE referral_code = $1', [refCode]);
      if (!c.rows[0]) break;
    }
    const ins = await query(
      `INSERT INTO users
         (username, nickname, google_id, email, avatar_url, referral_code, coins, gold_coins, nickname_set)
       VALUES (($1::text)::varchar(32), $1::text, ($2::text)::varchar(64), ($3::text)::varchar(255), $4::text, ($5::text)::varchar(16), $6, $7, TRUE)
       RETURNING id, username, nickname, nickname_set, email, coins, gold_coins, games_played, premium_until, is_admin, is_banned, avatar_url`,
      [await uniqueGoogleNickname(decoded), uid, email, picture, refCode, STARTING_PLAYER_COINS, STARTING_PLAYER_GOLD_COINS]
    );
    user = ins.rows[0];
  } else {
    user = await hydrateGoogleUserProfile(user, decoded);
  }

  if (user.is_banned) throw new HttpError(403, 'banned');

  const token = signToken({ uid: user.id });
  user.display_name = user.nickname || user.username;
  const needsNickname = !user.nickname || !user.nickname_set;
  return { user, token, isNewUser, needsNickname };
}

export async function checkNickname(nick) {
  if (!nick || !/^[A-Za-z0-9_]{3,24}$/.test(nick)) {
    throw new HttpError(400, 'nickname must be 3-24 chars, letters/digits/underscore only');
  }
  const r = await query(
    'SELECT id FROM users WHERE lower(nickname) = lower($1)',
    [nick]
  );
  return { available: !r.rows[0] };
}

export async function setNickname(userId, nick) {
  if (!nick || !/^[A-Za-z0-9_]{3,24}$/.test(nick)) {
    throw new HttpError(400, 'nickname must be 3-24 chars, letters/digits/underscore only');
  }
  const taken = await query(
    'SELECT id FROM users WHERE lower(nickname) = lower($1) AND id != $2',
    [nick, userId]
  );
  if (taken.rows[0]) throw new HttpError(409, 'nickname already taken');

  await query(
    'UPDATE users SET nickname = $1, nickname_set = TRUE WHERE id = $2',
    [nick, userId]
  );
  return { ok: true, nickname: nick };
}
