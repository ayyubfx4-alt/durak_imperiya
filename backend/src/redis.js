/**
 * redis.js — Markaziy Redis ulanish moduli
 *
 * Ikki alohida client:
 *   pubClient  — publish (Socket.IO adapter ishlatadi)
 *   subClient  — subscribe (pubClient.duplicate())
 *   redisClient — umumiy cache/game-state operatsiyalar uchun
 *
 * MUHIM: Socket.IO Redis Adapter pub va sub uchun ALOHIDA
 * ulanish talab qiladi. Bitta clientni ikkalasiga berish mumkin emas.
 */

import { createClient } from 'redis';

// ─── Sozlamalar ────────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const BASE_OPTIONS = {
  url: REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      // Har urinish orasida ortib boruvchi kutish (max 10s)
      const delay = Math.min(retries * 200, 10_000);
      console.warn(`[Redis] Qayta ulanish #${retries}, ${delay}ms kutilmoqda...`);
      return delay;
    },
    connectTimeout: 5_000,
  },
};

// ─── Clientlarni yaratish ──────────────────────────────────────────────────────
const pubClient  = createClient(BASE_OPTIONS);
const subClient  = pubClient.duplicate();   // adapter uchun
const redisClient = pubClient.duplicate();  // cache / game state uchun

// ─── Xato hodisalari ──────────────────────────────────────────────────────────
[pubClient, subClient, redisClient].forEach((client, i) => {
  const name = ['pub', 'sub', 'main'][i];
  client.on('error',        (err) => console.error(`[Redis:${name}] Xato:`, err.message));
  client.on('connect',      ()    => console.log(`[Redis:${name}] Ulandi ✅`));
  client.on('reconnecting', ()    => console.warn(`[Redis:${name}] Qayta ulanmoqda...`));
  client.on('end',          ()    => console.warn(`[Redis:${name}] Ulanish yopildi`));
});

// ─── Ulanish funksiyasi ────────────────────────────────────────────────────────
async function connectRedis() {
  await Promise.all([
    pubClient.connect(),
    subClient.connect(),
    redisClient.connect(),
  ]);
  console.log('[Redis] Barcha 3 client ulandi ✅');
}

// ─── Yopish funksiyasi (graceful shutdown) ─────────────────────────────────────
async function disconnectRedis() {
  await Promise.all([
    pubClient.quit(),
    subClient.quit(),
    redisClient.quit(),
  ]);
  console.log('[Redis] Barcha clientlar yopildi');
}

// ─── Foydali yordamchilar ──────────────────────────────────────────────────────

/**
 * O'yin holatini Redis ga saqlash
 * @param {string} roomCode  — xona kodi (masalan: "ABC123")
 * @param {object} gameState — engine.js dan kelgan holat
 * @param {number} ttlSeconds — o'chirish vaqti (default: 2 soat)
 */
async function saveGameState(roomCode, gameState, ttlSeconds = 7200) {
  const key = `game:${roomCode}`;
  await redisClient.set(key, JSON.stringify(gameState), { EX: ttlSeconds });
}

/**
 * O'yin holatini Redis dan olish
 * @param {string} roomCode
 * @returns {object|null}
 */
async function getGameState(roomCode) {
  const key = `game:${roomCode}`;
  const raw = await redisClient.get(key);
  return raw ? JSON.parse(raw) : null;
}

/**
 * O'yin holatini Redis dan o'chirish (o'yin tugaganda)
 * @param {string} roomCode
 */
async function deleteGameState(roomCode) {
  await redisClient.del(`game:${roomCode}`);
}

/**
 * Xona ro'yxatini saqlash (lobby uchun)
 * @param {string} roomCode
 * @param {object} roomMeta — { stake, maxPlayers, playerCount, isPrivate }
 * @param {number} ttlSeconds
 */
async function saveRoomMeta(roomCode, roomMeta, ttlSeconds = 7200) {
  await redisClient.hSet('rooms:active', roomCode, JSON.stringify(roomMeta));
  // Har xonaga alohida TTL qo'yib bo'lmaydi hSet bilan, shuning uchun:
  await redisClient.expire('rooms:active', ttlSeconds);
}

/**
 * Barcha aktiv xonalarni olish
 * @returns {Array<{code, ...meta}>}
 */
async function getAllRooms() {
  const raw = await redisClient.hGetAll('rooms:active');
  if (!raw) return [];
  return Object.entries(raw).map(([code, meta]) => ({
    code,
    ...JSON.parse(meta),
  }));
}

/**
 * Xonani ro'yxatdan o'chirish
 * @param {string} roomCode
 */
async function removeRoom(roomCode) {
  await redisClient.hDel('rooms:active', roomCode);
}

/**
 * Sog'lik tekshiruvi
 * @returns {boolean}
 */
async function pingRedis() {
  try {
    const result = await redisClient.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

export {
  pubClient,
  subClient,
  redisClient,
  connectRedis,
  disconnectRedis,
  saveGameState,
  getGameState,
  deleteGameState,
  saveRoomMeta,
  getAllRooms,
  removeRoom,
  pingRedis,
};

export default {
  pubClient,
  subClient,
  redisClient,
  connectRedis,
  disconnectRedis,
  saveGameState,
  getGameState,
  deleteGameState,
  saveRoomMeta,
  getAllRooms,
  removeRoom,
  pingRedis,
};
