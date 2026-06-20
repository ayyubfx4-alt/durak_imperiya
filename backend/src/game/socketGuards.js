/**
 * socketGuards.js — Socket.IO rate limiting and game-action guards.
 *
 * S3 FIX: Strengthened per-socket rate limits with per-event burst windows
 * and a separate hard-limit for game:action to prevent move-spam exploits.
 *
 * Configuration (override via environment variables):
 *   SOCKET_EVENT_WINDOW_MS     sliding window duration (default: 1000 ms)
 *   SOCKET_EVENT_MAX_PER_WINDOW  max events per window (default: 40)
 *   GAME_ACTION_MIN_INTERVAL_MS  min ms between game:action calls (default: 100)
 *   GAME_ACTION_BURST_MAX        max game:actions per 2 s burst window (default: 12)
 */

import { config } from '../config.js';
import { logger } from '../logger.js';

// ── Rate limit constants ──────────────────────────────────────────────────────

/** Minimum interval between consecutive game:action events per socket. */
const GAME_ACTION_MIN_INTERVAL_MS = Math.max(
  50,
  parseInt(process.env.GAME_ACTION_MIN_INTERVAL_MS || '100', 10)
);

/** Burst window: max N game:actions allowed inside BURST_WINDOW_MS. */
const GAME_ACTION_BURST_WINDOW_MS = 2000;
const GAME_ACTION_BURST_MAX       = Math.max(
  3,
  parseInt(process.env.GAME_ACTION_BURST_MAX || '12', 10)
);

/** Global per-socket packet rate window. */
const SOCKET_EVENT_WINDOW_MS = Math.max(
  250,
  parseInt(process.env.SOCKET_EVENT_WINDOW_MS || '1000', 10)
);
const SOCKET_EVENT_MAX_PER_WINDOW = Math.max(
  10,
  parseInt(process.env.SOCKET_EVENT_MAX_PER_WINDOW || '40', 10)
);

export const SOCKET_LIMITS = {
  GAME_ACTION_MIN_INTERVAL_MS,
  GAME_ACTION_BURST_WINDOW_MS,
  GAME_ACTION_BURST_MAX,
  SOCKET_EVENT_WINDOW_MS,
  SOCKET_EVENT_MAX_PER_WINDOW,
};

// ── Room size normalisation ───────────────────────────────────────────────────

export function normalizeAllowedTableSize(value, fallback = 2) {
  const requested = Math.floor(Number(value));
  return config.game.allowedTableSizes.includes(requested) ? requested : fallback;
}

// ── Global packet rate limiter ────────────────────────────────────────────────

/**
 * Sliding-window counter applied to every incoming socket event.
 * Prevents connection-level flood (e.g. 1000 events/sec from a script).
 *
 * @param {import('socket.io').Socket} socket
 * @param {string} eventName
 * @param {number} [now]
 * @returns {{ ok: boolean, error?: string, retryAfterMs?: number }}
 */
export function checkSocketPacketRateLimit(socket, eventName, now = Date.now()) {
  if (!eventName) return { ok: true };

  const state = socket._packetRate || { windowStart: now, count: 0 };

  // Reset window when it has elapsed.
  if (now - state.windowStart >= SOCKET_EVENT_WINDOW_MS) {
    state.windowStart = now;
    state.count = 0;
  }

  state.count += 1;
  socket._packetRate = state;

  if (state.count > SOCKET_EVENT_MAX_PER_WINDOW) {
    const retryAfterMs = Math.max(1, SOCKET_EVENT_WINDOW_MS - (now - state.windowStart));
    logger.warn(
      '[ratelimit] packet flood: socket=%s user=%s event=%s count=%d retryAfterMs=%d',
      socket.id, socket.user?.username || '?', eventName, state.count, retryAfterMs
    );
    return { ok: false, error: 'rate limited', retryAfterMs };
  }

  return { ok: true };
}

// ── game:action rate limiter ──────────────────────────────────────────────────

/**
 * Two-layer check for game:action events:
 *   1. Minimum interval between consecutive calls (debounce-style anti-spam).
 *   2. Burst window: max GAME_ACTION_BURST_MAX actions per GAME_ACTION_BURST_WINDOW_MS.
 *
 * Both layers must pass. This prevents both rapid consecutive spam and
 * sustained background scripting that stays just under the debounce limit.
 *
 * @param {import('socket.io').Socket} socket
 * @param {number} [now]
 * @returns {{ ok: boolean, error?: string, retryAfterMs?: number }}
 */
export function checkGameActionRateLimit(socket, now = Date.now()) {
  // Layer 1: minimum inter-action interval.
  const lastActionAt = Number(socket._lastAction || 0);
  const sinceLastMs  = now - lastActionAt;
  if (lastActionAt && sinceLastMs < GAME_ACTION_MIN_INTERVAL_MS) {
    const retryAfterMs = GAME_ACTION_MIN_INTERVAL_MS - sinceLastMs;
    return { ok: false, error: 'rate limited', retryAfterMs };
  }

  // Layer 2: burst window counter.
  const burst = socket._actionBurst || { windowStart: now, count: 0 };
  if (now - burst.windowStart >= GAME_ACTION_BURST_WINDOW_MS) {
    burst.windowStart = now;
    burst.count = 0;
  }
  burst.count += 1;
  socket._actionBurst = burst;

  if (burst.count > GAME_ACTION_BURST_MAX) {
    const retryAfterMs = Math.max(1, GAME_ACTION_BURST_WINDOW_MS - (now - burst.windowStart));
    logger.warn(
      '[ratelimit] action burst: socket=%s user=%s burst=%d/%d retryAfterMs=%d',
      socket.id, socket.user?.username || '?', burst.count, GAME_ACTION_BURST_MAX, retryAfterMs
    );
    return { ok: false, error: 'rate limited', retryAfterMs };
  }

  socket._lastAction = now;
  return { ok: true };
}

// ── Turn-timeout poke guard ───────────────────────────────────────────────────

export function currentTurnPlayerId(room) {
  const state = room?.gameState;
  if (!state || state.phase === 'ended') return null;
  const idx = state.phase === 'defending' ? state.defenderIdx : state.attackerIdx;
  return state.players[idx]?.id || null;
}

/**
 * Guard for game:timeout_poke — only the current-turn player may poke,
 * and only when their deadline has actually passed.
 *
 * @returns {{ ok: boolean, error?: string, retryAfterMs?: number, currentPlayerId?: string }}
 */
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
