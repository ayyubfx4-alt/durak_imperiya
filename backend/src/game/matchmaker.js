// Matchmaker — TOR §3: prefer pairing real humans whenever 2+ online players
// are waiting. Bots only fill empty seats AFTER `BOT_FILL_TIMEOUT_MS`.
//
// Design:
//   • Global in-memory queue (per-instance; coordinated across instances via
//     Redis pub/sub when REDIS_URL is set).
//   • When user clicks "QUICK MATCH" client emits `mm:join` with desired
//     stake / table size. We bucket entries by (stake, size) and pop pairs.
//   • If no pair is available within `MM_WAIT_MS`, we spawn a room and arm
//     the existing bot-fill timer (so the lone player gets bots only after
//     30 s, exactly like a normal room).
//
// This is intentionally simple — no skill-based matching, no MMR. Durak is
// luck-heavy and the TOR explicitly asks for "topish tez" (fast finding).

import { config } from '../config.js';
import { logger } from '../logger.js';

const MM_WAIT_MS = parseInt(process.env.MM_WAIT_MS || '8000', 10);

/** queues: Map<bucketKey, Array<{userId, socket, opts, joinedAt, timer}>> */
const queues = new Map();

function bucketKey({ stake, maxPlayers, mode = 'classic' }) {
  return `${mode}:${maxPlayers}:${stake}`;
}

export function normalizeMatchmakerOptions(opts = {}) {
  const requestedSize = Math.floor(Number(opts.maxPlayers));
  const maxPlayers = config.game.allowedTableSizes.includes(requestedSize) ? requestedSize : 2;
  return { ...opts, maxPlayers };
}

export function enqueue(io, manager, socket, opts) {
  const safeOpts = normalizeMatchmakerOptions(opts);
  const key = bucketKey(safeOpts);
  const queue = queues.get(key) || [];
  // De-dupe: same user can only have one queue entry.
  const existing = queue.findIndex((e) => e.userId === socket.user.id);
  if (existing !== -1) {
    clearTimeout(queue[existing].timer);
    queue.splice(existing, 1);
  }

  const entry = { userId: socket.user.id, socket, opts: safeOpts, joinedAt: Date.now(), timer: null };
  queue.push(entry);
  queues.set(key, queue);

  // Try immediate pair-up.
  if (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    clearTimeout(a.timer); clearTimeout(b.timer);
    return spawnPaired(io, manager, [a, b], safeOpts);
  }

  // Else: wait, then create a solo room with bot-fill armed.
  entry.timer = setTimeout(() => {
    const q = queues.get(key) || [];
    const idx = q.findIndex((e) => e.userId === entry.userId);
    if (idx === -1) return; // already paired
    q.splice(idx, 1);
    queues.set(key, q);
    spawnSolo(io, manager, entry, safeOpts);
  }, MM_WAIT_MS);

  socket.emit('mm:waiting', { estWaitMs: MM_WAIT_MS, queuedAt: entry.joinedAt });
  return { ok: true, queued: true };
}

export function dequeue(socket) {
  for (const [key, queue] of queues.entries()) {
    const idx = queue.findIndex((e) => e.userId === socket.user.id);
    if (idx !== -1) {
      clearTimeout(queue[idx].timer);
      queue.splice(idx, 1);
      queues.set(key, queue);
      return true;
    }
  }
  return false;
}

function spawnPaired(io, manager, entries, opts) {
  try {
    const room = manager.createRoom({
      maxPlayers: opts.maxPlayers,
      stake: opts.stake,
      mode: opts.mode || 'classic',
      bluffEnabled: !!opts.bluffEnabled,
      isPrivate: false,
      botLevel: 'medium',
    });
    for (const e of entries) {
      const seat = room.join({
        id: e.userId,
        username: e.socket.user.username,
        nickname: e.socket.user.nickname,
        avatar_url: e.socket.user.avatar_url,
        selected_avatar_frame: e.socket.user.selected_avatar_frame,
        country_code: e.socket.user.country_code,
        rankWins: Number(e.socket.user.rank_wins || e.socket.user.games_won || 0),
      });
      if (seat.ok) {
        e.socket.join(`room:${room.code}`);
        const seatObj = room.seats[seat.seatIdx];
        if (seatObj) seatObj.socketId = e.socket.id;
        e.socket.emit('mm:matched', { code: room.code, matchedWithReal: true });
        e.socket.emit('room:state', room.lobbySnapshot());
      }
    }
    logger.debug(`mm: paired 2 humans into room ${room.code} (stake=${opts.stake})`);
    return { ok: true, code: room.code };
  } catch (e) {
    logger.error('mm spawnPaired failed:', e.message);
    return { ok: false, error: e.message };
  }
}

function spawnSolo(io, manager, entry, opts) {
  try {
    const room = manager.createRoom({
      maxPlayers: opts.maxPlayers,
      stake: opts.stake,
      mode: opts.mode || 'classic',
      bluffEnabled: !!opts.bluffEnabled,
      isPrivate: false,
      botLevel: 'medium',
    });
    const seat = room.join({
      id: entry.userId,
      username: entry.socket.user.username,
      nickname: entry.socket.user.nickname,
      avatar_url: entry.socket.user.avatar_url,
      selected_avatar_frame: entry.socket.user.selected_avatar_frame,
      country_code: entry.socket.user.country_code,
      rankWins: Number(entry.socket.user.rank_wins || entry.socket.user.games_won || 0),
    });
    if (seat.ok) {
      entry.socket.join(`room:${room.code}`);
      const seatObj = room.seats[seat.seatIdx];
      if (seatObj) seatObj.socketId = entry.socket.id;
      entry.socket.emit('mm:matched', { code: room.code, matchedWithReal: false });
      entry.socket.emit('room:state', room.lobbySnapshot());
    }
    logger.debug(`mm: spawned solo room ${room.code} (will bot-fill in ${process.env.BOT_FILL_TIMEOUT_MS || 30000}ms)`);
    return { ok: true, code: room.code };
  } catch (e) {
    logger.error('mm spawnSolo failed:', e.message);
    return { ok: false, error: e.message };
  }
}

export function queueStats() {
  const out = {};
  for (const [k, v] of queues.entries()) out[k] = v.length;
  return out;
}
