import crypto from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

const ADMOB_KEYS_URL = process.env.ADMOB_SSV_KEYS_URL || 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const ADMOB_KEYS_TTL_MS = Math.min(
  24 * 60 * 60 * 1000,
  Math.max(5 * 60 * 1000, Number(process.env.ADMOB_SSV_KEYS_TTL_MS || 6 * 60 * 60 * 1000))
);
const ADMOB_CALLBACK_MAX_AGE_MS = Math.max(60_000, Number(process.env.ADMOB_SSV_MAX_AGE_MS || 24 * 60 * 60 * 1000));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cachedKeys = null;
let cachedKeysAt = 0;

function base64UrlToBuffer(value) {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = text.padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function pemFromBase64(base64) {
  const lines = String(base64 || '').match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

export function parseAdMobSsvQuery(rawQuery) {
  const queryString = String(rawQuery || '');
  const signatureMarker = 'signature=';
  const signatureIndex = queryString.indexOf(signatureMarker);
  if (signatureIndex <= 0 || queryString[signatureIndex - 1] !== '&') {
    throw new HttpError(400, 'invalid admob ssv signature position');
  }
  const signedContent = queryString.slice(0, signatureIndex - 1);
  const tail = queryString.slice(signatureIndex);
  const keyMarker = '&key_id=';
  const keyIndex = tail.indexOf(keyMarker);
  if (keyIndex === -1) throw new HttpError(400, 'admob ssv key_id required');

  const signature = tail.slice(signatureMarker.length, keyIndex);
  const keyId = tail.slice(keyIndex + keyMarker.length);
  if (!signature || !keyId || keyId.includes('&')) {
    throw new HttpError(400, 'invalid admob ssv signature params');
  }

  const params = new URLSearchParams(queryString);
  return {
    params,
    signedContent,
    signature,
    keyId,
    transactionId: params.get('transaction_id') || '',
    userId: extractAdMobUserId(params),
    adUnit: params.get('ad_unit') || '',
    rewardAmount: Number(params.get('reward_amount') || config.game.adBonus),
    rewardItem: params.get('reward_item') || 'coins',
    timestamp: Number(params.get('timestamp') || 0),
  };
}

function extractAdMobUserId(params) {
  const direct = params.get('user_id');
  if (direct) return direct;
  const custom = params.get('custom_data');
  if (!custom) return '';
  try {
    const parsed = JSON.parse(custom);
    return String(parsed.userId || parsed.user_id || parsed.id || '');
  } catch (_) {
    return custom;
  }
}

function allowedAdUnits() {
  return [
    config.appStore.admobRewardedAndroidId,
    config.appStore.admobRewardedIosId,
  ].filter(Boolean).map(String);
}

export function isAllowedAdUnit(adUnit) {
  const allowed = allowedAdUnits();
  if (!allowed.length) return true;
  const text = String(adUnit || '');
  return allowed.some((item) => item === text || item.split('/').pop() === text);
}

async function fetchAdMobKeys({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedKeys && now - cachedKeysAt < ADMOB_KEYS_TTL_MS) return cachedKeys;
  const res = await fetch(ADMOB_KEYS_URL, { headers: { Accept: 'application/json' } });
  const json = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(json?.keys)) {
    throw new HttpError(503, 'failed to fetch admob verification keys');
  }
  const keys = new Map();
  for (const key of json.keys) {
    const keyId = String(key.keyId ?? key.key_id ?? '');
    const pem = key.pem || pemFromBase64(key.base64);
    if (keyId && pem.includes('BEGIN PUBLIC KEY')) keys.set(keyId, pem);
  }
  if (!keys.size) throw new HttpError(503, 'admob verification keys unavailable');
  cachedKeys = keys;
  cachedKeysAt = now;
  return keys;
}

export async function verifyAdMobSsvSignature(rawQuery) {
  const parsed = parseAdMobSsvQuery(rawQuery);
  let keys = await fetchAdMobKeys();
  let pem = keys.get(String(parsed.keyId));
  if (!pem) {
    keys = await fetchAdMobKeys({ force: true });
    pem = keys.get(String(parsed.keyId));
  }
  if (!pem) throw new HttpError(403, 'unknown admob ssv key_id');

  const ok = crypto.verify(
    'sha256',
    Buffer.from(parsed.signedContent, 'utf8'),
    { key: pem, dsaEncoding: 'der' },
    base64UrlToBuffer(parsed.signature)
  );
  if (!ok) throw new HttpError(403, 'invalid admob ssv signature');
  return parsed;
}

export async function grantAdMobSsvReward(rawQuery) {
  const parsed = await verifyAdMobSsvSignature(rawQuery);
  if (!parsed.transactionId) throw new HttpError(400, 'admob transaction_id required');
  if (!parsed.userId) throw new HttpError(400, 'admob user_id required');
  if (!UUID_RE.test(parsed.userId)) throw new HttpError(400, 'invalid admob user_id');
  if (!isAllowedAdUnit(parsed.adUnit)) throw new HttpError(403, 'unexpected admob ad_unit');
  if (parsed.timestamp && Math.abs(Date.now() - parsed.timestamp) > ADMOB_CALLBACK_MAX_AGE_MS) {
    throw new HttpError(403, 'stale admob callback');
  }

  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO admob_ssv_rewards
        (transaction_id, user_id, ad_unit, reward_amount, reward_item, signature_key_id, raw_query, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING transaction_id`,
      [
        parsed.transactionId,
        parsed.userId,
        parsed.adUnit || null,
        Math.floor(Number.isFinite(parsed.rewardAmount) ? parsed.rewardAmount : config.game.adBonus),
        parsed.rewardItem,
        parsed.keyId,
        rawQuery,
      ]
    );
    if (!inserted.rows[0]) return { ok: true, duplicate: true, transactionId: parsed.transactionId };

    const user = await client.query('SELECT id, coins, last_ad_at FROM users WHERE id = $1', [parsed.userId]);
    if (!user.rows[0]) {
      await markAdMobReward(client, parsed.transactionId, 'rejected', 'user not found');
      return { ok: false, accepted: true, rejected: true, reason: 'user not found' };
    }

    const cooldownIv = `${Math.max(1, Math.floor(config.game.adCooldownHours))} hours`;
    const claim = await client.query(
      `UPDATE users
          SET last_ad_at = now(),
              coins = coins + $2
        WHERE id = $1
          AND ($3::bigint <= 0 OR coins <= $3)
          AND (last_ad_at IS NULL OR last_ad_at < now() - ($4)::interval)
        RETURNING coins`,
      [parsed.userId, config.game.adBonus, config.game.adBalanceCap, cooldownIv]
    );
    if (!claim.rows[0]) {
      await markAdMobReward(client, parsed.transactionId, 'rejected', 'cooldown or balance cap');
      return { ok: false, accepted: true, rejected: true, reason: 'cooldown or balance cap' };
    }

    await client.query(
      `INSERT INTO transactions (user_id, amount, type, metadata)
       VALUES ($1, $2, 'ad', $3)`,
      [parsed.userId, config.game.adBonus, {
        source: 'admob-ssv',
        admobTransactionId: parsed.transactionId,
        adUnit: parsed.adUnit || null,
        rewardAmount: parsed.rewardAmount,
        rewardItem: parsed.rewardItem,
      }]
    );
    await markAdMobReward(client, parsed.transactionId, 'credited', null);
    return {
      ok: true,
      credited: true,
      transactionId: parsed.transactionId,
      userId: parsed.userId,
      awarded: config.game.adBonus,
      coins: Number(claim.rows[0].coins),
    };
  });
}

async function markAdMobReward(client, transactionId, status, rejectionReason) {
  await client.query(
    `UPDATE admob_ssv_rewards
        SET status = $2,
            rejection_reason = $3,
            processed_at = now()
      WHERE transaction_id = $1`,
    [transactionId, status, rejectionReason]
  );
}

export function clearAdMobKeyCacheForTests() {
  cachedKeys = null;
  cachedKeysAt = 0;
}
