/**
 * Firebase Cloud Messaging v1 push helpers.
 *
 * Required env:
 *   FIREBASE_PROJECT_ID
 *   GOOGLE_SERVICE_ACCOUNT_JSON
 *
 * Missing credentials make push a no-op in local development.
 */
import crypto from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { logger } from '../logger.js';

let cachedAccessToken = null;
let cachedAccessTokenExp = 0;

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return parsed;
  } catch (err) {
    logger.warn('[push] GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON: %s', err.message);
    return null;
  }
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenExp - 60 > now) return cachedAccessToken;

  const sa = serviceAccount();
  if (!sa?.client_email || !sa?.private_key) return null;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64url(signer.sign(sa.private_key))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    logger.warn('[push] OAuth token request failed: %s', json.error_description || json.error || res.statusText);
    return null;
  }
  cachedAccessToken = json.access_token;
  cachedAccessTokenExp = now + Number(json.expires_in || 3600);
  return cachedAccessToken;
}

export async function sendPush(fcmToken, title, body, data = {}) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || !fcmToken) return;

  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    const payload = {
      message: {
        token: fcmToken,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high', notification: { sound: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      },
    };
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('[push] FCM v1 delivery failed: %s %s', res.status, text.slice(0, 300));
    }
  } catch (err) {
    logger.error('[push] sendPush error', err.message);
  }
}

export function pushTurnReminder(fcmToken, roomCode) {
  return sendPush(fcmToken, 'Durak Online', "It's your turn!", {
    type: 'turn_reminder',
    roomCode,
  });
}

export function pushGameInvite(fcmToken, fromNickname, roomCode, details = {}) {
  const privateLabel = details.isPrivate ? 'yopiq stolga' : "o'yinga";
  const body = `@${fromNickname} sizni ${privateLabel} taklif qilyapti. Kod: ${roomCode}`;
  return sendPush(
    fcmToken,
    'Durak Imperia',
    body,
    {
      type: 'game_invite',
      roomCode,
      code: roomCode,
      password: details.password || '',
      fromNickname,
      isPrivate: details.isPrivate ? '1' : '0',
      stake: details.stake ?? '',
      maxPlayers: details.maxPlayers ?? '',
      roomTitle: details.roomTitle || roomCode,
    }
  );
}

export function pushFriendRequest(fcmToken, fromNickname) {
  return sendPush(
    fcmToken,
    'Friend Request',
    `@${fromNickname} wants to be your friend`,
    { type: 'friend_request', fromNickname }
  );
}
