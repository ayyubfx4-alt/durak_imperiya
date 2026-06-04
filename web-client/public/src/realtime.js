import { api, getToken } from './api.js';
import { state, emit, on } from './state.js';
import { ensureSocket, getSocket } from './socket.js';

const POLL_MS = 12000;
const MIN_REFRESH_GAP_MS = 850;

let started = false;
let inFlight = null;
let lastSyncAt = 0;
let lastSignature = '';
let pollTimer = null;
let wiredSocket = null;

const USER_FIELDS = [
  'coins',
  'gold_coins',
  'tournament_tickets',
  'elon_stickers',
  'games_played',
  'games_won',
  'games_lost',
  'games_draw',
  'win_streak',
  'loss_streak',
  'rank_wins',
  'rank_color',
  'rank_lines',
  'rank_pluses',
  'rank_progress',
  'premium_until',
  'selected_skin',
  'selected_avatar_frame',
  'avatar_url',
  'nickname',
  'global_rank',
  'total_donated_cents',
];

function userSignature(user) {
  if (!user) return '';
  return USER_FIELDS.map((key) => `${key}:${user[key] ?? ''}`).join('|');
}

function shouldSyncForDirty(payload) {
  const ids = Array.isArray(payload?.userIds) ? payload.userIds.map(String) : [];
  if (!ids.length) return true;
  return Boolean(state.user?.id && ids.includes(String(state.user.id)));
}

function wireSocket(socket) {
  if (!socket || wiredSocket === socket) return;
  wiredSocket = socket;

  socket.on('connect', () => refreshLiveState('socket-connect', { force: true }));
  socket.on('reconnect', () => refreshLiveState('socket-reconnect', { force: true }));
  socket.on('user:stats-dirty', (payload) => {
    if (shouldSyncForDirty(payload)) refreshLiveState(payload?.reason || 'server-dirty', { force: true });
  });
  socket.on('game:end', () => refreshLiveState('game-end', { force: true }));
  socket.on('game:forfeit', () => refreshLiveState('game-forfeit', { force: true }));
  socket.on('achievement:unlock', () => refreshLiveState('achievement', { force: true }));
  socket.on('gift:received', () => refreshLiveState('gift', { force: true }));
  socket.on('tournament:match_result', () => refreshLiveState('tournament', { force: true }));
}

export async function refreshLiveState(reason = 'manual', options = {}) {
  if (!getToken()) return { changed: false, skipped: true };
  const now = Date.now();
  if (!options.force && now - lastSyncAt < MIN_REFRESH_GAP_MS) return { changed: false, skipped: true };
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const before = lastSignature || userSignature(state.user);
      const user = await api.me();
      state.user = { ...(state.user || {}), ...user };
      const after = userSignature(state.user);
      lastSignature = after;
      lastSyncAt = Date.now();
      const changed = before !== after;
      emit('user:update', { user: state.user, reason, changed });
      if (changed) emit('live:changed', { user: state.user, reason });
      return { changed, user: state.user };
    } catch (err) {
      emit('live:error', { reason, error: err });
      return { changed: false, error: err };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function startLiveSync({ onChange, onHeartbeat } = {}) {
  if (onChange) on('live:changed', onChange);
  if (onHeartbeat) on('live:heartbeat', onHeartbeat);
  if (started) return;
  started = true;
  lastSignature = userSignature(state.user);

  const existing = getSocket();
  if (existing) wireSocket(existing);
  ensureSocket()
    .then(wireSocket)
    .catch(() => {});

  const heartbeat = async (reason = 'poll') => {
    if (document.hidden) return;
    const result = await refreshLiveState(reason);
    emit('live:heartbeat', { reason, changed: Boolean(result?.changed) });
  };

  pollTimer = setInterval(() => heartbeat('poll'), POLL_MS);
  window.addEventListener('focus', () => heartbeat('focus'));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) heartbeat('visible');
  });
}

export function stopLiveSync() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
