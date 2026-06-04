// dotenv is optional — load it if available (production / dev), skip in test
// environments where node_modules may only contain the packages needed for tests.
try { await import('dotenv/config'); } catch { /* dotenv not installed — env vars from shell */ }


const TELEGRAM_OWNER_ID = '8324791195';
const TELEGRAM_ADMIN_IDS = ['8324791195', '8396560736'];
const GOOGLE_PLAY_PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.durakimperia.game';
const DEFAULT_PLAY_MARKET_URL = `https://play.google.com/store/apps/details?id=${GOOGLE_PLAY_PACKAGE_NAME}`;

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function origins(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '*') return raw || '*';
  const nativeOrigins = ['http://localhost', 'https://localhost', 'capacitor://localhost', 'ionic://localhost'];
  return [...new Set([
    ...raw.split(',').map((s) => s.trim()).filter(Boolean),
    ...nativeOrigins,
  ])];
}

/**
 * Bet tiers — Durak Online TOR v4 §4.1.
 * Only these stake values are accepted when creating a room or joining a
 * paying table. Server validates against this list; the client renders it as
 * the bet picker.
 */
const BET_TIERS = (() => {
  const head = [100, 200, 250, 500, 1000, 2500, 3000];
  const ramp = [];
  // 5 000 → 40 000 step 5 000
  for (let v = 5000; v <= 40000; v += 5000) ramp.push(v);
  // 45 000 → 1 000 000 step 5 000
  for (let v = 45000; v <= 1000000; v += 5000) ramp.push(v);
  return [...head, ...ramp];
})();

/**
 * Gold Coin shop bundles — TOR §4.2.
 * One Gold Coin ≈ $0.018 USD when bought in bulk; converted to virtual $ at
 * roughly 182 Durak Dollars per Gold Coin. Numbers come straight from the TOR.
 */
const GOLD_BUNDLES = [
  { id: 'gold_55',    goldCoins: 55,    priceUsd: 1,   dollarsEquiv: 10000  },
  { id: 'gold_165',   goldCoins: 165,   priceUsd: 3,   dollarsEquiv: 30000  },
  { id: 'gold_560',   goldCoins: 560,   priceUsd: 10,  dollarsEquiv: 101800 },
  { id: 'gold_1900',  goldCoins: 1900,  priceUsd: 40,  dollarsEquiv: 345500 },
  { id: 'gold_6800',  goldCoins: 6800,  priceUsd: 100, dollarsEquiv: 1236000 },
];

/**
 * Dollar bundles paid in Gold Coin (in-game conversion). The conversion ratio
 * is dollarsEquiv / goldCoins from the corresponding GOLD_BUNDLES row.
 */
