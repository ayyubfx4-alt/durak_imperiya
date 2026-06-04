import { config } from '../config.js';

const GAME_ACTION_MIN_INTERVAL_MS = 100;
const SOCKET_EVENT_WINDOW_MS = Math.max(250, parseInt(process.env.SOCKET_EVENT_WINDOW_MS || '1000', 10));
const SOCKET_EVENT_MAX_PER_WINDOW = Math.max(10, parseInt(process.env.SOCKET_EVENT_MAX_PER_WINDOW || '80', 10));

export const SOCKET_LIMITS = {
  GAME_ACTION_MIN_INTERVAL_MS,
  SOCKET_EVENT_WINDOW_MS,
  SOCKET_EVENT_MAX_PER_WINDOW,
};

export function normalizeAllowedTableSize(value, fallback = 2) {
  const requested = Math.floor(Number(value));
  return config.game.allowedTableSizes.includes(requested) ? requested : fallback;
}

export function checkSocketPacketRateLimit(socket, eventName, now = Date.now()) {
  if (!eventName) return { ok: true };
  const state = socket._packetRate || { windowStart: now, count: 0 };
  if (now - state.windowStart >= SOCKET_EVENT_WINDOW_MS) {
    state.windowStart = now;
    state.count = 0;
  }
  state.count += 1;
  socket._packetRate = state;
  if (state.count > SOCKET_EVENT_MAX_PER_WINDOW) {
    return {
      ok: false,
      error: 'rate limited',
      retryAfterMs: Math.max(1, SOCKET_EVENT_WINDOW_MS - (now - state.windowStart)),
    };
  }
  return { ok: true };
}

export function checkGameActionRateLimit(socket, now = Date.now()) {
  const lastActionAt = Number(socket._lastAction || 0);
  const retryAfterMs = GAME_ACTION_MIN_INTERVAL_MS - (now - lastActionAt);
  if (lastActionAt && retryAfterMs > 0) {
    return { ok: false, error: 'rate limited', retryAfterMs };
  }
  socket._lastAction = now;
  return { ok: true };
}

export function currentTurnPlayerId(room) {
  const state = room?.gameState;
  if (!state || state.phase === 'ended') return null;
  const idx = state.phase === 'defending' ? state.defenderIdx : state.attackerIdx;
  return state.players[idx]?.id || null;
}

export function canPokeTurnTimeout(room, userId, now = Date.now()) {
  if (!room?.gameState || room.gameState.phase === 'ended' || room.state?.phase !== 'playing') {
    return { ok: false, error: 'no active game' };
  }
  const seated = room.seats?.some((s) => s && !s.isBot && String(s.id) === String(userId));
  if (!seated) return { ok: false, error: 'not seated' };
  const currentPlayerId = currentTurnPlayerId(room);
  if (!currentPlayerId || String(currentPlayerId) !== String(userId)) {
    return { ok: false, error: 'not your turn' };
  }
  if (!room.turnDeadline) return { ok: false, error: 'turn timer not armed' };
  const retryAfterMs = room.turnDeadline - now;
  if (retryAfterMs > 0) return { ok: false, error: 'turn not expired', retryAfterMs };
  return { ok: true, currentPlayerId };
}
