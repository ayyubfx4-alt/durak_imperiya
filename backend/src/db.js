/**
 * db.js — PostgreSQL connection pool (production-grade).
 *
 * Pool sizing rationale:
 *   PostgreSQL default is max_connections = 100. With multiple Node.js
 *   instances behind a load balancer each pool should be small:
 *     pool_max = (max_connections - reserved_superuser_slots) / num_instances
 *   Default 50 is safe for a single instance; reduce to 20 if running 2+.
 *
 * Slow query warning threshold: 500 ms — logged as [warn] so it surfaces
 * in production log aggregators.
 *
 * Lazy pg import: allows the module to be imported in unit-test environments
 * where pg is not installed. Only an actual query() call touches pg.
 */

import { config } from './config.js';
import { logger } from './logger.js';

let _pool = null;

function shouldUseDatabaseSsl(databaseUrl) {
  const mode = String(process.env.DB_SSL || process.env.PGSSLMODE || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'disable', 'disabled', 'no'].includes(mode)) return false;
  if (['1', 'true', 'on', 'require', 'required', 'yes'].includes(mode)) return true;

  try {
    const url = new URL(databaseUrl);
    if (url.searchParams.get('sslmode') === 'disable') return false;
    if (url.searchParams.get('sslmode') === 'require') return true;
    if (['postgres', 'localhost', '127.0.0.1', '::1'].includes(url.hostname)) return false;
  } catch (_) {
    // Fall through to the production default below.
  }
  return config.env === 'production';
}

async function getPool() {
  if (_pool) return _pool;

  const { default: pg } = await import('pg');

  const poolConfig = {
    connectionString: config.databaseUrl,
    // ── Pool size ────────────────────────────────────────────────────────────
    max: Number(process.env.DB_POOL_MAX) || 50,        // concurrent connections
    min: Number(process.env.DB_POOL_MIN) || 2,          // always-warm connections
    // ── Timeouts ─────────────────────────────────────────────────────────────
    idleTimeoutMillis:       Number(process.env.DB_IDLE_TIMEOUT_MS)       || 30_000, // release idle client
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS)    ||  3_000, // wait for available slot
    query_timeout:           Number(process.env.DB_QUERY_TIMEOUT_MS)      || 30_000, // individual query hard limit
    statement_timeout:       Number(process.env.DB_STATEMENT_TIMEOUT_MS)  || 30_000, // pg server-side statement timeout
    // ── SSL ───────────────────────────────────────────────────────────────────
    // Managed external Postgres usually needs SSL. The compose-local
    // `postgres` service does not, so PGSSLMODE=disable or host=postgres turns
    // it off and keeps health checks green.
    ssl: shouldUseDatabaseSsl(config.databaseUrl) ? { rejectUnauthorized: false } : false,
  };

  _pool = new pg.Pool(poolConfig);

  _pool.on('error', (err, _client) => {
    logger.error('[db] unexpected pool error — client will be removed: %s', err.message);
    // Do NOT exit — pg removes the broken client and creates a fresh one.
  });

  _pool.on('connect', () => {
    logger.debug('[db] new client connected (pool size: %d/%d)', _pool.totalCount, poolConfig.max);
  });

  _pool.on('remove', () => {
    logger.debug('[db] client removed from pool (pool size: %d/%d)', _pool.totalCount, poolConfig.max);
  });

  logger.info('[db] pool created (max=%d, idle=%dms, connTimeout=%dms)',
    poolConfig.max, poolConfig.idleTimeoutMillis, poolConfig.connectionTimeoutMillis);

  return _pool;
}

/** Expose pool accessor for pool.end() in graceful shutdown. */
export { getPool as pool };

const SLOW_QUERY_WARN_MS = Number(process.env.DB_SLOW_QUERY_WARN_MS) || 500;

/**
 * Execute a parameterised query and emit a warn if it's slow.
 *
 * @param {string}   text    SQL statement (never interpolate user input)
 * @param {any[]}   [params] parameterised values
 */
export async function query(text, params) {
  const pool = await getPool();
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const ms  = Date.now() - start;
    if (ms > SLOW_QUERY_WARN_MS) {
      logger.warn('[db] slow query %dms: %s', ms, text.slice(0, 120).replace(/\s+/g, ' '));
    }
    return res;
  } catch (err) {
    const ms = Date.now() - start;
    logger.error('[db] query error after %dms — %s | sql: %s', ms, err.message, text.slice(0, 120).replace(/\s+/g, ' '));
    throw err;
  }
}

/**
 * Execute `fn(client)` inside a BEGIN/COMMIT transaction.
 * Automatically ROLLBACK on error and release the client.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const pool   = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr) =>
      logger.error('[db] ROLLBACK failed: %s', rbErr.message)
    );
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Minimal health check: ping the DB and return latency.
 * Used by GET /health to report database status.
 *
 * @returns {Promise<{ ok: boolean, latencyMs: number, error?: string }>}
 */
export async function dbHealthCheck() {
  const start = Date.now();
  try {
    await query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}