const DOLLAR_BUNDLES = GOLD_BUNDLES.map((b) => ({
  id: `dollars_${b.dollarsEquiv}`,
  dollars: b.dollarsEquiv,
  costGoldCoins: b.goldCoins,
}));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 4000),
  jwt: {
    secret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-change-me'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  databaseUrl: process.env.DATABASE_URL || 'postgres://durak:durak@localhost:5432/durak',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  corsOrigins: origins(process.env.CORS_ORIGIN || '*'),
  admin: {
    email: process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@durak.local',
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD || '2202',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    publicKey: process.env.STRIPE_PUBLIC_KEY || '',
    successUrl: process.env.STRIPE_SUCCESS_URL || 'http://localhost:8080/#/donations?donation=success',
    cancelUrl: process.env.STRIPE_CANCEL_URL || 'http://localhost:8080/#/donations?donation=cancel',
  },
  game: {
    // TOR §4.1: Durak Dollars min/max
    minBet: Math.max(100, int(process.env.MIN_BET, 100)),
    maxBet: int(process.env.MAX_BET, 1_000_000),
    betTiers: BET_TIERS,
    // TOR §4.1: Ad reward — 800 $ per click, 6 h cooldown.
    // Cap is 1 000 $ — users with a balance above this threshold
    // cannot claim ad bonuses (prevents wealthy players from farming free coins).
    adBonus: int(process.env.AD_BONUS_DOLLARS, 800),
    adCooldownHours: int(process.env.AD_COOLDOWN_HOURS, 6),
    adBalanceCap: int(process.env.AD_BALANCE_CAP, 1000),
    // Daily bonus is removed in v4 (see TOR). Kept as 0 for ledger compatibility.
    dailyBonus: 0,
    premiumDailyBonus: 0,
    // Referral economy — TOR §13: 32-generation binary tree.
    //   • Direct (level 1): $5 once the referee plays 3+ games
    //   • Levels 2..32: $1 each, gated by the same 3+ games threshold
    //   • A user who completes the full 32-deep tree earns the "lider"
    //     title and a pair of exclusive emoji/card-skin grants.
    referralBonus: int(process.env.REFERRAL_BONUS_DOLLARS, 5),                  // level-1 reward
    referralDownstreamBonus: int(process.env.REFERRAL_DOWNSTREAM_BONUS_DOLLARS, 1), // levels 2..32
    referralGamesRequired: int(process.env.REFERRAL_GAMES_REQUIRED, 3),
    referralMaxLevel: int(process.env.REFERRAL_MAX_LEVEL, 32),
    referralLeaderDepth: int(process.env.REFERRAL_LEADER_DEPTH, 32),
    // Free emoji/skin grants when a user fills the 32-level tree.
    referralLeaderExclusiveEmoji: process.env.REFERRAL_LEADER_EMOJI || 'pack_50',
    referralLeaderExclusiveSkin: process.env.REFERRAL_LEADER_SKIN || 'celestial',
    // TOR §3: bot-fill timeout + per-turn timeout (auto-loss on expiry).
    botFillTimeoutMs: int(process.env.BOT_FILL_TIMEOUT_MS, 30000),
    turnTimeoutMs: int(process.env.TURN_TIMEOUT_MS, 30000),
    botPoolSize: int(process.env.BOT_POOL_SIZE, 100), // Band 32: admin yaratgan 100 ta tizim boti
    // TOR §3: tables come in fixed sizes.
    allowedTableSizes: [2, 3, 4, 6],
    friendCoinGiftDailyLimit: int(process.env.FRIEND_COIN_GIFT_DAILY_LIMIT, 50_000),
    // TOR §5: tournament defaults.
    tournament: {
      entryGoldCoins: int(process.env.TOURNAMENT_ENTRY_GOLD, 35),     // Band 33: 35 GC kirish
      entryTicketEnabled: true,                                         // turnir chiptasi bilan ham kirish
      prizeFirstGoldCoins: int(process.env.TOURNAMENT_PRIZE_FIRST_GOLD, 150),  // Band 33: 1-o'rin 150 GC
      prizeSecondGoldCoins: int(process.env.TOURNAMENT_PRIZE_SECOND_GOLD, 75),
      prizeThirdGoldCoins: int(process.env.TOURNAMENT_PRIZE_THIRD_GOLD, 35),
      broadcastThreshold: 32, // Band 29: 32 qolganida translyatsiya boshlanadi
    },
    // TOR §4.3: special prize on a 1 000 000 $ win.
    elonStickerStakeThreshold: 1_000_000,
    deckSize: 36,
    handSize: 6,
    // TOR §11: Gold Coin in-game perks (normal rooms only — tournament
    // tables explicitly reject these calls). Reveal durations are returned
    // to the client so the UI countdown matches the server policy.
    perks: {
      peekOpponentsCostGold: int(process.env.PERK_PEEK_OPPONENTS_GOLD, 3),
      peekOpponentsRevealMs: int(process.env.PERK_PEEK_OPPONENTS_MS, 5000),
      peekNextCardCostGold: int(process.env.PERK_PEEK_NEXT_CARD_GOLD, 1),
      peekNextCardRevealMs: int(process.env.PERK_PEEK_NEXT_CARD_MS, 3000),
      bestMoveHintCostGold: int(process.env.PERK_BEST_MOVE_HINT_GOLD, 1),
    },
    // TOR §14: ban durations available to admins via the report tool.
    banDurations: {
      one_month: 30,
      three_months: 90,
      six_months: 180,
      one_year: 365,
      permanent: null,
    },
  },
  // Band 28: GDevelop Silver plan ($9.99/oy) sozlamalari
  silver: {
    plan: 'silver',
    maxConcurrentLobbies: 99999, // cheksiz lobbies Silver plan
    maxDailyUsers: 10000,
    monthlyFeeUsd: 9.99,
    note: 'Play Market ga chiqishdan oldin Silver plan faollashtiring',
  },
  shop: {
    goldBundles: GOLD_BUNDLES,
    dollarBundles: DOLLAR_BUNDLES,
  },
  // Feature 33: Premium subscription tiers (narxlar keyinroq belgilanishi mumkin)
  premium: {
    monthlyUsd:    process.env.PREMIUM_MONTHLY_USD ? Number(process.env.PREMIUM_MONTHLY_USD) : null,
    quarterlyUsd:  process.env.PREMIUM_QUARTERLY_USD ? Number(process.env.PREMIUM_QUARTERLY_USD) : null,
    yearlyUsd:     process.env.PREMIUM_YEARLY_USD ? Number(process.env.PREMIUM_YEARLY_USD) : null,
  },
  appStore: {
    appName: 'Durak Imperia',
    searchKeywords: ['Durak', 'Online', 'Card Game', 'Imperia'],
    releasePlatforms: String(process.env.RELEASE_PLATFORMS || 'android').split(',').map((s) => s.trim()).filter(Boolean),
    packageName: GOOGLE_PLAY_PACKAGE_NAME,
    publicUrl: process.env.PUBLIC_APP_URL || '',
    admobAndroidAppId: process.env.ADMOB_ANDROID_APP_ID || '',
    admobIosAppId: process.env.ADMOB_IOS_APP_ID || '',
    admobRewardedAndroidId: process.env.ADMOB_REWARDED_ANDROID_ID || '',
    admobRewardedIosId: process.env.ADMOB_REWARDED_IOS_ID || '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    gameUrl: process.env.TELEGRAM_GAME_URL || process.env.PUBLIC_APP_URL || 'http://62.171.185.105:18081/',
    adminUrl: process.env.TELEGRAM_ADMIN_URL || process.env.PUBLIC_ADMIN_URL || '',
    ownerId: String(process.env.TELEGRAM_OWNER_ID || TELEGRAM_OWNER_ID).trim(),
    heroImageUrl: process.env.TELEGRAM_HERO_IMAGE_URL || '',
    playMarketUrl: process.env.TELEGRAM_PLAY_MARKET_URL || process.env.PLAY_MARKET_URL || DEFAULT_PLAY_MARKET_URL,
    starsEnabled: String(process.env.TELEGRAM_STARS_ENABLED ?? '1') !== '0',
    starsCurrency: 'XTR',
    adminIds: String(process.env.TELEGRAM_ADMIN_IDS || process.env.TELEGRAM_OWNER_ID || TELEGRAM_ADMIN_IDS.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter((id, index, arr) => id && arr.indexOf(id) === index),
    pollingEnabled: String(process.env.TELEGRAM_BOT_POLLING_ENABLED ?? '1') !== '0',
    pollingInstanceId: process.env.TELEGRAM_BOT_INSTANCE_ID || 'durak-be-1',
    dropPendingUpdates: process.env.TELEGRAM_DROP_PENDING_UPDATES === '1',
  },
  // Feature 31: Baraban spin wheel
  baraban: {
    jackpotGold:              50,
    freeSpinsPerDay:          1,
    inactiveMultiplier2xDays: 7,
    inactiveMultiplier5xDays: 30,
    gamesRequired:            10,
  },
  // Feature 30: Voice chat free daily limit
  voiceChat: {
    freeDailyLimit: 3,
  },
  // Feature 24: In-game AI chatbot limits
  aiChat: {
    freeDailyLimit:    30,   // oddiy foydalanuvchi: kuniga 30 so'rov
    premiumDailyLimit: 0,    // 0 = cheksiz (unlimited)
    modelId: 'SmolLM2-360M-Instruct-q4f16_1-MLC', // WebLLM model
  },
};

/** Public re-exports for routes / web client / tests. */
export { BET_TIERS, GOLD_BUNDLES, DOLLAR_BUNDLES };

/** Return true if `bet` is one of the discrete tiers permitted by the TOR. */
export function isValidBetTier(bet) {
  return Number.isFinite(bet) && BET_TIERS.includes(bet);
}

// Validate critical secrets on boot. Refuse to start in production with the
// default JWT secret or a wide-open CORS policy. Skip validation when the
// process is started with VALIDATION_SKIP=1 (used by some test runners).
(function validateSecrets() {
  if (process.env.VALIDATION_SKIP === '1') return;
  const secret = process.env.JWT_SECRET;
  const forbiddenSecrets = new Set([
    'dev-secret-change-me',
    'replace-with-strong-random-secret',
    'changeme',
    'change-me',
    'secret',
    'password',
    'jwt-secret',
    'default',
    'dev-only-local-secret-change-before-production-0000000000000000',
  ]);
  if (!secret || forbiddenSecrets.has(String(secret).trim().toLowerCase()) || String(secret).length < 32) {
    if (config.env === 'production') {
      console.error('FATAL: JWT_SECRET must be set to a strong random value in production');
      process.exit(1);
    } else {
      console.warn('WARNING: Using default JWT_SECRET — change before deploying to production!');
    }
  }
  const adminPin = String(process.env.ADMIN_PIN || '');
  if (config.env === 'production' && !adminPin) {
    console.error('FATAL: ADMIN_PIN must be set in production');
    process.exit(1);
  }
  if (config.env === 'production' && ['2202', '0000', '1111', '1234'].includes(adminPin)) {
    console.warn('WARNING: ADMIN_PIN is using a simple value; change it from the admin settings before public launch.');
  }
  if (config.env === 'production' && (!process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD === 'changeme')) {
    console.warn('WARNING: ADMIN_BOOTSTRAP_PASSWORD is unset or default — change before exposing the admin panel.');
  }
  if (config.env === 'production' && config.corsOrigin === '*') {
    console.error('FATAL: CORS_ORIGIN cannot be "*" in production. Set it to your public HTTPS origin.');
    process.exit(1);
  }
  if (config.env === 'production' && process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    console.warn('WARNING: STRIPE_SECRET_KEY is a test key in production. Stripe payments are disabled until a live key is configured.');
  }
  if (config.env === 'production' && config.corsOrigin === '*') {
    console.warn('WARNING: CORS_ORIGIN is "*" in production — set it to your public origin (https://example.com) to avoid cross-site abuse.');
  }
})();
