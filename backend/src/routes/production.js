import { Router } from 'express';
import { config } from '../config.js';
import { authRequired, adminRequired } from '../middleware/auth.js';

export const productionRouter = Router();

const GOOGLE_SAMPLE = ['ca-app-pub', '394025', '6099942544'].join('-').replace('025-', '025');
const PLACEHOLDER_SECRET = /(change|changeme|change-me|change_this|example|required|demo|test|password|secret|your-|local)/i;

function item(key, ok, message, owner = 'code') {
  return { key, ok: !!ok, message, owner };
}

function parseIceServers(value) {
  const raw = String(value || '').trim();
  if (!raw) return { configured: false, ok: true, servers: [] };
  try {
    const parsed = JSON.parse(raw);
    return { configured: true, ok: Array.isArray(parsed), servers: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { configured: true, ok: false, servers: [] };
  }
}

function iceUrls(server) {
  if (!server || typeof server !== 'object') return [];
  const { urls } = server;
  return (Array.isArray(urls) ? urls : [urls]).filter((url) => typeof url === 'string');
}

function isTurnServer(server) {
  return iceUrls(server).some((url) => /^turns?:/i.test(url));
}

function hasTurnCredentialsInIce(server) {
  if (!isTurnServer(server)) return false;
  return !!String(server.username || '').trim() && !!String(server.credential || '').trim();
}

function isProductionValue(value, minLength = 8) {
  const text = String(value || '').trim();
  return text.length >= minLength && !PLACEHOLDER_SECRET.test(text);
}

productionRouter.get('/readiness', authRequired, adminRequired, (_req, res) => {
  const app = config.appStore;
  const platforms = new Set(app.releasePlatforms.length ? app.releasePlatforms : ['android']);
  const needsIos = platforms.has('ios');
  const needsAndroid = platforms.has('android');
  const firebaseWebConfigured = [
    process.env.FIREBASE_API_KEY,
    process.env.FIREBASE_AUTH_DOMAIN,
    process.env.FIREBASE_PROJECT_ID,
    process.env.FIREBASE_MESSAGING_SENDER_ID,
    process.env.FIREBASE_APP_ID,
  ].every((value) => !!String(value || '').trim());
  const voiceIce = parseIceServers(process.env.VOICE_ICE_SERVERS);
  const voiceIceUrls = voiceIce.servers.flatMap(iceUrls);
  const turnCredentialsConfigured = isProductionValue(process.env.TURN_USER, 3)
    && isProductionValue(process.env.TURN_PASSWORD, 16);
  const voiceRuntimeWillAutoGenerateTurn = !voiceIce.configured
    && turnCredentialsConfigured
    && /^https:\/\//.test(app.publicUrl);
  const explicitTurnHasCredentials = voiceIce.servers.some(hasTurnCredentialsInIce);
  const voiceHasStun = voiceIceUrls.some((url) => /^stun:/i.test(url)) || voiceRuntimeWillAutoGenerateTurn;
  const voiceHasTurn = voiceIceUrls.some((url) => /^turns?:/i.test(url)) || voiceRuntimeWillAutoGenerateTurn;
  const checks = [
    item('app.name', app.appName === 'Durak Imperia', 'Play Market name must be Durak Imperia'),
    item('app.keywords', app.searchKeywords.join(',') === 'Durak,Online,Card Game,Imperia', 'Search keywords are configured'),
    item('server.publicUrl', /^https:\/\//.test(app.publicUrl), 'PUBLIC_APP_URL must be the real HTTPS production URL', 'deploy'),
    item('server.cors', !!config.corsOrigin && config.corsOrigin !== '*' && /^https:\/\//.test(String(config.corsOrigin).split(',')[0].trim()), 'CORS_ORIGIN must be your HTTPS production origin, not *', 'security'),
    item('google.packageName', app.packageName === 'com.durakimperia.game', 'Google Play package name is configured'),
    item('firebase.web', firebaseWebConfigured, 'Set Firebase Web config so Google sign-in can open', 'firebase'),
    item('firebase.project', !!process.env.FIREBASE_PROJECT_ID, 'Set FIREBASE_PROJECT_ID so Google id tokens are verified', 'firebase'),
    item('android.targetSdk', Number(process.env.ANDROID_TARGET_SDK || 0) >= 36, 'Android targetSdkVersion must be 36+ for this release build', 'android'),
    item('billing.library', Number(process.env.GOOGLE_PLAY_BILLING_MAJOR || 0) >= 8, 'Use Google Play Billing Library 8+ compatible native purchase plugin', 'android'),
    item('admob.androidAppId', !needsAndroid || (app.admobAndroidAppId && !app.admobAndroidAppId.includes(GOOGLE_SAMPLE)), 'Set real AdMob Android app id', 'admob'),
    item('admob.iosAppId', !needsIos || (app.admobIosAppId && !app.admobIosAppId.includes(GOOGLE_SAMPLE)), 'Set real AdMob iOS app id when RELEASE_PLATFORMS includes ios', 'admob'),
    item('admob.rewardedAndroid', !needsAndroid || (app.admobRewardedAndroidId && !app.admobRewardedAndroidId.includes(GOOGLE_SAMPLE)), 'Set real rewarded Android ad unit id', 'admob'),
    item('admob.rewardedIos', !needsIos || (app.admobRewardedIosId && !app.admobRewardedIosId.includes(GOOGLE_SAMPLE)), 'Set real rewarded iOS ad unit id when RELEASE_PLATFORMS includes ios', 'admob'),
    item('admob.categories', process.env.ADMOB_HALAL_CATEGORIES_BLOCKED === '1', 'Block Gambling & Betting and Social Casino Games in AdMob console', 'admob'),
    item('iap.google', !needsAndroid || !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'Google Play Billing service account must be configured', 'play-console'),
    item('iap.apple', !needsIos || !!process.env.APPLE_SHARED_SECRET, 'App Store shared secret must be configured when RELEASE_PLATFORMS includes ios', 'app-store'),
    item('stripe.liveKey', !process.env.STRIPE_SECRET_KEY || String(process.env.STRIPE_SECRET_KEY).startsWith('sk_live_'), 'Use a Stripe live secret key in production, or leave Stripe disabled until it is ready', 'stripe'),
    item('stripe.webhookSecret', !process.env.STRIPE_SECRET_KEY || !!process.env.STRIPE_WEBHOOK_SECRET, 'Set STRIPE_WEBHOOK_SECRET whenever Stripe payments are enabled', 'stripe'),
    item('premium.prices', process.env.PREMIUM_PRICES_APPROVED === '1', 'Premium prices must be approved before release', 'business'),
    item('gdevelop.silver', process.env.GDEVELOP_SILVER_ACTIVE === '1' || process.env.USE_NODE_BACKEND_ONLY !== '0', 'Node backend is the official multiplayer backend; set GDEVELOP_SILVER_ACTIVE=1 only if using GDevelop services', 'business'),
    item('admin.password', !!process.env.ADMIN_BOOTSTRAP_PASSWORD && process.env.ADMIN_BOOTSTRAP_PASSWORD !== 'changeme', 'Set a strong ADMIN_BOOTSTRAP_PASSWORD before exposing the admin panel', 'security'),
    item('admin.pin', !!process.env.ADMIN_PIN && !['2202', '0000', '1111', '1234'].includes(String(process.env.ADMIN_PIN)), 'Set a private ADMIN_PIN instead of the local demo PIN', 'security'),
    item('jwt.secret', !!process.env.JWT_SECRET && String(process.env.JWT_SECRET).length >= 32 && process.env.JWT_SECRET !== 'dev-secret-change-me', 'Set a strong JWT_SECRET (32+ chars)', 'security'),
    item('privacy.policy', /^https:\/\//.test(process.env.PRIVACY_POLICY_URL || ''), 'Set HTTPS PRIVACY_POLICY_URL for Play Market listing', 'play-console'),
    item('voice.ice.format', voiceIce.ok, 'VOICE_ICE_SERVERS must be a JSON array when set', 'voice'),
    item('voice.ice.stun', voiceHasStun, 'Voice chat needs a STUN ICE server or TURN auto-generation from PUBLIC_APP_URL', 'voice'),
    item('voice.ice.turn', voiceHasTurn, 'Voice chat needs a TURN ICE server for players behind strict NAT/mobile networks', 'voice'),
    item('voice.turn.credentials', turnCredentialsConfigured && (!voiceIce.configured || explicitTurnHasCredentials), 'Set real TURN_USER and 16+ char TURN_PASSWORD, and include credentials in explicit TURN ICE config', 'voice'),
    item('release.signing', process.env.ANDROID_RELEASE_KEYSTORE_READY === '1', 'Android release keystore must be generated and backed up', 'play-console'),
  ];
  const ok = checks.every((c) => c.ok);
  res.status(ok ? 200 : 428).json({
    ok,
    appName: app.appName,
    searchKeywords: app.searchKeywords,
    releasePlatforms: [...platforms],
    nextActions: checks.filter((c) => !c.ok).map((c) => ({ key: c.key, owner: c.owner, message: c.message })),
    checks,
  });
});
