// db.js — PostgreSQL connection pool.
//
// IMPORTANT: `pg` is loaded with a lazy dynamic import so that any module
// that imports db.js can be required in unit-test environments where the
// `pg` package is not installed. Only an actual `query()` / `withTransaction()`
// call would attempt to load pg — pure-logic tests never reach that point.

import { config } from './config.js';

let _pool = null;

async function getPool() {
  if (_pool) return _pool;
  const { default: pg } = await import('pg');
  _pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
  });
  _pool.on('error', (err) => {
    console.error('[db] fatal pool error — shutting down:', err);
    process.exit(1);
  });
  return _pool;
}

// Expose a synchronous-looking pool proxy for code that accesses pool.end() etc.
// In production this is initialised on the first query call.
export { getPool as pool };

export async function query(text, params) {
  const pool = await getPool();
  const start = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - start;
  if (ms > 500) {
    console.warn(`[db] slow query ${ms}ms: ${text.slice(0, 80)}`);
  }
  return res;
}

export async function withTransaction(fn) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
