import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool as getPool } from '../db.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function applied(pool) {
  const r = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(r.rows.map((x) => x.filename));
}

async function run() {
  const pool = await getPool();
  await ensureTable(pool);
  const have = await applied(pool);
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (have.has(f)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8');
    logger.info(`applying migration: ${f}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`migration ${f} failed:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }
  logger.info('migrations complete');
  await pool.end();
}

run().catch((err) => {
  logger.error('migrate error:', err);
  process.exit(1);
});
