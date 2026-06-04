// Main entry — i18n init, auth, routing, sound prefs, achievement popups,
// Capacitor native bridge (when running inside the mobile shell).
import { route, mount, navigate, currentRoute } from './router.js';
import { state } from './state.js';
import { api, getToken, setToken, clearToken } from './api.js';
import { initI18n } from './i18n.js?v=140-full-audit';
import { sfx } from './sfx.js?v=140-full-audit';
import { showAchievement, showEvent } from './ui/popups.js?v=140-full-audit';
import { getSocket, ensureSocket } from './socket.js';
import { startLiveSync } from './realtime.js?v=140-full-audit';
import { initRuntimeSettings } from './runtimeSettings.js?v=140-full-audit';
import { completeRoyalLoader, showRoyalLoader, updateRoyalLoader } from './royalLoading.js?v=140-full-audit';
import { initSupportWidget, refreshSupportWidget } from './supportWidget.js?v=151-mobile-polish';
import { initTelegramWebApp } from './telegramWebApp.js?v=140-full-audit';

import { renderLogin }        from './pages/login.js?v=141-support-draft';
import { renderNickname }     from './pages/nickname.js?v=140-full-audit';
import { renderHome, invalidateHomePanelCache } from './pages/home.js?v=146-live-countdown-151-mobile-polish-157-baraban-professional-rewards-159-logo';
import { renderLobby }        from './pages/lobby.js?v=143-main-audit';
import { renderRoom }         from './pages/room.js?v=140-full-audit';
import { renderGame }         from './pages/game.js?v=153-game-skin-refresh-159-emoji-mobile-160-curated-card-skins-161-mobile-card-size-162-game-smooth';
import { renderProfileV80 as renderProfile } from './pages/profile.js?v=149-profile-polish-151-mobile-polish';
import { renderShop }         from './pages/shop.js?v=152-premium-classic-skin-160-curated-card-skins';
import { renderFriends }      from './pages/friends.js?v=140-full-audit';
import { renderAchievements } from './pages/achievements.js?v=140-full-audit';
import { renderRules }        from './pages/rules.js';
import { renderLeaderboard }  from './pages/leaderboard.js?v=147-live-ui';
import { renderTournaments }  from './pages/tournaments.js?v=147-live-ui-151-mobile-polish';
import { renderDonations }    from './pages/donations.js?v=140-full-audit';
import { renderSettings }     from './pages/settings.js?v=140-full-audit';
import { renderInventory }    from './pages/inventory.js?v=140-full-audit-160-curated-card-skins';
import { renderStickers }     from './pages/stickers.js?v=140-full-audit';

route('login',        renderLogin);
route('nickname',     renderNickname);
route('home',         renderHome);
route('lobby',        renderLobby);
route('room',         renderRoom);
route('game',         renderGame);
route('profile',      renderProfile);
route('shop',         renderShop);
route('friends',      renderFriends);
route('achievements', renderAchievements);
route('rules',        renderRules);
route('leaderboard',  renderLeaderboard);
route('tournaments',  renderTournaments);
route('donations',    renderDonations);
route('settings',     renderSettings);
route('inventory',    renderInventory);
route('stickers',     renderStickers);

async function enterAsGuest() {
  const res = await api.guest();
  setToken(res.token);
  state.user = res.user;
}

function shouldAutoGuest() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

// Capture referral / room code from the URL (?ref= / ?room=).
function captureReferral() {
  try {
    const url = new URL(location.href);
    const ref = url.searchParams.get('ref') || url.searchParams.get('referral');
    if (ref) localStorage.setItem('referral_code', ref);
    const room = url.searchParams.get('room');
    if (room) sessionStorage.setItem('pending_room', room);
  } catch (_) { /* ignore */ }
}

// Wire global socket listeners — achievement popups + generic event toasts.
// Idempotent: only registered once per page load.
let socketListenersBound = false;
let pushInviteListenersBound = false;

function rememberRoomInvite(inv) {
  const code = String(inv?.code || inv?.roomCode || '').trim().toUpperCase();
  if (!code) return '';
  try {
    sessionStorage.setItem('pending_room', code);
    sessionStorage.setItem('pending_room_password', inv?.password || '');
  } catch (_) { /* ignore */ }
  return code;
}

function openInvitedRoom(inv) {
  const code = rememberRoomInvite(inv);
  if (code) navigate('room', { code, action: 'join' });
}

function handleRoomInvite(inv, { autoJoin = false, prompt = true } = {}) {
  const code = rememberRoomInvite(inv);
  if (!code) return;
  const from = inv?.fromUsername || inv?.fromNickname || "Do'st";
  if (autoJoin) {
    openInvitedRoom({ ...inv, code });
    return;
  }
  showEvent({
    title: "O'yin taklifi",
    message: `${from} sizni ${code} xonasiga taklif qildi`,
    icon: '🔔',
    onClick: () => openInvitedRoom({ ...inv, code }),
  });
  if (prompt && confirm(`${from} sizni ${code} xonasiga chaqiryapti. Hozir qo'shilasizmi?`)) {
    openInvitedRoom({ ...inv, code });
  }
}

function pushInviteData(detail) {
  const notification = detail?.notification || detail || {};
  return detail?.data || notification?.data || {};
}

