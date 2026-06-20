import { Server } from 'socket.io';
import { verifyToken } from '../util/jwt.js';
import { query } from '../db.js';
import { RoomManager } from './room.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { applyPerk } from '../services/perks.js';
import { submitReport } from '../services/reports.js';
import { EMOJI_PACKS } from '../data/emojiPacks.js';
import { drainInbox } from '../services/achievements.js';
import { attachRedisAdapter, setPresence, clearPresence, registerRoom, unregisterRoom } from '../scaling/redisAdapter.js';
import { setRegistry } from './socketRegistry.js';
import { enqueue as mmEnqueue, dequeue as mmDequeue, queueStats } from './matchmaker.js';
import {
  canPokeTurnTimeout,
  checkGameActionRateLimit,
  checkSocketPacketRateLimit,
  normalizeAllowedTableSize,
} from './socketGuards.js';
import { canUseVoice, startVoiceSession, endVoiceSession, getActiveVoiceSession } from '../services/voiceChat.js';
import { pushGameInvite } from '../services/push.js';
import { validateSocketPayload } from '../middleware/validate.js';

// Per-user premium cache (60 s TTL).
const PREMIUM_CACHE_TTL_MS = 60_000;
const premiumCache = new Map();

async function isUserPremium(userId) {
  const now = Date.now();
  const cached = premiumCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.value;
  const r = await query('SELECT premium_until FROM users WHERE id = $1', [userId]);
  const value = !!(r.rows[0]?.premium_until && new Date(r.rows[0].premium_until) > new Date());
  premiumCache.set(userId, { value, expiresAt: now + PREMIUM_CACHE_TTL_MS });
  return value;
}

async function getCurrentCoins(userId) {
  const r = await query('SELECT coins FROM users WHERE id = $1', [userId]);
  return Number(r.rows[0]?.coins || 0);
}

function socketClientInfo(socket) {
  const forwarded = socket.handshake.headers?.['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || socket.handshake.address || '')
    .split(',')[0]
    .trim()
    .slice(0, 80);
  const deviceId = String(
    socket.handshake.auth?.deviceId
    || socket.handshake.query?.deviceId
    || socket.handshake.headers?.['x-device-id']
    || ''
  ).slice(0, 120);
  return { ip, deviceId };
}

const PREMIUM_EMOJI_PACK_IDS = new Set(
  EMOJI_PACKS.filter((p) => p.premium).map((p) => p.id)
);

function activeMute(user) {
  const until = user?.muted_until ? new Date(user.muted_until) : null;
  if (!user?.is_muted) return null;
  if (until && until <= new Date()) return null;
  return {
    mutedUntil: until,
    reason: user.muted_reason || 'Siz admin tomonidan mute qilingansiz.',
  };
}

// Per-user socket index — used by the achievement broadcaster to find an
// active socket to push popups to without iterating all rooms.
const userSockets = new Map(); // userId -> Set<socketId>

function trackSocket(userId, socketId) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
}
function untrackSocket(userId, socketId) {
  const s = userSockets.get(userId);
  if (!s) return;
  s.delete(socketId);
  if (!s.size) userSockets.delete(userId);
}

export function isUserOnline(userId) {
  return Boolean(userSockets.get(String(userId))?.size);
}

export function socketIdsForUser(userId) {
  return [...(userSockets.get(String(userId)) || [])];
}

function cleanNickname(value) {
  return String(value || '').trim().replace(/^@+/, '').slice(0, 24);
}

/**
 * Drain undelivered achievement popups for this user and push them now.
 * Called on connection (legacy notifications) and after each game end
 * (room.js emits 'achievement:flush' on every human seat).
 */
export async function flushAchievementInbox(io, userId) {
  try {
    const popups = await drainInbox(userId);
    if (!popups.length) return;
    const ids = [...(userSockets.get(userId) || [])];
    for (const sid of ids) {
      io.to(sid).emit('achievement:unlock', { popups });
    }
  } catch (e) {
    logger.warn('flushAchievementInbox failed:', e.message);
  }
}

