// Redis Adapter — Socket.IO horizontal scaling (10k+ concurrent connections).
//
// Why:
//   A single Node.js process saturates at ~5–8k Socket.IO connections. To
//   scale beyond that we run N backend instances behind a sticky-session
//   load balancer (nginx ip_hash / k8s service with sessionAffinity).
//   Cross-instance broadcasts (room:state, game:move, chat:message,
//   admin:room-monitor, achievement:unlock) MUST travel over Redis pub/sub
//   so that a player on instance A sees moves played on instance B.
//
// Modes:
//   • Disabled (REDIS_URL not set) → in-memory only. Single-process MVP.
//   • Enabled  (REDIS_URL set)     → `@socket.io/redis-adapter` + `redis` client.
//
// We also expose a presence registry keyed in Redis (`durak:presence:<uid>`
// with TTL) so the admin Room Monitor and online counter aggregate across
// all instances. Stale entries auto-expire after PRESENCE_TTL_S seconds.
//
// NOTE: redis + @socket.io/redis-adapter are loaded with dynamic import()
// inside attachRedisAdapter so that the MODULE itself can be safely imported
// in environments where those packages are absent (e.g. unit test runners
// that don't need Redis). A top-level static import would crash with
// ERR_MODULE_NOT_FOUND before any runtime check runs.
import { logger } from '../logger.js';

const PRESENCE_TTL_S = Number(process.env.PRESENCE_TTL_S || 60);
const PRESENCE_KEY = (userId) => `durak:presence:${userId}`;
const ROOM_REGISTRY = 'durak:rooms';

let pubClient = null;
let subClient = null;
let presenceClient = null;
let adapterEnabled = false;

/**
 * Wire up the Redis adapter on the Socket.IO server. Safe to call when
 * REDIS_URL is missing — we simply log and return; callers continue to
 * work in single-process mode.
 */
export async function attachRedisAdapter(io) {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.info('[scale] REDIS_URL not set — running single-process (no pub/sub).');
    return { enabled: false };
  }

  try {
    // Dynamic import so the module loads without error when packages are absent.
    const [{ createAdapter }, { createClient }] = await Promise.all([
      import('@socket.io/redis-adapter'),
      import('redis'),
    ]);

    pubClient = createClient({ url });
    subClient = pubClient.duplicate();
    presenceClient = pubClient.duplicate();

    pubClient.on('error', (e) => logger.error('[redis:pub]', e.message));
    subClient.on('error', (e) => logger.error('[redis:sub]', e.message));
    presenceClient.on('error', (e) => logger.error('[redis:presence]', e.message));

    await Promise.all([pubClient.connect(), subClient.connect(), presenceClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient, {
      key: 'durak.io',
      requestsTimeout: 5000,
    }));
    adapterEnabled = true;
    logger.info('[scale] Redis adapter attached (multi-instance scaling ENABLED).');
    return { enabled: true, pubClient, subClient, presenceClient };
  } catch (err) {
    logger.error('[scale] Redis adapter init failed — falling back to single-process:', err.message);
    return { enabled: false, error: err.message };
  }
}

export function isAdapterEnabled() {
  return adapterEnabled;
}

/**
 * Mark a user as online on this instance. Re-call periodically (every
 * PRESENCE_TTL_S / 2) so the TTL doesn't expire mid-session. Disconnect
 * handler should call `clearPresence` to remove the entry immediately.
 */
export async function setPresence(userId, meta = {}) {
  if (!presenceClient || !userId) return;
  try {
    const payload = JSON.stringify({
      instance: process.env.INSTANCE_ID || `${process.pid}`,
      lastSeen: Date.now(),
      ...meta,
    });
    await presenceClient.set(PRESENCE_KEY(userId), payload, { EX: PRESENCE_TTL_S });
  } catch (e) {
    // Non-fatal — presence is observability, not correctness.
    logger.warn('[presence] setPresence failed:', e.message);
  }
}

export async function clearPresence(userId) {
  if (!presenceClient || !userId) return;
  try { await presenceClient.del(PRESENCE_KEY(userId)); }
  catch (e) { logger.warn('[presence] clearPresence failed:', e.message); }
}

/** Count online users across all instances. O(N) — fine for <100k users. */
export async function countOnline() {
  if (!presenceClient) return null;
  try {
    let cursor = 0; let total = 0;
    do {
      const res = await presenceClient.scan(cursor, { MATCH: PRESENCE_KEY('*'), COUNT: 500 });
      cursor = res.cursor; total += res.keys.length;
    } while (cursor !== 0);
    return total;
  } catch (e) {
    logger.warn('[presence] countOnline failed:', e.message);
    return null;
  }
}

/**
 * Register a live room in the shared registry so the admin Room Monitor
 * (running on a different instance) can list all active rooms. Idempotent.
 */
export async function registerRoom(code, snapshot) {
  if (!presenceClient || !code) return;
  try {
    await presenceClient.hSet(ROOM_REGISTRY, code, JSON.stringify({
      ...snapshot,
      instance: process.env.INSTANCE_ID || `${process.pid}`,
      updatedAt: Date.now(),
    }));
  } catch (e) { logger.warn('[rooms] registerRoom failed:', e.message); }
}

export async function unregisterRoom(code) {
  if (!presenceClient || !code) return;
  try { await presenceClient.hDel(ROOM_REGISTRY, code); }
  catch (e) { logger.warn('[rooms] unregisterRoom failed:', e.message); }
}

export async function listAllRooms() {
  if (!presenceClient) return [];
  try {
    const map = await presenceClient.hGetAll(ROOM_REGISTRY);
    return Object.entries(map)
      .map(([code, json]) => { try { return { code, ...JSON.parse(json) }; } catch { return null; } })
      .filter(Boolean);
  } catch (e) {
    logger.warn('[rooms] listAllRooms failed:', e.message);
    return [];
  }
}

export async function closeRedis() {
  for (const c of [pubClient, subClient, presenceClient]) {
    if (c) { try { await c.quit(); } catch { /* ignore */ } }
  }
  pubClient = subClient = presenceClient = null;
  adapterEnabled = false;
}