function bindNativePushInviteListeners() {
  if (pushInviteListenersBound || typeof window === 'undefined') return;
  pushInviteListenersBound = true;
  window.addEventListener('push:action', (event) => {
    const data = pushInviteData(event.detail);
    if (data?.type === 'game_invite' && data.roomCode) {
      handleRoomInvite({ roomCode: data.roomCode, password: data.password || '', fromNickname: data.fromNickname }, { autoJoin: true });
    }
  });
  window.addEventListener('push:foreground', (event) => {
    const data = pushInviteData(event.detail);
    if (data?.type === 'game_invite' && data.roomCode) {
      handleRoomInvite({ roomCode: data.roomCode, password: data.password || '', fromNickname: data.fromNickname }, { prompt: false });
    }
  });
}

function bindGlobalSocketListeners(s) {
  if (socketListenersBound || !s) return;
  socketListenersBound = true;
  s.on('achievement:unlock', (data) => {
    const popups = Array.isArray(data?.popups) ? data.popups : [data];
    showAchievement(popups);
  });
  s.on('gift:received', (gift) => {
    showEvent({
      title: 'Gift received!',
      message: `${gift.fromName || 'A friend'} sent you ${gift.summary || 'a gift'}`,
      icon: '🎁',
    });
  });
  s.on('tournament:event', (ev) => {
    showEvent({ title: ev.title || 'Tournament', message: ev.message || '', icon: '🏆' });
  });
  s.on('room:invite', (inv) => handleRoomInvite(inv));
}

const LIVE_RERENDER_ROUTES = new Set([
  'home',
  'leaderboard',
  'achievements',
  'inventory',
  'stickers',
  'tournaments',
  'donations',
  'friends',
]);
const HEARTBEAT_RERENDER_ROUTES = new Set(['home', 'leaderboard', 'tournaments']);
let liveRerenderTimer = null;
let lastHeartbeatRenderAt = 0;
let lastLiveRouteRenderAt = 0;

function hasActiveUserSurface() {
  const active = document.activeElement;
  const isTyping = active && (
    active.tagName === 'INPUT'
    || active.tagName === 'TEXTAREA'
    || active.tagName === 'SELECT'
    || active.isContentEditable
  );
  if (isTyping) return true;
  return Boolean(document.querySelector('.modal-bg,.support-panel.open,.chat-panel,.sticker-picker,.game-sticker-sheet'));
}

function rerenderLiveRoute(reason, options = {}) {
  const route = currentRoute().name;
  const allowed = options.heartbeat ? HEARTBEAT_RERENDER_ROUTES : LIVE_RERENDER_ROUTES;
  if (!allowed.has(route)) return;
  if (!options.heartbeat && hasActiveUserSurface()) return;
  if (route === 'home') invalidateHomePanelCache();
  if (options.heartbeat) {
    const now = Date.now();
    if (now - lastHeartbeatRenderAt < 18000) return;
    lastHeartbeatRenderAt = now;
  } else {
    const now = Date.now();
    if (now - lastLiveRouteRenderAt < 3500) return;
    lastLiveRouteRenderAt = now;
  }
  clearTimeout(liveRerenderTimer);
  liveRerenderTimer = setTimeout(() => {
    if (currentRoute().name === route && !hasActiveUserSurface()) mount();
  }, reason === 'game-end' || reason === 'server-dirty' ? 80 : 220);
}

async function boot() {
  showRoyalLoader({
    source: 'boot',
    variant: 'boot',
    title: 'DURAK IMPERIA',
    subtitle: 'VOICE. STRATEGY. VICTORY.',
    status: 'Kirish tayyorlanmoqda',
    progress: 10,
    items: ['VOICE CHAT', 'ONLINE', 'SECURE'],
  });
  initTelegramWebApp();
  captureReferral();
  bindNativePushInviteListeners();
  updateRoyalLoader({ progress: 22, status: 'Til va interfeys sozlanmoqda' });
  await initI18n();
  updateRoyalLoader({ progress: 42, status: 'Akkaunt tekshirilmoqda' });
  if (!getToken()) {
    if (shouldAutoGuest()) {
      try { await enterAsGuest(); }
      catch (_) { /* fall through to login page if guest creation fails */ }
    }
  } else {
    try { state.user = await api.me(); }
    catch (_) {
      clearToken();
      if (shouldAutoGuest()) {
        try { await enterAsGuest(); }
        catch (_) { /* fall through to login page if guest creation fails */ }
      }
    }
  }
  updateRoyalLoader({ progress: 68, status: 'Royal stol va menyu tayyorlanmoqda' });

  // Optional: wire Capacitor native shell. The bridge is a no-op on web.
  try {
    const { native, configureNativeShell, initPush } = await import('./native/capacitor-bridge.js');
    if (native.isNative()) {
      await configureNativeShell();
      await initPush(async (fcmToken) => {
        try { await api.post('/auth/me/fcm-token', { token: fcmToken }); } catch (_) { /* ignore */ }
      });
    }
  } catch (_) { /* native bridge not present on web build */ }

  initRuntimeSettings(() => state.user);
  initSupportWidget();
  updateRoyalLoader({ progress: 86, status: 'Sahifa ochilmoqda' });
  mount(document.getElementById('app'));
  refreshSupportWidget();

  // Open the socket as soon as we have a token so the achievement inbox
  // is drained even before the user opens a game-related page.
  try {
    const s = await ensureSocket();
    bindGlobalSocketListeners(s);
    s.emit('achievement:pull');
  } catch (_) { /* socket optional on the login page */ }

  startLiveSync({
    onChange: ({ reason }) => rerenderLiveRoute(reason),
    onHeartbeat: ({ reason }) => rerenderLiveRoute(reason, { heartbeat: true }),
  });
  completeRoyalLoader('READY TO PLAY', 760, 'boot');
}

boot();