export async function setupSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, credentials: false },
    pingInterval: 10_000,
    pingTimeout: 15_000,
    // Mobile WebViews connect more reliably via polling, then upgrade.
    transports: ['polling', 'websocket'],
    upgrade: true,
  });

  // PRO: attach Redis adapter for multi-instance scaling. No-op if
  // REDIS_URL is not set — single-process mode continues to work.
  await attachRedisAdapter(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('auth required'));
      const payload = verifyToken(String(token));
      if (!payload?.uid) return next(new Error('invalid token'));
      const { ip, deviceId } = socketClientInfo(socket);
      const r = await query(
        `UPDATE users
            SET last_ip = COALESCE(NULLIF($2, ''), last_ip),
                device_id = COALESCE(NULLIF($3, ''), device_id)
          WHERE id = $1
          RETURNING id, username, nickname, avatar_url, selected_avatar_frame, coins, is_banned, is_muted, muted_until, muted_reason,
                    games_played, games_won, rank_wins, premium_until, last_ip, device_id, country_code, is_bot`,
        [payload.uid, ip, deviceId]
      );
      if (!r.rows[0] || r.rows[0].is_banned) return next(new Error('forbidden'));
      socket.user = r.rows[0];
      socket.clientInfo = { ip, deviceId };
      next();
    } catch (_err) {
      next(new Error('auth failed'));
    }
  });

  const manager = new RoomManager(io);
  // Expose to non-socket modules (admin routes, schedulers, etc.).
  setRegistry({ io, manager });
  // Mirror any pre-existing rooms (none on cold boot, but safe on hot
  // reload) into the shared Redis registry so the admin Room Monitor sees
  // them across instances.
  for (const room of manager.rooms.values()) {
    void registerRoom(room.code, lobbySnap(room));
  }
  // Periodic registry refresh — covers in-flight rooms.
  setInterval(() => {
    for (const r of manager.rooms.values()) {
      registerRoom(r.code, lobbySnap(r)).catch(() => {});
    }
  }, 10_000);

  io.on('connection', async (socket) => {
    logger.debug(`socket connected: ${socket.id} user=${socket.user.username}`);
    trackSocket(socket.user.id, socket.id);
    setPresence(socket.user.id, { username: socket.user.username, socketId: socket.id }).catch(() => {});
    socket._lastAction = 0;
    socket._packetRate = { windowStart: Date.now(), count: 0 };
    socket._roomCodes = new Set();
    socket._spectatorRoomCodes = new Set();

    socket.use((packet, next) => {
      const eventName = String(packet?.[0] || '');
      const limit = checkSocketPacketRateLimit(socket, eventName);
      if (!limit.ok) {
        const ack = packet?.[packet.length - 1];
        if (typeof ack === 'function') ack({ ok: false, error: limit.error, retryAfterMs: limit.retryAfterMs });
        return next(new Error(limit.error));
      }
      return next();
    });

    // PRO: flush any pending achievement popups now that the user is online.
    flushAchievementInbox(io, socket.user.id).catch(() => {});

    socket.on('rooms:list', () => {
      socket.emit('rooms:list', manager.publicList());
    });

    socket.on('tournament:watch', ({ tournamentId } = {}, cb) => {
      const id = String(tournamentId || '').slice(0, 80);
      if (!id) return cb?.({ ok: false, error: 'tournamentId required' });
      socket.join(`tournament:${id}`);
      const size = io.sockets.adapter.rooms.get(`tournament:${id}`)?.size || 0;
      io.to(`tournament:${id}`).emit('tournament:viewers', { tournamentId: id, viewers: size });
      cb?.({ ok: true, viewers: size });
    });

    socket.on('tournament:unwatch', ({ tournamentId } = {}) => {
      const id = String(tournamentId || '').slice(0, 80);
      if (!id) return;
      socket.leave(`tournament:${id}`);
      const size = io.sockets.adapter.rooms.get(`tournament:${id}`)?.size || 0;
      io.to(`tournament:${id}`).emit('tournament:viewers', { tournamentId: id, viewers: size });
    });

    socket.on('tournament:watch_match', async ({ tournamentId, matchId } = {}, cb) => {
      const tid = String(tournamentId || '').slice(0, 80);
      const mid = String(matchId || '').slice(0, 80);
      if (!tid || !mid) return cb?.({ ok: false, error: 'tournamentId and matchId required' });
      const roomName = `tournament:${tid}:match:${mid}`;
      socket.join(roomName);
      const match = await query(
        'SELECT room_code FROM tournament_matches WHERE id = $1 AND tournament_id = $2',
        [mid, tid]
      ).catch(() => ({ rows: [] }));
      const liveRoom = match.rows[0]?.room_code ? manager.get(match.rows[0].room_code) : null;
      if (liveRoom?.gameState) {
        socket.join(`room:${liveRoom.code}:spectators`);
        socket._spectatorRoomCodes.add(liveRoom.code);
        liveRoom.addSpectator(socket.id, { userId: socket.user.id, tournamentId: tid, matchId: mid });
      }
      const size = io.sockets.adapter.rooms.get(roomName)?.size || 0;
      await query('UPDATE tournament_matches SET viewer_count = $1 WHERE id = $2 AND tournament_id = $3', [size, mid, tid]).catch(() => {});
      io.to(`tournament:${tid}`).emit('tournament:match_viewers', { tournamentId: tid, matchId: mid, viewers: size });
      cb?.({ ok: true, viewers: size, roomCode: liveRoom?.code || match.rows[0]?.room_code || null, view: liveRoom?.viewForSpectator?.() || null });
    });

    socket.on('tournament:unwatch_match', async ({ tournamentId, matchId } = {}) => {
      const tid = String(tournamentId || '').slice(0, 80);
      const mid = String(matchId || '').slice(0, 80);
      if (!tid || !mid) return;
      const roomName = `tournament:${tid}:match:${mid}`;
      socket.leave(roomName);
      const match = await query(
        'SELECT room_code FROM tournament_matches WHERE id = $1 AND tournament_id = $2',
        [mid, tid]
      ).catch(() => ({ rows: [] }));
      const liveRoom = match.rows[0]?.room_code ? manager.get(match.rows[0].room_code) : null;
      if (liveRoom) {
        liveRoom.removeSpectator(socket.id);
        socket._spectatorRoomCodes.delete(liveRoom.code);
      }
      const size = io.sockets.adapter.rooms.get(roomName)?.size || 0;
      await query('UPDATE tournament_matches SET viewer_count = $1 WHERE id = $2 AND tournament_id = $3', [size, mid, tid]).catch(() => {});
      io.to(`tournament:${tid}`).emit('tournament:match_viewers', { tournamentId: tid, matchId: mid, viewers: size });
    });

    // PRO: Smart matchmaking — prefer pairing real humans (TOR §3).
    socket.on('mm:join', async (opts = {}, cb) => {
      try {
        const stake = Math.max(config.game.minBet, Number(opts.stake) || config.game.minBet);
        const maxPlayers = normalizeAllowedTableSize(opts.maxPlayers, 2);
        const liveCoins = await getCurrentCoins(socket.user.id);
        if (liveCoins < stake) return cb?.({ ok: false, error: 'insufficient coins' });
        const r = mmEnqueue(io, manager, socket, {
          stake, maxPlayers,
          mode: opts.mode || 'classic',
          bluffEnabled: !!opts.bluffEnabled,
        });
        cb?.(r);
      } catch (err) {
        cb?.({ ok: false, error: err.message });
      }
    });
    socket.on('mm:cancel', (_, cb) => {
      const ok = mmDequeue(socket);
      cb?.({ ok });
    });
    socket.on('mm:stats', (_, cb) => {
      cb?.({ ok: true, queues: queueStats() });
    });

    socket.on('room:create', async (opts = {}, cb) => {
      try {
        // S4: Validate all create-room options.
        const v = validateSocketPayload('room:create', opts);
        if (!v.ok) return cb?.({ ok: false, error: v.error });

        const stake = Math.max(config.game.minBet, Number(v.data.stake) || config.game.minBet);
        const requestedSize = normalizeAllowedTableSize(v.data.maxPlayers, 2);
        const isPrivate = !!v.data.isPrivate;
        const password = String(opts.password || '').trim().slice(0, 24);
        if (isPrivate && password.length < 3) {
          return cb?.({ ok: false, error: 'private password required' });
        }
        const liveCoins = await getCurrentCoins(socket.user.id);
        if (liveCoins < stake) return cb?.({ ok: false, error: 'insufficient coins' });
        const room = manager.createRoom({
          maxPlayers: requestedSize,
          stake,
          bluffEnabled: !!v.data.bluffEnabled,
          mode: v.data.mode || 'classic',
          isPrivate,
          password,
          deckSize: opts.deckSize,
          turnSeconds: opts.turnSeconds,
          transferEnabled: !!opts.transferEnabled,
          throwInMode: opts.throwInMode,
          allowDraw: opts.allowDraw !== false,
          botLevel: opts.botLevel || 'medium',
          host: {
            id: socket.user.id,
            username: socket.user.username,
            nickname: socket.user.nickname,
            avatar_url: socket.user.avatar_url,
            country_code: socket.user.country_code,
          },
        });
        const r = room.join(
          {
            id: socket.user.id,
            username: socket.user.username,
            nickname: socket.user.nickname,
            avatar_url: socket.user.avatar_url,
            selected_avatar_frame: socket.user.selected_avatar_frame,
            country_code: socket.user.country_code,
            isBot: false,
            socketId: socket.id,
            ip: socket.clientInfo?.ip,
            deviceId: socket.clientInfo?.deviceId,
            rankWins: Number(socket.user.rank_wins || socket.user.games_won || 0),
          },
          room.password
        );
        if (!r.ok) manager.destroy(room.code);
        if (r.ok) {
          socket.join(`room:${room.code}`);
          socket._roomCodes.add(room.code);
        }
        cb?.({ ok: r.ok, code: room.code, error: r.error });
        if (r.ok) {
          room.broadcastLobby();
          registerRoom(room.code, lobbySnap(room)).catch(() => {});
        }
      } catch (err) {
        cb?.({ ok: false, error: err.message });
      }
    });

    socket.on('room:join', async ({ code, password } = {}, cb) => {
      const safeCode = String(code || '').trim().toUpperCase();
      const safePassword = String(password || '').trim().slice(0, 24);
      const room = manager.get(safeCode);
      if (!room) return cb?.({ ok: false, error: 'room not found' });

      // --- Bug 2 fix: reconnect paytida game state qaytarish ---
      // O'yin davom etayotgan bo'lsa, seatni yangilab game:start yuboramiz.
      if (room.state.phase === 'playing') {
        const existingSeat = room.seats.find((s) => s && s.id === socket.user.id);
        if (existingSeat) {
          existingSeat.socketId = socket.id;
          existingSeat.username = socket.user.username || existingSeat.username;
          existingSeat.nickname = socket.user.nickname || existingSeat.nickname;
          existingSeat.avatar_url = socket.user.avatar_url || existingSeat.avatar_url;
          existingSeat.selected_avatar_frame = socket.user.selected_avatar_frame || existingSeat.selected_avatar_frame;
          existingSeat.country_code = socket.user.country_code || existingSeat.country_code;
          existingSeat.ip = socket.clientInfo?.ip || existingSeat.ip;
          existingSeat.deviceId = socket.clientInfo?.deviceId || existingSeat.deviceId;
          socket.join(`room:${room.code}`);
          socket._roomCodes.add(room.code);
          const gameView = room.viewForPlayer(socket.user.id);
          socket.emit('game:start', gameView);
          cb?.({ ok: true, reconnected: true, view: gameView });
          return;
        }
        return cb?.({ ok: false, error: 'game already started' });
      }

      try {
        const liveCoins = await getCurrentCoins(socket.user.id);
        if (liveCoins < room.stake) return cb?.({ ok: false, error: 'insufficient coins' });
      } catch (e) {
        logger.warn('coin read failed for room:join', e.message);
        return cb?.({ ok: false, error: 'balance check failed' });
      }
      const r = room.join({
        id: socket.user.id,
        username: socket.user.username,
        nickname: socket.user.nickname,
        avatar_url: socket.user.avatar_url,
        selected_avatar_frame: socket.user.selected_avatar_frame,
        country_code: socket.user.country_code,
        isBot: false,
        socketId: socket.id,
        ip: socket.clientInfo?.ip,
        deviceId: socket.clientInfo?.deviceId,
        rankWins: Number(socket.user.rank_wins || socket.user.games_won || 0),
      }, safePassword);
      if (r.ok) {
        socket.join(`room:${room.code}`);
        socket._roomCodes.add(room.code);
      }
      registerRoom(room.code, lobbySnap(room)).catch(() => {});
      cb?.(r);
      if (r.ok) socket.emit('room:state', room.lobbySnapshot());
    });

    socket.on('room:leave', ({ code }) => {
      const room = manager.get(code);
      if (!room) return;
      socket.leave(`room:${room.code}`);
      socket._roomCodes.delete(room.code);
      room.leave(socket.user.id);
      if (!room.seats.some(Boolean)) unregisterRoom(room.code).catch(() => {});
    });

    socket.on('game:forfeit', async ({ code } = {}, cb) => {
      const room = manager.get(code);
      if (!room) return cb?.({ ok: false, error: 'room not found' });
      if (!room.gameState || room.gameState.phase === 'ended') {
        return cb?.({ ok: false, error: 'game already ended' });
      }
      const seated = room.seats.some((s) => s && s.id === socket.user.id);
      if (!seated) return cb?.({ ok: false, error: 'not seated' });
      const ok = await room.forfeitPlayer(socket.user.id, 'left_by_button');
      if (!ok) return cb?.({ ok: false, error: 'forfeit failed' });
      return cb?.({ ok: true, view: room.viewForPlayer(socket.user.id) });
    });

    socket.on('room:ready', ({ code, ready }) => {
      const room = manager.get(code);
      room?.setReady(socket.user.id, !!ready);
    });

    socket.on('room:open', ({ code }, cb) => {
      const room = manager.get(code);
      if (!room) return cb?.({ ok: false, error: 'room not found' });
      if (room.host?.id !== socket.user.id) return cb?.({ ok: false, error: 'host only' });
      room.isPrivate = false;
      room.password = '';
      room.armBotFillTimer?.();
      room.broadcastLobby();
      registerRoom(room.code, lobbySnap(room)).catch(() => {});
      cb?.({ ok: true });
    });

    socket.on('room:invite', async ({ code, friendId, nickname } = {}, cb) => {
      const room = manager.get(String(code || '').trim().toUpperCase());
      if (!room) return cb?.({ ok: false, error: 'room not found' });
      if (!room.seats.some((s) => s?.id === socket.user.id)) return cb?.({ ok: false, error: 'not in room' });

      let target = null;
      if (friendId) {
        const safeFriendId = String(friendId);
        const friend = await query(
          "SELECT status FROM friends WHERE user_id = $1 AND friend_id = $2",
          [socket.user.id, safeFriendId]
        );
        if (friend.rows[0]?.status !== 'accepted') return cb?.({ ok: false, error: 'not friends' });
        const user = await query(
          'SELECT id, username, nickname, fcm_token FROM users WHERE id = $1 AND is_banned = FALSE AND is_bot IS NOT TRUE',
          [safeFriendId]
        );
        target = user.rows[0] || null;
      } else {
        const nick = cleanNickname(nickname);
        if (!/^[a-zA-Z0-9_]{3,24}$/.test(nick)) return cb?.({ ok: false, error: 'nickname required' });
        const user = await query(
          `SELECT id, username, nickname, fcm_token
             FROM users
            WHERE is_banned = FALSE
              AND is_bot IS NOT TRUE
              AND (lower(nickname) = lower($1) OR lower(username) = lower($1))
            LIMIT 1`,
          [nick]
        );
        target = user.rows[0] || null;
      }

      if (!target) return cb?.({ ok: false, error: 'user not found' });
      if (String(target.id) === String(socket.user.id)) return cb?.({ ok: false, error: 'cannot invite yourself' });

      room.grantInvite(target.id);
      const fromName = socket.user.nickname || socket.user.username;
      const payload = {
        code: room.code,
        password: room.password || '',
        fromUserId: socket.user.id,
        fromUsername: fromName,
        isPrivate: room.isPrivate,
        stake: room.stake,
        maxPlayers: room.maxPlayers,
        roomTitle: room.title || room.code,
        direct: true,
      };

      let delivered = false;
      const targets = userSockets.get(String(target.id));
      if (targets?.size) {
        delivered = true;
        for (const sid of targets) io.to(sid).emit('room:invite', payload);
      }

      let pushed = false;
      if (target.fcm_token) {
        pushed = true;
        pushGameInvite(target.fcm_token, fromName, room.code, {
          password: room.password || '',
          isPrivate: room.isPrivate,
          stake: room.stake,
          maxPlayers: room.maxPlayers,
          roomTitle: room.title || room.code,
        }).catch((e) => {
          logger.warn('pushGameInvite failed: %s', e.message);
        });
      }

      cb?.({
        ok: true,
        delivered,
        pushed,
        user: { id: target.id, username: target.username, nickname: target.nickname },
      });
    });

    socket.on('room:fill-bots', async ({ code }, cb) => {
      const room = manager.get(String(code || '').trim().toUpperCase());
      if (!room) return cb?.({ ok: false, error: 'room not found' });
      if (room.state.phase !== 'lobby') return cb?.({ ok: false, error: 'already started' });
      const r = await room.fillWithBots();
      cb?.(r || { ok: true });
    });

    socket.on('room:start', async ({ code }, cb) => {
      try {
        const room = manager.get(code);
        if (!room) return cb?.({ ok: false, error: 'room not found' });
        const r = await room.requestStart(socket.user.id);
        if (r?.ok && room.state.phase === 'playing') {
          cb?.({ ...r, view: room.viewForPlayer(socket.user.id) });
        } else {
          cb?.(r);
        }
      } catch (err) {
        cb?.({ ok: false, error: err.message || 'start failed' });
      }
    });

    socket.on('game:action', (rawPayload, cb) => {
      // S4: Validate payload — prevents malformed card IDs, unknown actions,
      // oversized room codes, and other injection vectors.
      const validation = validateSocketPayload('game:action', rawPayload);
      if (!validation.ok) {
        return cb?.({ ok: false, error: validation.error });
      }
      const { code, action, payload } = validation.data;

      const actionLimit = checkGameActionRateLimit(socket);
      if (!actionLimit.ok) return cb?.(actionLimit);
      const room = manager.get(code);
      if (!room) return cb?.({ ok: false, error: 'room not found' });
      const r = room.requestAction(socket.user.id, action, payload || {});
      cb?.(r);
      // After every action, re-attempt achievement flush for everyone at
      // the table — checkAndUnlock writes the inbox in room.finishGame.
      if (room.state.phase === 'ended') {
        for (const seat of room.seats) {
          if (seat && !seat.isBot) flushAchievementInbox(io, seat.id).catch(() => {});
        }
      }
    });

    socket.on('game:action_confirm', ({ code, requestId, accept } = {}, cb) => {
      const safeCode = String(code || '').trim().toUpperCase();
      const safeRequestId = String(requestId || '').trim();
      if (!/^[A-Z0-9]{4,16}$/i.test(safeCode) || !safeRequestId) {
        return cb?.({ ok: false, error: 'invalid confirm request' });
      }
      const room = manager.get(safeCode);
      if (!room) return cb?.({ ok: false, error: 'room not found' });
      const r = room.confirmPendingAction(socket.user.id, safeRequestId, accept !== false);
      cb?.(r);
      if (room.state.phase === 'ended') {
        for (const seat of room.seats) {
          if (seat && !seat.isBot) flushAchievementInbox(io, seat.id).catch(() => {});
        }
      }
    });

    socket.on('game:poke-timeout', ({ code }, cb) => {
      const room = manager.get(code);
      if (!room) return cb?.({ ok: false, error: 'room not found' });
      const allowed = canPokeTurnTimeout(room, socket.user.id);
      if (!allowed.ok) return cb?.({ ...allowed, view: room.viewForPlayer(socket.user.id) });
      room.handleTurnTimeout();
      cb?.({ ok: true, timedOut: true, view: room.viewForPlayer(socket.user.id) });
    });

    socket.on('game:perk', async ({ code, perk }, cb) => {
      try {
        const room = manager.get(code);
        const result = await applyPerk({ user: socket.user, perk, room });
        cb?.(result);
      } catch (err) {
        cb?.({ ok: false, error: err.message || 'perk failed' });
      }
    });

    socket.on('report:submit', async ({ code, reportedId, reason, details }, cb) => {
      try {
        if (!reportedId) return cb?.({ ok: false, error: 'reportedId required' });
        const room = manager.get(code);
        const r = await submitReport({
          reporterId: socket.user.id,
          reportedId: String(reportedId),
          roomCode: room?.code || null,
          gameId: room?.gameState?.id || null,
          reason,
          details,
        });
        cb?.({ ok: true, ...r });
      } catch (err) {
        cb?.({ ok: false, error: err.message || 'report failed' });
      }
    });

    socket.on('chat:message', async ({ code, content, type }, cb) => {
      // S4: Trim and length-cap message content before any other processing.
      const safeContent = String(content || '').trim().slice(0, 500);
      const room = manager.get(code);
      if (!room) return cb?.({ ok: false, error: 'room not found' });
      const seat = room.seats.find((s) => s && s.id === socket.user.id);
      if (!seat) return cb?.({ ok: false, error: 'not in room' });
      const mute = activeMute(socket.user);
      if (mute) return cb?.({ ok: false, error: mute.reason, mutedUntil: mute.mutedUntil });

      const realPlayerCount = room.seats.filter((s) => s && !s.isBot).length;
      const isPremium = await isUserPremium(socket.user.id);
      const t = type || 'text';
      if ((t === 'image' || t === 'video') && realPlayerCount !== 2) {
        return cb?.({ ok: false, error: "Media chat faqat 1 ga 1 o'yinda ishlaydi." });
      }
      if ((t === 'image' || t === 'video') && !isPremium) return cb?.({ ok: false, error: 'media chat is premium-only' });
      if (t === 'text' && (!safeContent || safeContent.length === 0)) return cb?.({ ok: false, error: 'message cannot be empty' });
      if (t === 'emoji') {
        const packId = String(safeContent || '').split(':')[0];
        const premiumPack = PREMIUM_EMOJI_PACK_IDS.has(packId);
        if (premiumPack && !isPremium) return cb?.({ ok: false, error: 'this emoji pack is premium-only' });
      }

      const msg = {
        id: `${Date.now()}-${socket.id}`,
        senderId: socket.user.id,
        senderName: socket.user.username,
        type: t,
        content: String(content || '').slice(0, 2000),
        sentAt: Date.now(),
      };
      io.to(`room:${room.code}`).emit('chat:message', msg);
      try {
        await query(
          'INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, $3, $4)',
          [room.code, socket.user.id, msg.content, t]
        );
      } catch (_) { /* ignore */ }
      cb?.({ ok: true });
    });

    // PRO: client requests an inbox drain (e.g. after coming back from
    // background; matches the offline-resilient inbox model).
    socket.on('achievement:pull', async () => {
      await flushAchievementInbox(io, socket.user.id);
    });

    // Periodic presence refresh while the socket is alive — keep the TTL fresh.
    const presenceTimer = setInterval(() => {
      setPresence(socket.user.id, { username: socket.user.username, socketId: socket.id }).catch(() => {});
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────
    // Feature 30: Ovozli chat — WebRTC signaling relay
    // Faqat 1v1 o'yinda, 10 o'yindan keyin, tasdiq kerak
    // ─────────────────────────────────────────────────────────────────
    const VOICE_REQUEST_TTL_MS = 60_000;

    function parseVoicePayload(eventName, rawPayload, cb) {
      const parsed = validateSocketPayload(eventName, rawPayload);
      if (!parsed.ok) {
        cb?.({ ok: false, error: parsed.error });
        socket.emit('voice:error', { error: parsed.error });
        return null;
      }
      return parsed.data;
    }

    function clearVoicePending(room) {
      if (!room) return;
      if (room.voicePendingTimer) clearTimeout(room.voicePendingTimer);
      room.voicePendingTimer = null;
      room.voicePending = null;
    }

    function scheduleVoicePendingExpiry(room, pending) {
      if (room.voicePendingTimer) clearTimeout(room.voicePendingTimer);
      room.voicePendingTimer = setTimeout(() => {
        const current = room.voicePending;
        if (!current || current.at !== pending.at || current.fromId !== pending.fromId) return;
        clearVoicePending(room);
        io.to(pending.fromSocketId).emit('voice:timeout', { code: pending.code });
        io.to(pending.toSocketId).emit('voice:timeout', { code: pending.code });
      }, VOICE_REQUEST_TTL_MS);
    }

    function pendingMatches(pending, fromId, toId) {
      return !!pending
        && String(pending.fromId) === String(fromId)
        && String(pending.toId) === String(toId)
        && Date.now() - Number(pending.at || 0) <= VOICE_REQUEST_TTL_MS;
    }

    async function validateVoiceRoom(code, userId, opts = {}) {
      const safeCode = String(code || '').trim().toUpperCase();
      const room = manager.get(safeCode);
      if (!room) return { ok: false, error: 'room not found' };
      if (opts.checkMute !== false) {
        const mute = activeMute(socket.user);
        if (mute) return { ok: false, error: mute.reason, mutedUntil: mute.mutedUntil };
      }
      const players = room.seats.filter((s) => s && !s.isBot);
      if (room.maxPlayers !== 2 || players.length !== 2) {
        return { ok: false, error: "Ovozli chat faqat 2 ta haqiqiy o'yinchi bo'lgan 1 ga 1 o'yinda ishlaydi." };
      }
      const me = players.find((p) => String(p.id) === String(userId));
      const other = players.find((p) => String(p.id) !== String(userId));
      if (!me || !other?.socketId) return { ok: false, error: 'player not available' };
      if (opts.requireEligibility !== false) {
        const allowed = await canUseVoice(userId, await isUserPremium(userId));
        if (!allowed.allowed) return { ok: false, error: allowed.reason || 'voice unavailable' };
      }
      let session = null;
      if (opts.requireActiveSession) {
        session = await getActiveVoiceSession(safeCode);
        if (!session) return { ok: false, error: 'voice session not active' };
        const sessionUsers = new Set([String(session.user_a), String(session.user_b)]);
        if (!sessionUsers.has(String(me.id)) || !sessionUsers.has(String(other.id))) {
          return { ok: false, error: 'voice session mismatch' };
        }
      }
      return { ok: true, code: safeCode, room, me, other, session };
    }

    socket.on('voice:request', async (rawPayload = {}, cb) => {
      try {
        const data = parseVoicePayload('voice:request', rawPayload, cb);
        if (!data) return;
        const v = await validateVoiceRoom(data.code, socket.user.id);
        if (!v.ok) {
          socket.emit('voice:error', { code: data.code, error: v.error });
          return cb?.({ ok: false, error: v.error });
        }
        if (await getActiveVoiceSession(v.code)) {
          return cb?.({ ok: false, error: 'voice session already active' });
        }
        if (v.room.voicePending && Date.now() - Number(v.room.voicePending.at || 0) <= VOICE_REQUEST_TTL_MS) {
          return cb?.({ ok: false, error: 'voice request already pending' });
        }
        clearVoicePending(v.room);
        const pending = {
          code: v.code,
          fromId: String(socket.user.id),
          toId: String(v.other.id),
          fromSocketId: socket.id,
          toSocketId: v.other.socketId,
          at: Date.now(),
        };
        v.room.voicePending = pending;
        scheduleVoicePendingExpiry(v.room, pending);
        io.to(v.other.socketId).emit('voice:request', {
          fromId: socket.user.id,
          fromName: socket.user.username,
          code: v.code,
          timeoutMs: VOICE_REQUEST_TTL_MS,
        });
        cb?.({ ok: true });
      } catch (err) {
        cb?.({ ok: false, error: err.message });
      }
    });

    socket.on('voice:accept', async (rawPayload = {}, cb) => {
      try {
        const data = parseVoicePayload('voice:accept', rawPayload, cb);
        if (!data) return;
        const v = await validateVoiceRoom(data.code, socket.user.id);
        if (!v.ok) {
          socket.emit('voice:error', { code: data.code, error: v.error });
          return cb?.({ ok: false, error: v.error });
        }
        const pending = v.room.voicePending;
        if (!pendingMatches(pending, v.other.id, socket.user.id)) {
          clearVoicePending(v.room);
          return cb?.({ ok: false, error: 'voice request expired' });
        }
        const otherAllowed = await canUseVoice(v.other.id, await isUserPremium(v.other.id));
        if (!otherAllowed.allowed) return cb?.({ ok: false, error: otherAllowed.reason || 'voice unavailable' });
        await startVoiceSession(v.code, pending.fromId, socket.user.id);
        clearVoicePending(v.room);
        io.to(v.other.socketId).emit('voice:accept', { code: v.code });
        cb?.({ ok: true });
      } catch (err) {
        cb?.({ ok: false, error: err.message });
      }
    });

    socket.on('voice:reject', async (rawPayload = {}, cb) => {
      try {
        const data = parseVoicePayload('voice:reject', rawPayload, cb);
        if (!data) return;
        const v = await validateVoiceRoom(data.code, socket.user.id, { requireEligibility: false, checkMute: false });
        if (!v.ok) return cb?.({ ok: false, error: v.error });
        const pending = v.room.voicePending;
        if (!pendingMatches(pending, v.other.id, socket.user.id)) {
          clearVoicePending(v.room);
          return cb?.({ ok: false, error: 'voice request expired' });
        }
        clearVoicePending(v.room);
        io.to(v.other.socketId).emit('voice:reject', { code: v.code });
        cb?.({ ok: true });
      } catch (err) {
        cb?.({ ok: false, error: err.message });
      }
    });

    socket.on('voice:offer', async (rawPayload = {}) => {
      try {
        const data = parseVoicePayload('voice:offer', rawPayload);
        if (!data) return;
        const v = await validateVoiceRoom(data.code, socket.user.id, { requireEligibility: false, requireActiveSession: true });
        if (!v.ok) return socket.emit('voice:error', { code: data.code, error: v.error });
        io.to(v.other.socketId).emit('voice:offer', { offer: data.offer, code: v.code });
      } catch (err) {
        socket.emit('voice:error', { error: err.message || 'voice offer failed' });
      }
    });

    socket.on('voice:answer', async (rawPayload = {}) => {
      try {
        const data = parseVoicePayload('voice:answer', rawPayload);
        if (!data) return;
        const v = await validateVoiceRoom(data.code, socket.user.id, { requireEligibility: false, requireActiveSession: true });
        if (!v.ok) return socket.emit('voice:error', { code: data.code, error: v.error });
        io.to(v.other.socketId).emit('voice:answer', { answer: data.answer, code: v.code });
      } catch (err) {
        socket.emit('voice:error', { error: err.message || 'voice answer failed' });
      }
    });

    socket.on('voice:ice', async (rawPayload = {}) => {
      try {
        const data = parseVoicePayload('voice:ice', rawPayload);
        if (!data) return;
        const v = await validateVoiceRoom(data.code, socket.user.id, { requireEligibility: false, requireActiveSession: true });
        if (!v.ok) return socket.emit('voice:error', { code: data.code, error: v.error });
        io.to(v.other.socketId).emit('voice:ice', { candidate: data.candidate, code: v.code });
      } catch (err) {
        socket.emit('voice:error', { error: err.message || 'voice ice failed' });
      }
    });

    // Istalgan tomon o'chirsa — ikkala tomonda o'chadi (Feature 30)
    socket.on('voice:end', async (rawPayload = {}, cb) => {
      const data = parseVoicePayload('voice:end', rawPayload, cb);
      if (!data) return;
      const v = await validateVoiceRoom(data.code, socket.user.id, { requireEligibility: false, checkMute: false });
      if (!v.ok) return cb?.({ ok: false, error: v.error });
      clearVoicePending(v.room);
      await endVoiceSession(v.code).catch(() => {});
      io.to(`room:${v.code}`).emit('voice:end', { code: v.code, reason: data.reason || 'ended' });
      cb?.({ ok: true });
    });

    socket.on('disconnect', async () => {
      clearInterval(presenceTimer);
      logger.debug(`socket disconnected: ${socket.id} user=${socket.user.username}`);
      untrackSocket(socket.user.id, socket.id);
      premiumCache.delete(socket.user.id);
      // PRO: Remove from matchmaking queue if waiting.
      try { mmDequeue(socket); } catch (_) {}
      // Only clear shared presence if no other socket of this user is left
      // (a user with multiple tabs would otherwise look offline).
      if (!userSockets.has(socket.user.id)) {
        clearPresence(socket.user.id).catch(() => {});
      }
      const knownCodes = new Set([
        ...Array.from(socket._roomCodes || []),
        ...Array.from(socket._spectatorRoomCodes || []),
      ]);
      const roomsToCheck = knownCodes.size
        ? Array.from(knownCodes, (code) => manager.get(code)).filter(Boolean)
        : Array.from(manager.rooms.values());
      for (const room of roomsToCheck) {
        if (!knownCodes.size || socket._spectatorRoomCodes?.has(room.code)) {
          room.removeSpectator?.(socket.id);
          socket._spectatorRoomCodes?.delete(room.code);
        }
        const seat = room.seats.find((s) => s && s.id === socket.user.id);
        if (!seat) continue;
        const hadPendingVoice = !!room.voicePending;
        const endedVoice = await endVoiceSession(room.code).catch(() => null);
        clearVoicePending(room);
        if (hadPendingVoice || endedVoice) {
          io.to(`room:${room.code}`).emit('voice:end', { code: room.code, reason: 'disconnect' });
        }
        if (room.state.phase === 'playing') {
          // Bug 1 fix: O'yin paytida disconnect → socketId=null qilinadi.
          // Forfeit qilish uchun turn timer ishlatiladi (handleTurnTimeout).
          // Shunday qilib mobil tarmoq uzilishi o'yinchini darhol yutqazmaydi.
          seat.socketId = null;
        } else {
          // Lobby yoki ended fazada — odatdagidek chiqariladi.
          room.leave(socket.user.id);
        }
        socket._roomCodes?.delete(room.code);
      }
    });
  });

  return { io, manager };
}

function lobbySnap(r) {
  return {
    code: r.code,
    phase: r.state.phase,
    mode: r.mode,
    stake: r.stake,
    maxPlayers: r.maxPlayers,
    host: r.host?.username,
    isPrivate: r.isPrivate,
    hasPassword: !!r.password,
    bluffEnabled: r.bluffEnabled,
    deckSize: r.deckSize,
    turnSeconds: Math.round(r.turnTimeoutMs / 1000),
    transferEnabled: r.transferEnabled,
    throwInMode: r.throwInMode,
    allowDraw: r.allowDraw,
    taken: r.seats.filter(Boolean).length,
    realCount: r.seats.filter((s) => s && !s.isBot).length,
  };
}
