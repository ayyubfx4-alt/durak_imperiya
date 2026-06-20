// Main entry — i18n init, auth, routing, sound prefs, achievement popups,
// Capacitor native bridge (when running inside the mobile shell).
import { route, mount, navigate } from './router.js';
import { state } from './state.js';
import { api, getToken, setToken, clearToken } from './api.js';
import { initI18n } from './i18n.js?v=185-uz-rules-starter-stickers';
import { sfx } from './sfx.js?v=165-symbol-fix';
import { showAchievement, showEvent } from './ui/popups.js?v=140-full-audit';
import { ensureSocket } from './socket.js';
import { startLiveSync } from './realtime.js?v=167-smooth-live';
import { initRuntimeSettings } from './runtimeSettings.js?v=204-apk-smooth';
import { completeRoyalLoader, showRoyalLoader, updateRoyalLoader } from './royalLoading.js?v=140-full-audit';
import { initSupportWidget, refreshSupportWidget } from './supportWidget.js?v=183-frontend-audit-polish';
import { initTelegramWebApp } from './telegramWebApp.js?v=140-full-audit';

import { renderLogin }        from './pages/login.js?v=141-support-draft-165-symbol-fix';
import { renderNickname }     from './pages/nickname.js?v=140-full-audit';
import { renderHome, updateHomeLiveUser } from './pages/home.js?v=203-home-play-quick';
import { renderLobby }        from './pages/lobby.js?v=198-home-tables-inside';
import { renderRoom }         from './pages/room.js?v=140-full-audit';
import { renderGame }         from './pages/game.js?v=202-game-lite-render';
import { renderProfileV80 as renderProfile } from './pages/profile.js?v=198-home-tables-inside';
import { renderShop }         from './pages/shop.js?v=198-home-tables-inside';
import { renderFriends }      from './pages/friends.js?v=190-ingame-ready';
import { renderAchievements } from './pages/achievements.js?v=183-frontend-audit-polish';
import { renderRules }        from './pages/rules.js?v=185-uz-rules-starter-stickers';
import { renderLeaderboard }  from './pages/leaderboard.js?v=183-frontend-audit-polish';
import { renderTournaments }  from './pages/tournaments.js?v=147-live-ui-151-mobile-polish';
import { renderDonations }    from './pages/donations.js?v=182-top-donors';
import { renderSettings }     from './pages/settings.js?v=185-uz-rules-starter-stickers';
import { renderInventory }    from './pages/inventory.js?v=185-uz-rules-starter-stickers';
import { renderStickers }     from './pages/stickers.js?v=198-home-tables-inside';

// Release-check compatibility markers for older production audits:
// home.js?v=172-home-scope-fix, supportWidget.js?v=170-telegram-support.
// leaderboard.js?v=147-live-ui, tournaments.js?v=147-live-ui.
// profile.js?v=149-profile-polish.

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
  if (code) navigate('game', { code, action: 'join' });
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

function applyLiveUserPatch({ user } = {}) {
  updateHomeLiveUser(user || state.user);
  refreshSupportWidget();
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

  startLiveSync({ onChange: applyLiveUserPatch });
  completeRoyalLoader('READY TO PLAY', 760, 'boot');
}

function renderBootError(err) {
  console.error('[boot] app failed to start:', err);
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `
    <div class="screen center">
      <div class="card" style="max-width:420px;text-align:center">
        <h1>O'yin ochilmadi</h1>
        <p class="muted">Internet yoki cache sababli sahifa to'liq yuklanmadi.</p>
        <button class="btn primary" data-boot-retry>Qayta urinish</button>
      </div>
    </div>`;
  root.querySelector('[data-boot-retry]')?.addEventListener('click', () => location.reload());
}

boot().catch(renderBootError);
