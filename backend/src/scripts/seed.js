// Seed script: bootstraps admin user and logs catalog metadata.
// Usage: npm run seed
import 'dotenv/config';
import { pool, query } from '../db.js';
import { hashPassword } from '../util/passwords.js';
import { randomCode } from '../util/random.js';
import { EMOJI_PACKS } from '../data/emojiPacks.js';
import { CARD_SKINS } from '../data/cardSkins.js';
import { logger } from '../logger.js';

const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@durak.local';
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin12345';
const ADMIN_USERNAME = process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin';
const ADMIN_STARTING_COINS = 9999;

async function ensureAdmin() {
  const existing = await query('SELECT id, is_admin, coins FROM users WHERE lower(email) = lower($1)', [ADMIN_EMAIL]);
  if (existing.rows[0]) {
    const u = existing.rows[0];
    if (!u.is_admin) {
      await query('UPDATE users SET is_admin = TRUE WHERE id = $1', [u.id]);
      logger.info(`promoted existing user to admin: ${ADMIN_EMAIL}`);
    } else {
      logger.info(`admin already exists: ${ADMIN_EMAIL} (id=${u.id}, coins=${u.coins})`);
    }
    return u.id;
  }
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const r = await query(
    `INSERT INTO users (username, email, password_hash, referral_code, is_admin, coins)
     VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING id`,
    [ADMIN_USERNAME, ADMIN_EMAIL, passwordHash, randomCode(8), ADMIN_STARTING_COINS]
  );
  logger.info(`created admin: ${ADMIN_EMAIL} (id=${r.rows[0].id}, coins=${ADMIN_STARTING_COINS})`);
  return r.rows[0].id;
}

function logCatalog() {
  logger.info(`emoji packs: ${EMOJI_PACKS.length} (dynamic, served from /api/inventory/catalog)`);
  const byRarity = EMOJI_PACKS.reduce((m, p) => ((m[p.rarity] = (m[p.rarity] || 0) + 1), m), {});
  for (const [rarity, n] of Object.entries(byRarity)) {
    logger.info(`  ${rarity}: ${n} packs`);
  }
  logger.info(`card skins: ${CARD_SKINS.length} (dynamic)`);
}

async function run() {
  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL not set');
    process.exit(1);
  }
  try {
    await ensureAdmin();
    logCatalog();
    logger.info('seed complete');
  } catch (err) {
    logger.error('seed failed:', err);
    process.exit(1);
  } finally {
    const dbPool = await pool();
    await dbPool.end().catch(() => {});
  }
  process.exit(0);
}

run();
