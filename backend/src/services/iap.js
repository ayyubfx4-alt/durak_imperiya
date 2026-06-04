import crypto from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { GOLD_BUNDLES, config } from '../config.js';
import { logger } from '../logger.js';
import { HttpError } from '../middleware/error.js';

export const PRODUCTS = {
  ...Object.fromEntries(GOLD_BUNDLES.map((b) => [
    b.id,
    { gold_coins: b.goldCoins, coins: 0, premium_days: 0, price_usd: b.priceUsd, kind: 'product' },
  ])),
  premium_month: {
    gold_coins: 0,
    coins: 0,
    premium_days: 30,
    price_usd: config.premium.monthlyUsd,
    kind: 'subscription',
  },
  premium_quarter: {
    gold_coins: 0,
    coins: 0,
    premium_days: 90,
    price_usd: config.premium.quarterlyUsd,
    kind: 'subscription',
  },
  premium_year: {
    gold_coins: 0,
    coins: 0,
    premium_days: 365,
    price_usd: config.premium.yearlyUsd,
    kind: 'subscription',
  },
};

let cachedGoogleAccessToken = null;
let cachedGoogleAccessTokenExp = 0;

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function googleServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return parsed;
  } catch (err) {
    logger.warn('[iap] GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON: %s', err.message);
    return null;
  }
}

async function googleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleAccessToken && cachedGoogleAccessTokenExp - 60 > now) {
    return cachedGoogleAccessToken;
  }

  const sa = googleServiceAccount();
  if (!sa?.client_email || !sa?.private_key) return null;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
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
    logger.warn('[iap] Google OAuth token failed: %s', json.error_description || json.error || res.statusText);
    return null;
  }
  cachedGoogleAccessToken = json.access_token;
  cachedGoogleAccessTokenExp = now + Number(json.expires_in || 3600);
  return cachedGoogleAccessToken;
}

async function androidPublisherGet(path, accessToken) {
  const res = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.warn('[iap] Android Publisher request failed: %s', json.error?.message || res.statusText);
    return null;
  }
  return json;
}

function allowMockIap() {
  return process.env.ALLOW_MOCK_IAP === '1' && process.env.NODE_ENV !== 'production';
}

async function verifyGooglePlay(productId, purchaseToken) {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;

  const accessToken = await googleAccessToken();
  if (!accessToken || !packageName) {
    if (allowMockIap()) {
      logger.warn('[iap] Google Play credentials missing; accepting mock IAP because ALLOW_MOCK_IAP=1');
      return true;
    }
    throw new HttpError(503, 'Google Play IAP credentials are not configured');
  }

  try {
    if (productId.startsWith('premium_')) {
      const path = `applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
      const data = await androidPublisherGet(path, accessToken);
      const activeStates = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD']);
      const productMatches = Array.isArray(data?.lineItems)
        ? data.lineItems.some((item) => item.productId === productId)
        : false;
      return productMatches && activeStates.has(data?.subscriptionState);
    }

    const path = `applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
    const data = await androidPublisherGet(path, accessToken);
    return Number(data?.purchaseState) === 0;
  } catch (err) {
    logger.error('[iap] Google Play verification error', err.message);
    throw new HttpError(402, 'Google Play receipt verification failed');
  }
}

async function verifyAppStore(productId, receipt) {
  const sharedSecret = process.env.APPLE_SHARED_SECRET;

  if (!sharedSecret) {
    if (allowMockIap()) {
      logger.warn('[iap] Apple shared secret missing; accepting mock IAP because ALLOW_MOCK_IAP=1');
      return true;
    }
    throw new HttpError(503, 'App Store IAP credentials are not configured');
  }

  const body = { 'receipt-data': receipt, password: sharedSecret, 'exclude-old-transactions': true };
  for (const url of [
    'https://buy.itunes.apple.com/verifyReceipt',
    'https://sandbox.itunes.apple.com/verifyReceipt',
  ]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.status === 21007) continue;
      if (json.status !== 0) throw new HttpError(402, `App Store receipt invalid (status ${json.status})`);
      const inApp = json.latest_receipt_info || json.receipt?.in_app || [];
      return inApp.some((t) => t.product_id === productId);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      logger.error('[iap] App Store fetch error', err.message);
    }
  }
  throw new HttpError(402, 'App Store verification failed');
}

export async function verifyIAP(platform, productId, receipt) {
  const product = PRODUCTS[productId];
  if (!product) throw new HttpError(400, `Unknown productId: ${productId}`);

  let valid = false;
  if (platform === 'android') valid = await verifyGooglePlay(productId, receipt);
  else if (platform === 'ios') valid = await verifyAppStore(productId, receipt);
  else throw new HttpError(400, 'platform must be "android" or "ios"');

  if (!valid) throw new HttpError(402, 'Purchase could not be verified');
  return product;
}
