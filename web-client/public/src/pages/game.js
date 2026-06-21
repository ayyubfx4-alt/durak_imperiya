// Game table — PREMIUM Royal Card Room (rasm 1 ga aniq mos)
// Yangi:
//   - Sound effects (deal/throw/beat/take/win/lose)
//   - Karta animatsiyalari (deal, throw, beat)
//   - Premium turn indicator + glow
//   - Highlight (qaysi karta urish mumkin)
//   - Premium victory/defeat modals
import { h } from '../ui.js';
import { api } from '../api.js';
import { connectSocket, emitWithAck } from '../socket.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { renderCard, SUIT_GLYPH, SUIT_RED, avatarColorFor, flagEmoji } from '../cards.js?v=160-curated-card-skins';
import { t } from '../i18n.js';
import { sfx } from '../sfx.js?v=164-i18n-audio';
import { initAI, askAI, isLimitReached, remainingToday } from '../services/aiChat.js?v=44-ai-tournament-rank';
import { pref, prefValue, vibrate } from '../preferences.js?v=164-i18n-audio';
import { completeRoyalLoader, hideRoyalLoader, showRoyalLoader, updateRoyalLoader } from '../royalLoading.js?v=129-royal-loader-clean';

const OPP_POS = {
  1: ['top-c'],
  2: ['top-l', 'top-r'],
  3: ['top-l', 'top-c', 'top-r'],
  4: ['top-l', 'top-lc', 'top-rc', 'top-r'],
  5: ['top-l', 'top-lc', 'top-c', 'top-rc', 'top-r'],
};

const PERKS = [
  { id: 'peek_opponents', label: 'Qo\'llarni ko\'r', icon: '👁', cost: 3 },
  { id: 'peek_next_card', label: 'Keyingi karta', icon: '🃏', cost: 1 },
];

const REPORT_REASONS = () => [
  { id: 'cheating', label: tSafe('game.report_reason_cheating', 'Firibgarlik') },
  { id: 'abuse',    label: tSafe('game.report_reason_abuse', 'Haqorat') },
  { id: 'spam',     label: tSafe('game.report_reason_spam', 'Spam') },
  { id: 'other',    label: tSafe('game.report_reason_other', 'Boshqa') },
];
const DEFAULT_TURN_SECONDS = 30;
const CARD_THROW_COMMIT_MS = 30;  // animatsiya boshlanib server ack ga ulgurish uchun yetarli
const VOICE_REQUEST_TIMEOUT_MS = 30_000;
const VOICE_CONNECT_TIMEOUT_MS = 20_000;
const VOICE_DISCONNECT_GRACE_MS = 10_000;
// Speech bubble matnlari i18n orqali — til o'zgarganda avtomatik ishlaydi
const SPEECH_KEYS = { take: 'game.speech_take', pass: 'game.speech_pass', defense: 'game.speech_defense', defended: 'game.speech_defended', attack: 'game.speech_attack' };
const SPEECH_FALLBACK = { take: 'I take', pass: 'Pass', defense: 'Done', defended: 'Done', attack: 'Done' };
const CONFETTI_SYMBOLS = ['🎉','⭐','✨','🏆','💫','🎊','🎯','💎'];
const TIMER_CIRCUMFERENCE = 88;
const STICKER_BUBBLE_MS = 3000;
const STICKER_OVERLAY_MS = 2800;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STARTER_STICKER_PACK = {
  id: 'pack_starter',
  name: 'STARTER',
  tag: 'BEPUL',
  rarity: 'common',
  priceGold: 0,
  owned: 1,
  themeColor: '#fbbf24',
  panelColor: 'rgba(35,24,8,.68)',
  stickers: Array.from({ length: 8 }, (_, i) => ({
    id: `pack_starter_${i + 1}`,
    name: `STARTER #${i + 1}`,
    img: `/stickers/pack_starter/${i + 1}.svg`,
  })),
};
const BASE_EMOJI_ITEMS = ['😀','😂','🤔','😎','😡','🥳','👍','👎','❤️','🔥','💯','🎉','🎴','♠','♥','♦','♣','🏆'];

function voiceIceServers() {
  const fallback = [{ urls: 'stun:stun.l.google.com:19302' }];
  const raw = window.__DURAK_ICE_SERVERS__;
  if (!raw) return fallback;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function tSafe(key, fallback, vars = {}) {
  let value = t(key);
  const text = String(value || '');
  if (!text || text === key || text.toLowerCase() === key.toLowerCase() || /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(text)) value = fallback;
  return String(value).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

function withStarterStickerPack(packs = []) {
  const byId = new Map([[STARTER_STICKER_PACK.id, { ...STARTER_STICKER_PACK }]]);
  for (const pack of packs || []) {
    if (!pack?.id) continue;
    const previous = byId.get(pack.id) || {};
    byId.set(pack.id, {
      ...previous,
      ...pack,
      owned: Math.max(Number(previous.owned || 0), Number(pack.owned || 0), Number(pack.priceGold || 0) === 0 ? 1 : 0),
      stickers: Array.isArray(pack.stickers) && pack.stickers.length ? pack.stickers : previous.stickers,
    });
  }
  return Array.from(byId.values());
}

function emojiText(item = {}, fallback = '😀') {
  return String(item.glyph || item.value || item.label || item.name || fallback);
}

function ownedEmojiItemsFromGrouped(payload) {
  const sections = Array.isArray(payload?.emoji) ? payload.emoji : [];
  const out = [];
  const seen = new Set(BASE_EMOJI_ITEMS);
  for (const section of sections) {
    const ownedIds = new Set((section.owned || []).map((item) => String(item.emojiId || item.id || '')));
    const packEmoji = Array.isArray(section.emoji) ? section.emoji : [];
    const source = packEmoji.length
      ? packEmoji.filter((item) => !ownedIds.size || ownedIds.has(String(item.id)))
      : (Array.isArray(section.preview) ? section.preview : []);
    for (const item of source.slice(0, 30)) {
      const label = emojiText(item, section.icon || section.name || '😀');
      const key = `${section.packId}:${item.id || label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        label,
        title: item.name || item.label || section.name || label,
        img: item.img || item.imageUrl || '',
      });
    }
    if (!source.length && section.icon) {
      const key = `${section.packId}:icon`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ label: section.icon, title: section.name || section.icon });
      }
    }
  }
  return out;
}

function applyFanLayout(handEl, opts = {}) {
  const cards = Array.from(handEl.querySelectorAll('.card'));
  const n = cards.length;
  if (n === 0) return;
  const lite = Boolean(opts.lite || isLowPowerRuntime());
  if (lite) {
    const overlap = n >= 9 ? 34 : n >= 7 ? 28 : 22;
    cards.forEach((card, i) => {
      const angle = n > 1 ? (i - (n - 1) / 2) * 3.2 : 0;
      const lift = Math.abs(angle) * 0.8;
      if (!card.classList.contains('selected') && !card.classList.contains('dragging') && !card.classList.contains('fly-to-table')) {
        card.style.transform = `rotate(${angle}deg) translateY(${lift}px)`;
      }
      card.style.marginLeft = i === 0 ? '0' : `-${overlap}px`;
      card.style.zIndex = String(i);
    });
    return;
  }
  const handWidth = handEl.getBoundingClientRect?.().width || window.innerWidth || 360;
  const cardWidth = cards[0]?.getBoundingClientRect?.().width || 76;
  const maxSpread = n > 1
    ? Math.max(40, Math.min(cardWidth - 12, (handWidth - cardWidth - 12) / (n - 1)))
    : cardWidth;
  const fanOverlap = Math.round(Math.max(0, cardWidth - maxSpread));
  cards.forEach((card, i) => {
    const angle = (i - (n - 1) / 2) * 5.5;
    const lift = Math.abs(angle) * 1.6;
    if (!card.classList.contains('selected') && !card.classList.contains('dealing') && !card.classList.contains('dragging') && !card.classList.contains('fly-to-table')) {
      card.style.transform = `rotate(${angle}deg) translateY(${lift}px)`;
    }
    card.style.marginLeft = i === 0 ? '0' : `-${fanOverlap}px`;
    card.style.zIndex = String(i);
  });
}

function turnTotalSeconds(view) {
  return Math.max(1, Math.round((view?.turnDurationMs || DEFAULT_TURN_SECONDS * 1000) / 1000));
}

function makeTimerRing(remainingSec, totalSec = DEFAULT_TURN_SECONDS) {
  const fraction = Math.max(0, Math.min(1, remainingSec / totalSec));
  const offset = TIMER_CIRCUMFERENCE * (1 - fraction);
  const urgent = remainingSec <= 5;
  const wrap = h('div', { class: 'turn-timer' });
  wrap.innerHTML = `
    <svg width="40" height="40" viewBox="0 0 32 32">
      <circle class="timer-track" cx="16" cy="16" r="14"></circle>
      <circle class="timer-fill ${urgent ? 'urgent' : ''}" cx="16" cy="16" r="14" style="stroke-dashoffset:${offset}"></circle>
    </svg>
    <div class="timer-text">${Math.max(0, Math.ceil(remainingSec))}</div>`;
  return wrap;
}

function currentTurnPlayer(view) {
  if (!view || view.phase === 'ended') return null;
  const idx = view.phase === 'defending' ? view.defenderIdx : view.attackerIdx;
  return view.players?.[idx] || null;
}

function formatGameMoney(amount = 0) {
  const n = Number(amount || 0);
  return n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n);
}

function isLowPowerRuntime() {
  const cores = Number(navigator.hardwareConcurrency || 8);
  const memory = Number(navigator.deviceMemory || 4);
  const reduceMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  return reduceMotion || cores <= 4 || memory <= 2;
}

function dropWinnerConfetti() {
  const container = document.body;
  const lite = isLowPowerRuntime();
  const count = lite ? 8 : 24;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'fall-emoji';
    el.textContent = CONFETTI_SYMBOLS[Math.floor(Math.random() * CONFETTI_SYMBOLS.length)];
    el.style.left = `${Math.random() * 100}%`;
    el.style.fontSize = `${(lite ? 20 : 24) + Math.random() * (lite ? 12 : 24)}px`;
    el.style.animationDuration = `${(lite ? 1.2 : 1.6) + Math.random() * (lite ? 0.5 : 1.2)}s`;
    el.style.animationDelay = `${Math.random() * (lite ? 0.25 : 0.9)}s`;
    container.appendChild(el);
    setTimeout(() => el.remove(), lite ? 2400 : 4000);
  }
}

function highlightableCards(_view, _me) {
  return new Set();
}

function canAttemptCardPlay(view, me) {
  if (!view || !me || view.phase === 'ended') return false;
  const isDefender = view.phase === 'defending' && view.players?.[view.defenderIdx]?.id === me.id;
  const isAttacker = view.phase === 'attacking' && (
    view.players?.[view.attackerIdx]?.id === me.id ||
    (view.throwInMode === 'all' && view.players?.[view.defenderIdx]?.id !== me.id)
  );
  return isDefender || isAttacker;
}

function displayGameName(player) {
  const flag = flagEmoji(player?.country_code);
  let name = player?.nickname ? `@${player.nickname}` : (player?.username || '');
  if (String(player?.id || '').startsWith('bot-')) {
    name = DEMO_BOT_NAMES[hashString(player.id || player.username) % DEMO_BOT_NAMES.length] || name;
  }
  return flag ? `${flag} ${name}` : name;
}

const DEMO_BOT_NAMES = [
  'Andre', 'Elena', 'Marco', 'Sophie', 'Lucas', 'Mila', 'Daniel', 'Emma',
  'Oliver', 'Nora', 'Victor', 'Amelia', 'Max', 'Eva', 'Leo', 'Anna',
  'Henry', 'Luna', 'Oscar', 'Chloe', 'Mason', 'Iris', 'Theo', 'Grace',
];

const DEMO_AVATAR_PALETTES = [
  ['#4f46e5', '#dbeafe', '#111827'],
  ['#16a34a', '#dcfce7', '#3b2414'],
  ['#b45309', '#fff7ed', '#1f2937'],
  ['#be123c', '#ffe4e6', '#0f172a'],
  ['#0891b2', '#cffafe', '#3f2d1b'],
  ['#7c3aed', '#ede9fe', '#111827'],
  ['#475569', '#e2e8f0', '#2f1f16'],
  ['#ca8a04', '#fef9c3', '#1f2937'],
];

function hashString(value = '') {
  let hash = 0;
  const text = String(value || 'player');
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function makeAvatarFace(player = {}) {
  const seed = hashString(player.id || player.username || player.nickname || 'player');
  const palette = DEMO_AVATAR_PALETTES[seed % DEMO_AVATAR_PALETTES.length];
  return h('span', {
    class: `demo-avatar-face face-${seed % 6}`,
    style: {
      '--avatar-bg': palette[0],
      '--avatar-skin': palette[1],
      '--avatar-hair': palette[2],
    },
  }, [
    h('i', { class: 'face-hair' }, []),
    h('b', { class: 'face-eyes' }, []),
    h('em', { class: 'face-smile' }, []),
  ]);
}

function gameAvatarSrc(player = {}) {
  return player?.avatar_url || player?.avatarUrl || player?.photo_url || player?.picture || '';
}

function renderPlayerAvatar(player = {}, { size = 'md', mine = false, title = '', onclick = null, dataPlayer = true } = {}) {
  const src = gameAvatarSrc(player);
  const avatar = h('div', {
    class: `avatar ${size} demo-avatar color-${avatarColorFor(player?.id || player?.username || 'player')}${mine ? ' mine' : ''}`,
    style: 'position:relative',
    title,
    onclick,
    'data-player-id': dataPlayer ? (player?.id || '') : undefined,
  }, [
    src
      ? h('img', {
        src,
        alt: displayGameName(player) || 'avatar',
        loading: 'lazy',
        decoding: 'async',
        draggable: false,
        onerror: (e) => {
          const parent = e.currentTarget.parentElement;
          e.currentTarget.remove();
          parent?.appendChild(makeAvatarFace(player));
        },
      })
      : makeAvatarFace(player),
  ]);
  return avatar;
}

function cardWireId(card) {
  if (!card) return '';
  return `${card.rank}${card.suit}`;
}

export async function renderGame(root, params) {
  const code = params.code || state.currentRoom?.code;
  root.innerHTML = '';
  const cachedLoaderView = state.game && (!code || state.game.code === code || state.game.roomCode === code)
    ? state.game
    : null;
  const myName = state.user?.nickname || state.user?.username || (state.user?.email ? String(state.user.email).split('@')[0] : '') || 'SIZ';
  const opponent = cachedLoaderView?.players?.find((p) => p.id !== state.user?.id);
  const opponentName = opponent?.nickname || opponent?.username || 'RAQIB';
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const mobileViewport = Math.min(window.innerWidth || 360, window.innerHeight || 640) <= 600;
  const cpuCores = Number(navigator.hardwareConcurrency || (mobileViewport ? 4 : 8));
  const deviceMemory = Number(navigator.deviceMemory || (mobileViewport ? 2 : 4));
  const lowEndDevice = mobileViewport || cpuCores <= 4 || deviceMemory <= 2 || cpuCores <= 6;
  const nativeWebView = Boolean(
    window.Capacitor || window.CapacitorPlugins || window.cordova ||
    window.__DURAK_PERF_LITE__ || window.__capacitor_app__ ||
    /wv|WebView/i.test(navigator.userAgent)
  );
  const forceDisableBlur = Boolean(window.__DURAK_DISABLE_BLUR__ || nativeWebView);
  const maxNativeFps = Number(window.__DURAK_MAX_FPS__ || (nativeWebView ? 15 : 60));
  const wrap = h('div', {
    class: `screen game-screen royal-table-screen perf-smooth ${reduceMotion || lowEndDevice || nativeWebView ? 'perf-lite' : ''}`,
  });
  document.documentElement.classList.add('game-perf-mode');
  root.appendChild(wrap);
  showRoyalLoader({
    source: 'game',
    variant: 'duel',
    title: '1 VS 1',
    subtitle: 'Battle loading',
    status: 'Xona, voice va kartalar tayyorlanmoqda',
    progress: 68,
    items: ['VOICE', 'STICKER', 'GOLD'],
    players: [myName, opponentName],
  });

  let socket;
  try {
    socket = connectSocket();
  } catch (err) {
    hideRoyalLoader('game');
    wrap.appendChild(renderGameError(err.message || 'Server bilan aloqa ochilmadi'));
    return () => {};
  }

  api.me().then((fresh) => applyFreshUser(fresh, { rerenderOnSkinChange: true })).catch(() => {});

  let view = cachedLoaderView;
  let lobbyRoom = null;
  if (!code && !view) {
    hideRoyalLoader('game');
    wrap.appendChild(renderGameError(tSafe('game.missing_code', 'O\'yin kodi topilmadi. Stollar bo\'limidan qayta kiring.')));
    return () => {};
  }
  let selectedCard = null;
  let joinPassword = '';
  try {
    const pendingCode = String(sessionStorage.getItem('pending_room') || '').trim().toUpperCase();
    if (pendingCode && pendingCode === String(code || '').trim().toUpperCase()) {
      joinPassword = sessionStorage.getItem('pending_room_password') || '';
      sessionStorage.removeItem('pending_room');
      sessionStorage.removeItem('pending_room_password');
    }
  } catch (_) { /* ignore */ }
  let chatOpen = false;
  let stickerOpen = false;
  let reactionsOpen = false;
  let reactionsTab = 'emoji';
  const chatLog = [];
  let ownedEmojiCache = null;
  let loadingOwnedEmoji = false;
  let ownedEmojiError = '';
  let stickerInventoryCache = null;
  let stickerInventoryCacheAt = 0;
  let stickerInventoryLoading = false;
  let stickerInventoryError = '';
  const liveChat = [];
  let liveChatSeq = 0;
  const liveChatTimers = new Set();
  const speechByPlayer = {};
  const typingByPlayer = {};
  const stickerByPlayer = {};
  let lastStickerOverlayKey = '';
  let lastStickerOverlayAt = 0;
  let commandPanelOpen = false;
  let dealingHand = false;
  let confettiShown = false;
  let timerInterval = null;
  let pregameReadyDeadline = 0;
  let pregameReadyTimer = null;
  let pregameReadyTicker = null;
  let pregameReadyKey = '';
  let loadingWatchdog = null;
  let lastTableSize = 0;
  let warnedTimeout = false;
  let timeoutPoked = false;
  let playingCard = false;
  let renderFrame = null;
  let renderTimer = null;
  let lastRenderAt = 0;
  let gameLoaderDone = false;
  let readyChanging = false;
  let onRuntimePrefChange = null;
  let timerNodeCache = [];
  let timerCacheAt = 0;
  let lastTapCardId = null;
  let lastTapAt = 0;
  _aiContextProvider = () => buildAIContext(view, state.user);

  // ── Feature 30: Ovozli Chat (Voice Chat) state ────────────────────────────
  let voiceState = 'idle'; // idle | requesting | active
  let voicePeer = null;    // RTCPeerConnection
  let localStream = null;  // getUserMedia stream
  let pendingVoiceIce = [];
  let voiceRequestTimer = null;
  let voiceConnectTimer = null;
  let voiceDisconnectTimer = null;
  let actionConfirmModal = null;

  function clearVoiceTimers() {
    if (voiceRequestTimer) clearTimeout(voiceRequestTimer);
    if (voiceConnectTimer) clearTimeout(voiceConnectTimer);
    if (voiceDisconnectTimer) clearTimeout(voiceDisconnectTimer);
    voiceRequestTimer = null;
    voiceConnectTimer = null;
    voiceDisconnectTimer = null;
  }

  function removeVoiceRequestModal() {
    const existing = document.getElementById('voice-request-modal');
    if (existing) existing.remove();
  }

  function removeVoiceAudio() {
    const el = document.getElementById('voice-remote-audio');
    if (el) {
      try { el.srcObject = null; } catch (_) {}
      el.remove();
    }
  }

  function stopVoice({ emitEnd = false, notify = false, message = 'Ovozli chat tugatildi' } = {}) {
    const hadVoice = voiceState !== 'idle'
      || !!voicePeer
      || !!localStream
      || pendingVoiceIce.length > 0
      || !!document.getElementById('voice-request-modal');
    clearVoiceTimers();
    removeVoiceRequestModal();
    removeVoiceAudio();
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (voicePeer) {
      const pc = voicePeer;
      voicePeer = null;
      try {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
      } catch (_) {}
    }
    pendingVoiceIce = [];
    voiceState = 'idle';
    if (emitEnd && hadVoice) socket.emit('voice:end', { code, reason: 'client-cleanup' });
    if (notify && hadVoice) toast(message, 'info');
    scheduleRender();
  }

  async function flushPendingVoiceIce() {
    if (!voicePeer || !voicePeer.remoteDescription) return;
    const queue = pendingVoiceIce;
    pendingVoiceIce = [];
    for (const candidate of queue) {
      try { await voicePeer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
    }
  }

  function watchVoiceConnection(pc) {
    const check = () => {
      if (pc !== voicePeer) return;
      const stateNow = pc.connectionState || pc.iceConnectionState || '';
      const iceNow = pc.iceConnectionState || '';
      if (stateNow === 'connected' || stateNow === 'completed' || iceNow === 'connected' || iceNow === 'completed') {
        if (voiceConnectTimer) clearTimeout(voiceConnectTimer);
        if (voiceDisconnectTimer) clearTimeout(voiceDisconnectTimer);
        voiceConnectTimer = null;
        voiceDisconnectTimer = null;
        return;
      }
      if (stateNow === 'failed' || iceNow === 'failed') {
        toast('Ovozli ulanish uzildi', 'error');
        stopVoice({ emitEnd: true });
        return;
      }
      if ((stateNow === 'disconnected' || iceNow === 'disconnected') && !voiceDisconnectTimer) {
        voiceDisconnectTimer = setTimeout(() => {
          voiceDisconnectTimer = null;
          if (pc === voicePeer && (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected')) {
            toast('Ovozli ulanish qayta tiklanmadi', 'error');
            stopVoice({ emitEnd: true });
          }
        }, VOICE_DISCONNECT_GRACE_MS);
      }
    };
    pc.onconnectionstatechange = check;
    pc.oniceconnectionstatechange = check;
  }

  async function startVoiceCall(initiator) {
    try {
      clearVoiceTimers();
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const pc = new RTCPeerConnection({ iceServers: voiceIceServers() });
      voicePeer = pc;
      voiceState = 'active';
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      pc.ontrack = (e) => {
        const audio = document.getElementById('voice-remote-audio') || document.createElement('audio');
        audio.id = 'voice-remote-audio';
        audio.autoplay = true;
        audio.playsInline = true;
        audio.srcObject = e.streams[0];
        sfx.applyVoiceAudio?.(audio);
        document.body.appendChild(audio);
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('voice:ice', { code, candidate: e.candidate });
      };
      watchVoiceConnection(pc);
      voiceConnectTimer = setTimeout(() => {
        if (pc === voicePeer && pc.connectionState !== 'connected' && pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
          toast('Ovozli ulanish ochilmadi. Internet yoki TURN sozlamasini tekshiring.', 'error');
          stopVoice({ emitEnd: true });
        }
      }, VOICE_CONNECT_TIMEOUT_MS);
      if (initiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice:offer', { code, offer });
      }
      scheduleRender();
    } catch (err) {
      const message = err?.name === 'NotAllowedError'
        ? 'Mikrofon ruxsati berilmadi'
        : 'Ovozli chat ochilmadi';
      toast(message, 'error');
      stopVoice({ emitEnd: true });
    }
  }

  function scheduleRender({ immediate = false } = {}) {
    if (renderFrame || renderTimer) return;
    const now = performance.now ? performance.now() : Date.now();
    const minDelay = frameDelayMs();
    const delay = immediate
      ? Math.max(0, Math.min(12, minDelay - (now - lastRenderAt)))
      : Math.max(0, minDelay - (now - lastRenderAt));
    if (delay > 0) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        scheduleRender({ immediate: true });
      }, delay);
      return;
    }
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      lastRenderAt = performance.now ? performance.now() : Date.now();
      timerNodeCache = [];
      timerCacheAt = 0;
      render();
    });
  }

  function frameDelayMs() {
    const fpsLimit = Number(prefValue('pref_fps_limit', state.user));
    const preferred = [30, 60, 90, 120].includes(fpsLimit) ? fpsLimit : 60;
    const maxDomFps = nativeWebView ? Math.min(maxNativeFps, 15) : lowEndDevice ? 18 : 45;
    const fps = Math.min(preferred, maxDomFps);
    return Math.max(8, Math.round(1000 / fps));
  }


  function syncGamePerformanceFlags() {
    const graphics = String(prefValue('pref_graphics_quality', state.user) || 'high');
    const fpsLimit = Number(prefValue('pref_fps_limit', state.user) || 60);
    wrap.dataset.graphicsQuality = graphics;
    wrap.dataset.fpsLimit = String(fpsLimit);
    wrap.classList.toggle('perf-lite', reduceMotion || lowEndDevice || nativeWebView || graphics === 'low' || fpsLimit === 30);
  }

  function finishGameLoader(status = 'O\'yin boshlandi') {
    if (gameLoaderDone) return;
    gameLoaderDone = true;
    completeRoyalLoader(status, wrap.classList.contains('perf-lite') ? 180 : 520, 'game');
  }

  onRuntimePrefChange = (event) => {
    const key = event?.detail?.key || '';
    if (!key || !String(key).startsWith('pref_')) return;
    syncGamePerformanceFlags();
    scheduleRender({ immediate: true });
  };
  syncGamePerformanceFlags();
  window.addEventListener('imperia:pref-change', onRuntimePrefChange);

  function selectorId(id) {
    return String(id || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function selectedCardText(card) {
    return card ? `${card.rank === 'T' ? '10' : card.rank}${SUIT_GLYPH[card.suit] || ''}` : '';
  }

  function updatePrimaryActionDom(primary, stateInfo) {
    if (!primary || !stateInfo) return;
    primary.className = `demo-primary-action ${stateInfo.key}${stateInfo.enabled ? '' : ' disabled'}`;
    primary.disabled = !stateInfo.enabled;
    primary.onclick = stateInfo.onclick;
    const label = primary.querySelector('strong');
    if (label) label.textContent = stateInfo.label;
    let sub = primary.querySelector('small');
    if (stateInfo.sub) {
      if (!sub) {
        sub = document.createElement('small');
        primary.appendChild(sub);
      }
      sub.textContent = stateInfo.sub;
    } else if (sub) {
      sub.remove();
    }
  }

  function primaryActionState(me) {
    if (!view || view.phase === 'ended') return null;
    const canPlay = Boolean(selectedCard && canAttemptCardPlay(view, me));
    const canTake = isMyTurnDefender(me);
    const canPass = isMyTurnAttacker(me) && view.table.length > 0;
    const activePlayer = currentTurnPlayer(view);
    if (canPlay) {
      return {
        key: 'done',
        label: 'Tashlash',
        sub: selectedCardText(selectedCard),
        enabled: true,
        onclick: () => playCard(selectedCard),
      };
    }
    if (canTake) {
      return {
        key: 'take',
        label: 'Olish',
        sub: 'Olish',
        enabled: true,
        onclick: () => { sfx.play('take'); vibrate(18); emitAction('take'); },
      };
    }
    if (canPass) {
      return {
        key: 'pass',
        label: "O'tkazish",
        sub: 'Tugadi',
        enabled: true,
        onclick: () => emitAction('pass'),
      };
    }
    if (isMyTurnAttacker(me) || isMyTurnDefender(me)) {
      return {
        key: 'turn',
        label: 'Sizning navbat',
        sub: 'Karta tanlang',
        enabled: false,
        onclick: () => toast(tSafe('game.select_card_first', 'Avval yuradigan kartani tanlang'), 'info'),
      };
    }
    return {
      key: 'waiting',
      label: 'Kutilmoqda',
      sub: activePlayer ? displayGameName(activePlayer) : '',
      enabled: false,
      onclick: () => toast(tSafe('game.not_your_turn', 'Sizning navbatingiz emas'), 'info'),
    };
  }

  function updateSelectedCardDom() {
    if (!view) return false;
    const me = view.players?.find((p) => p.hand);
    const selectedId = cardWireId(selectedCard);
    const handCards = wrap.querySelectorAll('.my-hand .card');
    if (!handCards.length) return false;
    handCards.forEach((el) => {
      el.classList.toggle('selected', Boolean(selectedId && el.dataset.cardId === selectedId));
    });
    const canPlay = Boolean(selectedCard && canAttemptCardPlay(view, me));
    updatePrimaryActionDom(wrap.querySelector('.demo-primary-action'), primaryActionState(me));
    const hit = wrap.querySelector('.royal-table-action.hit');
    if (hit) {
      hit.classList.toggle('disabled', !canPlay);
      hit.onclick = () => canPlay
        ? playCard(selectedCard)
        : toast(tSafe('game.select_card_first', 'Avval yuradigan kartani tanlang'), 'info');
    }
    const bluff = wrap.querySelector('.royal-table-action.bluff');
    if (bluff) {
      const canBluffNow = Boolean(view.bluffEnabled && selectedCard && isMyTurnAttacker(me));
      bluff.classList.toggle('disabled', !canBluffNow);
      bluff.onclick = () => canBluffNow
        ? bluffAttack(selectedCard)
        : toast('Bluff uchun avval kartani tanlang', 'info');
    }
    return true;
  }

  function selectCardFast(card) {
    selectedCard = card;
    if (!updateSelectedCardDom()) scheduleRender({ immediate: true });
  }

  function makeTypingBubble() {
    return h('div', { class: 'typing-bubble dynamic-ephemeral' }, [
      h('span', {}, []), h('span', {}, []), h('span', {}, []),
    ]);
  }

  function makeSpeechBubble(playerId) {
    const kind = speechByPlayer[playerId];
    // i18n kaliti bo'lsa tarjima qilamiz, aks holda emoji/raw string ko'rsatamiz
    const text = SPEECH_KEYS[kind] ? (SPEECH_FALLBACK[kind] || kind || '') : (kind || '');
    const looksLikeEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(String(text || ''));
    return h('div', { class: `speech dynamic-ephemeral${looksLikeEmoji ? ' emoji-speech' : ''}` }, [text]);
  }

  // Sticker bubbles are rendered as fixed-position overlays on document.body
  // so that they are never clipped by any parent overflow:hidden container
  // (including the mobile .royal-table-screen{overflow:hidden}).
  function showFloatingStickerBubble(playerId, hostEl, stickerData) {
    cleanFloatingStickerBubble(playerId);
    if (!stickerData?.img || !hostEl) return;
    const rect = hostEl.getBoundingClientRect();
    const W = 88, H = 88;
    let left = rect.left + rect.width / 2 - W / 2;
    let top = rect.top - H - 8;
    // Clamp so the bubble stays inside the viewport
    left = Math.max(6, Math.min(window.innerWidth - W - 6, left));
    top = Math.max(6, top);
    const el = document.createElement('div');
    el.className = 'player-sticker-float';
    el.setAttribute('data-pid', String(playerId));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    const img = document.createElement('img');
    img.src = stickerData.img;
    img.alt = stickerData.senderName || 'sticker';
    img.loading = 'eager';
    img.draggable = false;
    el.appendChild(img);
    document.body.appendChild(el);
  }
  function cleanFloatingStickerBubble(playerId) {
    const pid = String(playerId);
    document.querySelectorAll('.player-sticker-float').forEach((el) => {
      if (el.getAttribute('data-pid') === pid) el.remove();
    });
  }
  function cleanAllFloatingStickerBubbles() {
    document.querySelectorAll('.player-sticker-float').forEach((el) => el.remove());
  }

  function makeStickerBubble(playerId) {
    // Inline sticker bubbles are no longer used; floating bubbles handle display.
    return null;
  }

  function syncEphemeralFor(playerId) {
    const host = wrap.querySelector(`[data-player-id="${selectorId(playerId)}"]`);
    if (!host) { scheduleRender(); return; }
    host.querySelectorAll('.dynamic-ephemeral').forEach((el) => el.remove());
    if (typingByPlayer[playerId]) host.appendChild(makeTypingBubble());
    if (speechByPlayer[playerId]) host.appendChild(makeSpeechBubble(playerId));
    if (stickerByPlayer[playerId]) {
      showFloatingStickerBubble(playerId, host, stickerByPlayer[playerId]);
    } else {
      cleanFloatingStickerBubble(playerId);
    }
  }

  let perkReveal = null;
  let perkRevealTimer = null;
  function selectedSkinOf(user) {
    return user?.selected_skin || user?.selectedSkin || 'default';
  }
  function applyFreshUser(fresh, { rerenderOnSkinChange = false } = {}) {
    const before = selectedSkinOf(state.user);
    state.user = { ...(state.user || {}), ...(fresh || {}) };
    const after = selectedSkinOf(state.user);
    if (rerenderOnSkinChange && before !== after) scheduleRender({ immediate: true });
  }
  function currentCardSkin() {
    const selected = selectedSkinOf(state.user);
    if (selected && selected !== 'default') return selected;
    if (!pref('pref_card_shirt', state.user)) return 'default';
    return selected || 'default';
  }
  function showPerkReveal(payload) {
    perkReveal = payload;
    if (perkRevealTimer) clearTimeout(perkRevealTimer);
    if (payload?.revealMs) {
      perkRevealTimer = setTimeout(() => { perkReveal = null; scheduleRender(); }, payload.revealMs);
    }
    scheduleRender();
  }

  function pushLiveChat(message) {
    const id = ++liveChatSeq;
    liveChat.push({ ...message, id });
    while (liveChat.length > 4) liveChat.shift();
    const timer = setTimeout(() => {
      const idx = liveChat.findIndex((item) => item.id === id);
      if (idx !== -1) liveChat.splice(idx, 1);
      liveChatTimers.delete(timer);
      refreshLiveChatFeed();
    }, message?.type === 'sticker' || message?.type === 'emoji' ? 3600 : 5200);
    liveChatTimers.add(timer);
    refreshLiveChatFeed();
  }

  function sameRoomCode(room) {
    return String(room?.code || '').trim().toUpperCase() === String(code || '').trim().toUpperCase();
  }

  function stopPregameReadyClock() {
    if (pregameReadyTimer) clearTimeout(pregameReadyTimer);
    if (pregameReadyTicker) clearInterval(pregameReadyTicker);
    pregameReadyTimer = null;
    pregameReadyTicker = null;
    pregameReadyDeadline = 0;
    pregameReadyKey = '';
  }

  function armPregameReadyClock(room, me, cardsSoon = false) {
    if (!room || !me || me.ready || cardsSoon) {
      stopPregameReadyClock();
      return 0;
    }
    const key = `${room.code || code}:${me.id}`;
    if (pregameReadyKey !== key || !pregameReadyDeadline) {
      if (pregameReadyTimer) clearTimeout(pregameReadyTimer);
      if (pregameReadyTicker) clearInterval(pregameReadyTicker);
      pregameReadyKey = key;
      pregameReadyDeadline = Date.now() + 30000;
      pregameReadyTicker = setInterval(() => scheduleRender({ immediate: true }), 1000);
      pregameReadyTimer = setTimeout(() => {
        const seatedMe = (lobbyRoom?.seats || []).find((s) => s?.id === state.user?.id);
        if (seatedMe?.ready) return stopPregameReadyClock();
        toast('Tayyor bosilmadi. Stol avtomatik tark etildi.', 'info');
        leavePregame({ quiet: true });
      }, 30200);
    }
    const left = Math.max(0, Math.ceil((pregameReadyDeadline - Date.now()) / 1000));
    if (left <= 0) {
      toast('Tayyor bosilmadi. Stol avtomatik tark etildi.', 'info');
      leavePregame({ quiet: true });
      return 0;
    }
    return left;
  }

  function setLobbyRoom(room) {
    if (!room || !sameRoomCode(room) || room.phase !== 'lobby') return;
    if (loadingWatchdog) { clearTimeout(loadingWatchdog); loadingWatchdog = null; }
    lobbyRoom = room;
    state.currentRoom = room;
    hideRoyalLoader('game');
    scheduleRender({ immediate: true });
  }

  function roomSeatCount(room) {
    return (room?.seats || []).filter(Boolean).length;
  }

  function leavePregame({ quiet = false } = {}) {
    stopPregameReadyClock();
    socket.emit('room:leave', { code });
    state.currentRoom = null;
    if (!quiet) sfx.play('click');
    navigate('home');
  }

  function toggleReadyFromGame(room, me) {
    if (!room || !me || readyChanging) return;
    const nextReady = !me.ready;
    if (nextReady) stopPregameReadyClock();
    readyChanging = true;
    lobbyRoom = {
      ...room,
      seats: (room.seats || []).map((s) => (s && s.id === me.id ? { ...s, ready: nextReady } : s)),
    };
    socket.emit('room:ready', { code, ready: nextReady });
    sfx.play('click');
    vibrate(nextReady ? 18 : 10);
    scheduleRender({ immediate: true });
    setTimeout(() => {
      readyChanging = false;
      scheduleRender({ immediate: true });
    }, 500);
  }

  // Socket events
  function findEphemeralPlayerId(payload = {}) {
    const direct = payload.playerId || payload.senderId || payload.userId || payload.id;
    if (direct) return direct;
    const name = String(payload.senderName || payload.username || payload.name || '').trim().toLowerCase();
    if (!name) return '';
    const players = [
      ...(view?.players || []),
      ...((lobbyRoom?.seats || []).filter(Boolean)),
    ];
    const found = players.find((p) => {
      const username = String(p?.username || '').toLowerCase();
      const nickname = String(p?.nickname || '').toLowerCase();
      return username === name || nickname === name || `@${nickname}` === name;
    });
    return found?.id || '';
  }

  const onRoomState = (room) => setLobbyRoom(room);
  const onChatMessage = (m) => {
    if (m?.type === 'text') return;
    const playerId = findEphemeralPlayerId(m);
    if (pref('pref_emotions', state.user) && playerId && m?.type === 'emoji') {
      speechByPlayer[playerId] = m.content || m.text || m.emoji || '😀';
      setTimeout(() => { delete speechByPlayer[playerId]; syncEphemeralFor(playerId); }, 1800);
      syncEphemeralFor(playerId);
    }
    chatLog.push(m);
    pushLiveChat(m);
    sfx.play('notification');
  };
  const onGameStart = (gv) => {
    if (loadingWatchdog) { clearTimeout(loadingWatchdog); loadingWatchdog = null; }
    stopPregameReadyClock();
    lobbyRoom = null;
    readyChanging = false;
    view = gv; state.game = gv; dealingHand = true;
    updateRoyalLoader({ source: 'game', progress: 94, status: 'Kartalar tarqatilmoqda' });
    finishGameLoader('DUEL BOSHLANDI');
    lastTableSize = 0;
    timeoutPoked = false;
    sfx.play('shuffle');
    setTimeout(() => sfx.play('deal'), 200);
    scheduleRender();
    setTimeout(() => { dealingHand = false; scheduleRender(); }, wrap.classList.contains('perf-lite') ? 420 : 1400);
  };
  const onGameMove = (gv) => {
    const prevSize = lastTableSize;
    view = gv; state.game = gv;
    timeoutPoked = false;
    if (gv.table.length > prevSize) {
      vibrate(12);
    } else if (gv.table.some(t => t.defense)) {
      // any new defense card
      sfx.play('cardBeat');
      vibrate(16);
    }
    lastTableSize = gv.table.length;
    scheduleRender();
  };
  const onGameTimeout = (gv) => { view = gv; state.game = gv; timeoutPoked = false; sfx.play('warning'); scheduleRender(); };
  const onGameForfeit = (gv) => { view = gv; state.game = gv; sfx.play('warning'); vibrate(24); scheduleRender(); };
  const onSpectatorState = (gv) => {
    view = gv;
    state.game = gv;
    scheduleRender();
  };
  const onGameEnd = (gv) => {
    view = gv; state.game = gv;
    stopVoice();
    const me = view.players.find(p => p.hand);
    const winnerId = view.winnerOrder?.[0];
    const payoutByPlayer = new Map((view.payoutShares || []).map((s) => [s.playerId, Number(s.amount || 0)]));
    const myPayout = me?.id ? Number(payoutByPlayer.get(me.id) || 0) : 0;
    if (myPayout > 0 || (winnerId && me?.id === winnerId)) sfx.play('win');
    else if (view.durakId === me?.id) sfx.play('lose');
    api.me().then((fresh) => applyFreshUser(fresh, { rerenderOnSkinChange: true })).catch(() => {});
    scheduleRender();
  };
  const onPlayerSpeech = ({ playerId, kind }) => {
    speechByPlayer[playerId] = kind;
    setTimeout(() => { delete speechByPlayer[playerId]; syncEphemeralFor(playerId); }, 1500);
    syncEphemeralFor(playerId);
  };
  // PRO v5: Bot "typing" indicator — makes bots indistinguishable from humans.
  const onPlayerTyping = ({ playerId, typing }) => {
    if (typing) typingByPlayer[playerId] = true;
    else delete typingByPlayer[playerId];
    syncEphemeralFor(playerId);
  };
  // PRO v5: Bot emoji reactions overlay
  const onEmojiReact = ({ playerId, emoji }) => {
    if (!pref('pref_emotions', state.user)) return;
    speechByPlayer[playerId] = emoji;
    setTimeout(() => { delete speechByPlayer[playerId]; syncEphemeralFor(playerId); }, 1800);
    syncEphemeralFor(playerId);
  };
  // PRO v5: Sticker show overlay
  const onStickerShow = (payload = {}) => {
    if (!pref('pref_emotions', state.user)) return;
    const payloadRoom = String(payload.roomCode || payload.code || '').trim().toUpperCase();
    const currentRoom = String(code || '').trim().toUpperCase();
    if (payloadRoom && currentRoom && payloadRoom !== currentRoom) return;
    const stickerImg = String(payload.img || '').trim();
    if (!stickerImg) return;
    const playerId = findEphemeralPlayerId(payload);
    if (playerId) {
      stickerByPlayer[playerId] = { img: stickerImg, senderName: payload.senderName };
      setTimeout(() => { delete stickerByPlayer[playerId]; syncEphemeralFor(playerId); }, Number(payload.durationMs || STICKER_BUBBLE_MS) + 800);
      syncEphemeralFor(playerId);
    }
    vibrate(14);
    showStickerOverlay({ ...payload, img: stickerImg });
  };
  const onRoomError = ({ error }) => toast(error || 'Xatolik', 'error');

  // ── Feature 30: Voice Chat socket handlers ────────────────────────────────
  const onVoiceRequest = ({ fromName, timeoutMs }) => {
    removeVoiceRequestModal();
    const bg = document.createElement('div');
    bg.id = 'voice-request-modal';
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="text-align:center;max-width:300px">
        <div style="font-size:2rem;margin-bottom:8px">🎤</div>
        <h3 style="margin:0 0 6px">Ovozli chat so'rovi</h3>
        <p style="color:var(--c-muted);font-size:13px;margin:0 0 16px">${fromName || 'Raqib'} ovozli chat talab qilmoqda</p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button id="voice-decline-btn" class="btn-secondary" style="flex:1">Rad etish</button>
          <button id="voice-accept-btn" class="btn-done" style="flex:1">Qabul qilish</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    document.getElementById('voice-accept-btn').onclick = () => {
      bg.remove();
      socket.emit('voice:accept', { code }, (res) => {
        if (!res?.ok) return toast(res?.error || 'Ovozli chat ochilmadi', 'error');
        voiceState = 'active';
        startVoiceCall(false);
        scheduleRender();
      });
    };
    document.getElementById('voice-decline-btn').onclick = () => {
      bg.remove();
      socket.emit('voice:reject', { code }, () => {});
    };
    const modalTimeout = Math.max(5_000, Math.min(Number(timeoutMs || VOICE_REQUEST_TIMEOUT_MS), VOICE_REQUEST_TIMEOUT_MS));
    setTimeout(() => {
      if (!bg.isConnected) return;
      bg.remove();
      socket.emit('voice:reject', { code }, () => {});
    }, modalTimeout);
  };
  const onVoiceAccept = async () => {
    clearVoiceTimers();
    voiceState = 'active';
    scheduleRender();
    if (!voicePeer) await startVoiceCall(true);
  };
  const onVoiceOffer = async ({ offer }) => {
    try {
      if (!voicePeer) await startVoiceCall(false);
      if (!voicePeer) return;
      await voicePeer.setRemoteDescription(new RTCSessionDescription(offer));
      await flushPendingVoiceIce();
      const answer = await voicePeer.createAnswer();
      await voicePeer.setLocalDescription(answer);
      socket.emit('voice:answer', { code, answer });
    } catch (_) {
      toast('Ovozli ulanish ochilmadi', 'error');
      stopVoice({ emitEnd: true });
    }
  };
  const onVoiceAnswer = async ({ answer }) => {
    if (!voicePeer) return;
    try {
      await voicePeer.setRemoteDescription(new RTCSessionDescription(answer));
      await flushPendingVoiceIce();
    } catch (_) {
      toast('Ovozli ulanish javobi qabul qilinmadi', 'error');
      stopVoice({ emitEnd: true });
    }
  };
  const onVoiceIce = async ({ candidate }) => {
    if (!candidate) return;
    if (!voicePeer || !voicePeer.remoteDescription) {
      pendingVoiceIce.push(candidate);
      return;
    }
    try { await voicePeer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
  };
  const onVoiceReject = () => {
    stopVoice({ notify: true, message: 'Ovozli chat rad etildi' });
  };
  const onVoiceTimeout = () => {
    stopVoice({ notify: true, message: 'Ovozli chat so‘rovi javobsiz qoldi' });
  };
  const onVoiceError = ({ error } = {}) => {
    stopVoice();
    toast(error || 'Ovozli chat xatosi', 'error');
  };
  const onVoiceEnd = ({ reason } = {}) => {
    const message = reason === 'game-ended' ? 'O‘yin tugadi, ovozli chat yopildi' : 'Ovozli chat tugatildi';
    stopVoice({ notify: true, message });
  };

  function actionConfirmText(req = {}) {
    const card = String(req.card || req.payload?.card || '').replace('T', '10');
    const label = req.actionLabel || ({
      attack: 'Karta tashlash',
      defense: 'Kartani urish',
      transfer: "O'tkazish",
      take: 'Karta olish',
    }[req.action] || 'Harakat');
    return card ? `${label}: ${card}` : label;
  }

  function closeActionConfirmModal() {
    if (actionConfirmModal?.isConnected) actionConfirmModal.remove();
    actionConfirmModal = null;
  }

  function showActionConfirmModal(req = {}) {
    closeActionConfirmModal();
    const actorName = req.actorName || 'Raqib';
    const status = h('div', { class: 'muted', style: 'min-height:18px;font-size:12px' }, [
      'Tasdiqlasangiz harakat bajariladi, rad etsangiz navbat davom etadi.',
    ]);
    const answer = async (accept) => {
      status.textContent = accept ? 'Tasdiqlanmoqda...' : 'Rad etilmoqda...';
      const resp = await emitWithAck('game:action_confirm', {
        code,
        requestId: req.id,
        accept,
      }, 5000).catch((e) => ({ ok: false, error: e.message }));
      if (!resp?.ok) {
        status.textContent = resp?.error || 'Tasdiq yuborilmadi';
        return toast(resp?.error || 'Tasdiq yuborilmadi', 'error');
      }
      closeActionConfirmModal();
      toast(accept ? 'Harakat tasdiqlandi' : 'Harakat rad etildi', accept ? 'success' : 'info');
    };
    const card = h('div', { class: 'modal action-confirm-modal', style: 'text-align:center;max-width:340px' }, [
      h('h2', {}, ['Tasdiqlash kerak']),
      h('p', { class: 'muted' }, [`${actorName} so‘radi:`]),
      h('div', { class: 'private-room-code', style: 'margin:12px 0' }, [actionConfirmText(req)]),
      status,
      h('div', { class: 'row mt-16 gap-12' }, [
        h('button', { class: 'btn-secondary grow', onclick: () => answer(false) }, ['Rad etish']),
        h('button', { class: 'btn-big green grow', style: 'width:auto;min-height:auto;padding:13px', onclick: () => answer(true) }, ['Tasdiqlash']),
      ]),
    ]);
    actionConfirmModal = h('div', { class: 'modal-bg action-confirm-bg' }, [card]);
    document.body.appendChild(actionConfirmModal);
  }

  const onActionConfirmRequest = (req) => {
    sfx.play('click');
    vibrate(16);
    showActionConfirmModal(req);
  };
  const onActionConfirmWaiting = (req) => {
    toast(`${actionConfirmText(req)} — raqib tasdig‘i kutilmoqda`, 'info', 1800);
  };
  const onActionConfirmRejected = () => {
    closeActionConfirmModal();
    toast('Harakat raqib tomonidan rad etildi', 'info');
  };
  const onActionConfirmCancelled = ({ reason } = {}) => {
    closeActionConfirmModal();
    toast(reason || 'Tasdiqlash bekor qilindi', 'info');
  };
  const onActionConfirmed = () => {
    closeActionConfirmModal();
  };

  socket.on('room:state', onRoomState);
  socket.on('chat:message', onChatMessage);
  socket.on('game:start', onGameStart);
  socket.on('game:move', onGameMove);
  socket.on('game:timeout', onGameTimeout);
  socket.on('game:forfeit', onGameForfeit);
  socket.on('game:end', onGameEnd);
  socket.on('spectator:state', onSpectatorState);
  socket.on('player:speech', onPlayerSpeech);
  socket.on('player:typing', onPlayerTyping);
  socket.on('emoji:react', onEmojiReact);
  socket.on('sticker:show', onStickerShow);
  socket.on('room:error', onRoomError);
  socket.on('voice:request', onVoiceRequest);
  socket.on('voice:accept',  onVoiceAccept);
  socket.on('voice:offer',   onVoiceOffer);
  socket.on('voice:answer',  onVoiceAnswer);
  socket.on('voice:ice',     onVoiceIce);
  socket.on('voice:reject',  onVoiceReject);
  socket.on('voice:timeout', onVoiceTimeout);
  socket.on('voice:error',   onVoiceError);
  socket.on('voice:end',     onVoiceEnd);
  socket.on('game:action_confirm_request', onActionConfirmRequest);
  socket.on('game:action_confirm_waiting', onActionConfirmWaiting);
  socket.on('game:action_confirm_rejected', onActionConfirmRejected);
  socket.on('game:action_confirm_cancelled', onActionConfirmCancelled);
  socket.on('game:action_confirmed', onActionConfirmed);

  // Bug 4 fix: Barcha listenerlar ro'yxatga olingandan KEYIN room:join yuboriladi.
  const isSpectating = params?.spectate === '1' || params?.spectate === 'true';
  if (isSpectating && params?.tournamentId && params?.matchId) {
    socket.emit('tournament:watch_match', {
      tournamentId: params.tournamentId,
      matchId: params.matchId,
    }, (res) => {
      if (!res?.ok) {
        hideRoyalLoader('game');
        toast(res?.error || 'Tomosha ochilmadi', 'error');
        return;
      }
      if (res.view) {
        if (loadingWatchdog) { clearTimeout(loadingWatchdog); loadingWatchdog = null; }
        view = res.view; state.game = res.view; finishGameLoader('STOL TAYYOR'); scheduleRender();
      }
    });
  } else if (code) {
    socket.emit('room:join', { code, password: joinPassword }, (res) => {
      if (!res?.ok && !res?.reconnected) {
        hideRoyalLoader('game');
        wrap.innerHTML = '';
        wrap.appendChild(renderGameError(res?.error || 'O\'yin xonasi topilmadi'));
        return;
      }
      if (res?.reconnected) {
        if (res.view) {
          if (loadingWatchdog) { clearTimeout(loadingWatchdog); loadingWatchdog = null; }
          lobbyRoom = null;
          view = res.view; state.game = res.view; finishGameLoader('STOL TAYYOR'); scheduleRender();
        }
      }
    });
  }

  if (!view && code && !isSpectating) {
    loadingWatchdog = setTimeout(() => {
      if (view || lobbyRoom) return;
      socket.emit('room:join', { code, password: joinPassword }, (res) => {
        if (res?.view) {
          lobbyRoom = null;
          view = res.view;
          state.game = res.view;
          finishGameLoader('STOL TAYYOR');
          scheduleRender({ immediate: true });
          return;
        }
        if (!view && !lobbyRoom) {
          hideRoyalLoader('game');
          wrap.innerHTML = '';
          wrap.appendChild(renderGameError(res?.error || 'O\'yin holati kelmadi. Xonaga qayta kiring.'));
        }
      });
    }, 4500);
  }

  function renderGameError(message) {
    return h('div', { class: 'game-flow-error' }, [
      h('div', { class: 'game-flow-error-card' }, [
        h('div', { class: 'game-flow-error-icon' }, ['!']),
        h('h2', {}, [tSafe('game.open_failed', 'O\'yin ochilmadi')]),
        h('p', {}, [message || tSafe('game.room_no_response', 'Xona yoki server javob bermadi.')]),
        h('div', { class: 'row gap-12 mt-16' }, [
          h('button', { class: 'btn-secondary grow', onclick: () => navigate('home') }, [tSafe('game.nav_home', 'Bosh sahifa')]),
          h('button', { class: 'btn-big green grow', style: 'width:auto;min-height:auto;padding:13px', onclick: () => navigate('lobby') }, [tSafe('game.nav_tables', 'Stollar')]),
        ]),
      ]),
    ]);
  }

  function showStickerOverlay(payloadOrImg, senderNameArg = '') {
    const payload = (payloadOrImg && typeof payloadOrImg === 'object')
      ? payloadOrImg
      : { img: payloadOrImg, senderName: senderNameArg };
    const img = String(payload.img || '').trim();
    if (!img) return;
    const senderName = String(payload.senderName || senderNameArg || '').trim();
    const dedupeKey = `${payload.senderId || payload.playerId || ''}:${payload.roomCode || code || ''}:${img}`;
    const now = Date.now();
    if (dedupeKey === lastStickerOverlayKey && now - lastStickerOverlayAt < 700) return;
    lastStickerOverlayKey = dedupeKey;
    lastStickerOverlayAt = now;

    document.querySelectorAll('.game-sticker-overlay').forEach((node) => node.remove());
    const lite = wrap.classList.contains('perf-lite') || reduceMotion || lowEndDevice || nativeWebView;
    const ov = h('div', {
      class: `game-sticker-overlay${lite ? ' lite' : ''}`,
      role: 'status',
      'aria-live': 'polite',
    }, [
      h('div', { class: 'game-sticker-overlay-card' }, [
        h('span', { class: 'game-sticker-overlay-glow' }, []),
        !lite ? h('span', { class: 'game-sticker-spark s1' }, []) : null,
        !lite ? h('span', { class: 'game-sticker-spark s2' }, []) : null,
        !lite ? h('span', { class: 'game-sticker-spark s3' }, []) : null,
        h('span', { class: 'game-sticker-overlay-fallback' }, ['STICKER']),
        h('img', {
          src: img,
          alt: senderName ? `${senderName} sticker` : 'Sticker',
          loading: 'eager',
          decoding: 'async',
          onload: (e) => e.currentTarget.closest('.game-sticker-overlay-card')?.classList.add('has-sticker-img'),
          onerror: (e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.closest('.game-sticker-overlay-card')?.classList.add('broken-sticker-img');
          },
        }),
      ]),
      senderName ? h('div', { class: 'game-sticker-overlay-name' }, [senderName]) : null,
    ]);
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('show'));
    const holdMs = lite
      ? Math.max(1700, Math.min(2300, Number(payload.durationMs || STICKER_OVERLAY_MS)))
      : Math.max(STICKER_OVERLAY_MS, Number(payload.durationMs || STICKER_OVERLAY_MS) + 650);
    setTimeout(() => {
      ov.classList.add('hide');
      setTimeout(() => ov.remove(), lite ? 120 : 260);
    }, holdMs);
  }

  function isMyTurnAttacker(me) {
    return view.phase === 'attacking' && (
      view.players[view.attackerIdx]?.id === me?.id ||
      (view.throwInMode === 'all' && view.players[view.defenderIdx]?.id !== me?.id)
    );
  }
  function isMyTurnDefender(me) { return view.phase === 'defending' && view.players[view.defenderIdx]?.id === me?.id; }

  async function playCard(card, opts = {}) {
    if (!card || !view) return;
    if (!opts.alreadyLocked) {
      if (playingCard) return;
      playingCard = true;
    }
    const me = view.players.find((p) => p.hand);
    finishGameLoader('STOL TAYYOR');
    const isDef = view.players[view.defenderIdx]?.id === me?.id;
    const canTransfer = isDef
      && view.transferEnabled
      && view.table?.length
      && view.table.every((t) => !t.defense)
      && view.table.some((t) => (t.attack?.rank || t.claimedRank) === card.rank);
    const action = canTransfer ? 'transfer' : (isDef ? 'defense' : 'attack');
    const cardId = cardWireId(card);
    if (isDef && !canTransfer) sfx.play('cardBeat');
    vibrate(isDef && !canTransfer ? 18 : 12);
    try {
      const resp = await emitWithAck('game:action', { code, action, payload: { card: cardId } })
        .catch((e) => ({ ok: false, error: e.message }));
      if (resp?.pending) {
        toast('Raqib tasdig‘i kutilmoqda', 'info', 1600);
      } else if (!resp?.ok) {
        sfx.play('error');
        toast(resp?.error || 'Noto\'g\'ri yurish', 'error');
      }
    } finally {
      selectedCard = null;
      playingCard = false;
      scheduleRender();
    }
  }

  function getTableDropZone() {
    const table = wrap.querySelector('.table-cards');
    const screen = wrap.querySelector('.game-screen') || wrap;
    const sr = screen.getBoundingClientRect();
    const padX = Math.max(50, sr.width * 0.08);
    const padY = 42;
    const fallback = {
      left: sr.left + sr.width * 0.11,
      right: sr.right - sr.width * 0.11,
      top: sr.top + sr.height * 0.16,
      bottom: sr.top + sr.height * 0.66,
      padX,
      padY,
    };
    if (!table) return fallback;
    const r = table.getBoundingClientRect();
    const tableTooSmall = r.width < 150 || r.height < 120;
    const zone = tableTooSmall ? fallback : {
      left: Math.min(r.left, fallback.left),
      right: Math.max(r.right, fallback.right),
      top: Math.min(r.top, fallback.top),
      bottom: Math.max(r.bottom, fallback.bottom),
      padX,
      padY,
    };
    return zone;
  }

  function pointIsOnTable(x, y, cachedZone = null) {
    const zone = cachedZone || getTableDropZone();
    const padX = zone.padX || 50;
    const padY = zone.padY || 42;
    return x >= zone.left - padX && x <= zone.right + padX && y >= zone.top - padY && y <= zone.bottom + padY;
  }

  function animatePlayedCard(cardEl, zone, releaseRect = null, homeRect = null) {
    const target = zone || getTableDropZone();

    // Fallback if not provided
    const hRect = homeRect || cardEl.getBoundingClientRect();
    const rRect = releaseRect || hRect;

    const centerX = rRect.left + rRect.width / 2;
    const centerY = rRect.top + rRect.height / 2;

    const startLeft = centerX - hRect.width / 2;
    const startTop = centerY - hRect.height / 2;

    const targetX = (target.left + target.right) / 2 - hRect.width / 2;
    const targetY = target.top + (target.bottom - target.top) * 0.5 - hRect.height / 2;

    const dx = targetX - startLeft;
    const dy = targetY - startTop;

    // Performance rejimini aniqlash
    const lite = wrap.classList.contains('perf-lite') || reduceMotion || lowEndDevice || nativeWebView;
    const duration = lite ? 240 : 340; // slightly faster for enhanced responsiveness

    // Random rotation (real karta tashlanganda har xil burchak)
    // Tashlash yo'nalishi bo'yicha rotation: chapga otsa -burchak, o'ngga +burchak
    const dirSign = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
    const finalRotation = lite ? 0 : dirSign * (4 + Math.random() * 6); // 4-10deg
    const peakRotation = lite ? 0 : dirSign * (8 + Math.random() * 5);  // 8-13deg peak

    // Arc — karta engil yuqoriga ko'tarilib tushadi (parabola)
    const arcLift = lite ? 0 : Math.min(40, Math.abs(dy) * 0.18);

    // Clone yaratish using unscaled home size
    const clone = cardEl.cloneNode(true);
    clone.classList.remove('dragging', 'drop-ready', 'selected', 'snap-back', 'fly-to-table', 'dealing');
    clone.classList.add('throw-clone');
    clone.style.cssText = `
      position:fixed !important;
      left:${startLeft}px !important;
      top:${startTop}px !important;
      width:${hRect.width}px !important;
      height:${hRect.height}px !important;
      margin:0 !important;
      transform:translate3d(0,0,0) scale(1.08) rotate(0deg);
      z-index:90000 !important;
      pointer-events:none !important;
      will-change:transform, opacity;
      transition:none !important;
    `;
    document.body.appendChild(clone);

    // Asl karta - darhol yashirish (flicker va sakrash oldini olish)
    cardEl.style.transition = 'none';
    cardEl.style.opacity = '0';
    cardEl.style.pointerEvents = 'none';

    // Animatsiya keyframes — 3 fazali professional
    // Faza 1 (0-25%): biroz yuqoriga ko'tariladi va kattalashadi (lift-off)
    // Faza 2 (25-75%): asosiy parvoz, arc + rotation peak
    // Faza 3 (75-100%): stolga tushadi, engil bounce
    const keyframes = lite ? [
      // Mobil/APK: sodda 2 faza (performance uchun)
      { transform: `translate3d(0, 0, 0) scale(1.08) rotate(0deg)`, opacity: 1, offset: 0 },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(1) rotate(${finalRotation}deg)`, opacity: 0.95, offset: 1 },
    ] : [
      // Desktop: to'liq 4 faza, smooth
      {
        transform: `translate3d(0, 0, 0) scale(1.08) rotate(0deg)`,
        opacity: 1,
        offset: 0,
        filter: 'drop-shadow(0 8px 14px rgba(0,0,0,.5))',
      },
      {
        // Lift-off: yuqoriga ko'tariladi, kattaroq, peak rotation
        transform: `translate3d(${dx * 0.25}px, ${dy * 0.25 - arcLift}px, 0) scale(1.12) rotate(${peakRotation * 0.6}deg)`,
        opacity: 1,
        offset: 0.25,
        filter: 'drop-shadow(0 22px 30px rgba(0,0,0,.6))',
      },
      {
        // Mid-flight: arc peak
        transform: `translate3d(${dx * 0.65}px, ${dy * 0.65 - arcLift * 0.6}px, 0) scale(1.06) rotate(${peakRotation}deg)`,
        opacity: 1,
        offset: 0.6,
        filter: 'drop-shadow(0 18px 24px rgba(0,0,0,.55))',
      },
      {
        // Landing: stolga tushadi, biroz oshib ketadi (overshoot)
        transform: `translate3d(${dx * 1.02}px, ${dy * 1.02}px, 0) scale(0.98) rotate(${finalRotation * 1.1}deg)`,
        opacity: 1,
        offset: 0.88,
        filter: 'drop-shadow(0 10px 16px rgba(0,0,0,.45))',
      },
      {
        // Settle: yakuniy o'rin, smooth landing
        transform: `translate3d(${dx}px, ${dy}px, 0) scale(1) rotate(${finalRotation}deg)`,
        opacity: 1,
        offset: 1,
        filter: 'drop-shadow(0 6px 12px rgba(0,0,0,.4))',
      },
    ];

    const animation = clone.animate(keyframes, {
      duration,
      // Custom easing: tez boshlanadi, oxirida sekinlashadi (real karta inertia)
      easing: lite ? 'cubic-bezier(.25,.85,.35,1)' : 'cubic-bezier(.22,.61,.36,1.02)',
      fill: 'forwards',
    });

    // Cleanup — animatsiya tugaganda clone ni server javobi bilan sinxron olib tashlash
    // Server karta to'g'ri tushgani tasdiqlasa, render() yangi table card chizadi
    // va biz clone ni shu vaqtda olib tashlaymiz (flicker yo'q)
    const cleanup = () => {
      if (clone.isConnected) {
        // Fade out tezkor (60ms) — render orqali yangi karta ko'rinishi bilan birga
        clone.style.transition = 'opacity 60ms ease-out';
        clone.style.opacity = '0';
        setTimeout(() => clone.remove(), 80);
      }
    };
    animation.onfinish = cleanup;
    animation.oncancel = cleanup;
    // Safety timeout — har qanday holatda 1s ichida olib tashlanadi
    setTimeout(() => {
      if (clone.isConnected) clone.remove();
    }, duration + 400);
  }

  function attachDragToPlay(cardEl, card, canPlay, me) {
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let moved = false;
    let baseTransform = '';
    let lastX = 0;
    let lastY = 0;
    let dropZone = null;
    let rafMove = null;
    let pendingDx = 0;
    let pendingDy = 0;

    function flushDragMove() {
      rafMove = null;
      cardEl.style.transform = `${baseTransform} translate3d(${pendingDx}px, ${pendingDy}px, 0) scale(1.08)`;
    }

    cardEl.addEventListener('pointerdown', (e) => {
      if (!(isMyTurnAttacker(me) || isMyTurnDefender(me))) return;
      if (!canPlay) {
        sfx.play('error');
        toast('Bu karta bilan yurib bo‘lmaydi', 'error');
        return;
      }
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      dragging = true;
      moved = false;
      pendingDx = 0;
      pendingDy = 0;
      baseTransform = cardEl.style.transform || '';
      dropZone = getTableDropZone();
      cardEl.classList.add('dragging');
      const handEl = cardEl.closest('.my-hand');
      if (handEl) handEl.classList.add('hand-dragging');
      cardEl.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });

    cardEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (Math.hypot(dx, dy) > 5) moved = true;
      pendingDx = dx;
      pendingDy = dy;
      if (!rafMove) rafMove = requestAnimationFrame(flushDragMove);
      cardEl.style.zIndex = '99999';
      cardEl.classList.toggle('drop-ready', pointIsOnTable(e.clientX, e.clientY, dropZone) || dy < -82);
      e.preventDefault();
    });

    cardEl.addEventListener('pointerup', async (e) => {
      if (!dragging) return;
      dragging = false;
      if (rafMove) { cancelAnimationFrame(rafMove); rafMove = null; }
      cardEl.releasePointerCapture?.(e.pointerId);
      cardEl.classList.remove('dragging');
      const handEl = cardEl.closest('.my-hand');
      if (handEl) handEl.classList.remove('hand-dragging');
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // 1. Measure release position (scaled)
      const releaseRect = cardEl.getBoundingClientRect();

      // Reset card visual transform back to its home hand position
      cardEl.style.transform = baseTransform;
      cardEl.style.zIndex = '';
      cardEl.classList.remove('drop-ready');

      // 2. Measure home position (unscaled)
      const homeRect = cardEl.getBoundingClientRect();

      const cardCenterX = releaseRect.left + releaseRect.width / 2;
      const cardCenterY = releaseRect.top + releaseRect.height / 2;
      const upwardThrow = dy < -72 && Math.abs(dx) < 220;
      const enoughMove = Math.hypot(dx, dy) > 18;
      const shouldPlay = enoughMove && (
        pointIsOnTable(cardCenterX, cardCenterY, dropZone)
        || pointIsOnTable(e.clientX, e.clientY, dropZone)
        || pointIsOnTable(lastX, lastY, dropZone)
        || upwardThrow
      );
      if (shouldPlay) {
        if (playingCard) { dropZone = null; return; }
        playingCard = true;
        cardEl.dataset.dragPlayed = '1';
        setTimeout(() => { delete cardEl.dataset.dragPlayed; }, 700);
        
        // 3. Pass both rects to start the flight animation exactly from the dragged position
        animatePlayedCard(cardEl, dropZone, releaseRect, homeRect);
        
        await sleep(CARD_THROW_COMMIT_MS);
        await playCard(card, { alreadyLocked: true });
      } else if (moved) {
        cardEl.classList.add('snap-back');
        setTimeout(() => cardEl.classList.remove('snap-back'), 180);
      }
      dropZone = null;
    });

    cardEl.addEventListener('pointercancel', () => {
      dragging = false;
      if (rafMove) { cancelAnimationFrame(rafMove); rafMove = null; }
      cardEl.classList.remove('dragging');
      const handEl = cardEl.closest('.my-hand');
      if (handEl) handEl.classList.remove('hand-dragging');
      cardEl.classList.remove('drop-ready');
      cardEl.style.transform = baseTransform;
      cardEl.style.zIndex = '';
      dropZone = null;
      playingCard = false;
      scheduleRender();
    });
  }

  async function emitAction(action) {
    sfx.play('click');
    vibrate(10);
    const resp = await emitWithAck('game:action', { code, action }).catch((e) => ({ ok: false, error: e.message }));
    if (resp?.pending) toast('Raqib tasdig‘i kutilmoqda', 'info', 1600);
    else if (!resp?.ok) toast(resp?.error || 'Harakat bajarilmadi', 'error');
    return resp;
  }

  function firstChallengeableBluff() {
    if (!view?.bluffEnabled || !Array.isArray(view.table)) return -1;
    return view.table.findIndex((pair) => pair?.attack?.faceDown || pair?.claimedRank);
  }

  function promptClaimedRank(defaultRank = '') {
    const raw = window.prompt('Qaysi karta deb ko‘rsatasiz? (6,7,8,9,10,J,Q,K,A)', defaultRank === 'T' ? '10' : defaultRank);
    const value = String(raw || '').trim().toUpperCase();
    if (!value) return '';
    if (value === '10') return 'T';
    return ['6','7','8','9','T','J','Q','K','A'].includes(value) ? value : '';
  }

  async function bluffAttack(card) {
    if (!card || !view?.bluffEnabled || !isMyTurnAttacker(view.players.find((p) => p.hand))) return;
    if (playingCard) return;
    const claimedRank = promptClaimedRank(card.rank);
    if (!claimedRank) {
      toast('Bluff uchun karta qiymatini tanlang', 'info');
      return;
    }
    playingCard = true;
    sfx.play('click');
    vibrate(12);
    const cardId = cardWireId(card);
    try {
      const resp = await emitWithAck('game:action', {
        code,
        action: 'attack',
        payload: { card: cardId, bluff: true, claimedRank },
      }).catch((e) => ({ ok: false, error: e.message }));
      if (resp?.pending) {
        toast('Raqib tasdig‘i kutilmoqda', 'info', 1600);
      } else if (!resp?.ok) {
        sfx.play('error');
        toast(resp?.error || 'Bluff yurish qabul qilinmadi', 'error');
      }
    } finally {
      selectedCard = null;
      playingCard = false;
      scheduleRender();
    }
  }

  async function challengeBluffAt(tableIdx) {
    if (tableIdx < 0) return toast('Stolda shubhali karta yo‘q', 'info');
    sfx.play('click');
    const resp = await emitWithAck('game:action', {
      code,
      action: 'challenge',
      payload: { tableIdx },
    }).catch((e) => ({ ok: false, error: e.message }));
    if (!resp?.ok) {
      sfx.play('error');
      toast(resp?.error || 'Shubha qabul qilinmadi', 'error');
    }
  }

  async function usePerk(perk) {
    sfx.play('click');
    if (view?.mode === 'tournament') {
      toast('Perklar turnirda yopiq', 'error'); return;
    }
    const resp = await emitWithAck('game:perk', { code, perk: perk.id }).catch((e) => ({ ok: false, error: e.message }));
    if (!resp?.ok) {
      sfx.play('error');
      toast(resp?.error || 'Perk ishlamadi', 'error'); return;
    }
    if (state.user) state.user.goldCoins = Math.max(0, (state.user.goldCoins || 0) - (resp.cost || perk.cost));
    showPerkReveal({
      kind: perk.id,
      revealMs: resp.revealMs || 0,
      opponents: resp.opponents || null,
      card: resp.card || null,
      hint: resp.hint || null,
    });
  }

  function openReportDialog() {
    sfx.play('click');
    const opponents = (view?.players || []).filter((p) => !p.hand);
    if (!opponents.length) { toast('Hech kim yo\'q', 'info'); return; }
    let target = opponents[0].id;
    let reason = REPORT_REASONS()[0].id;
    let details = '';

    const card = h('div', { class: 'modal' }, [
      h('h2', {}, ['🚩 Shikoyat']),
      labelBlock('O\'yinchi', selectFromList(opponents.map(p => [p.id, p.username]), v => target = v)),
      labelBlock('Sabab',    selectFromList(REPORT_REASONS().map(r => [r.id, r.label]), v => reason = v)),
      (() => {
        const ta = document.createElement('textarea');
        ta.placeholder = 'Ixtiyoriy: tafsilotlar';
        ta.style.cssText = 'width:100%;min-height:80px;margin-top:8px';
        ta.maxLength = 1024;
        ta.addEventListener('input', () => { details = ta.value; });
        return ta;
      })(),
      h('div', { class: 'row gap-12 mt-16' }, [
        h('button', { class: 'btn-secondary grow', onclick: () => bg.remove() }, ['Bekor']),
        h('button', {
          class: 'btn-done', style: 'padding:12px 22px;font-size:14px',
          onclick: async () => {
            const resp = await emitWithAck('report:submit', { code, reportedId: target, reason, details })
              .catch((e) => ({ ok: false, error: e.message }));
            bg.remove();
            toast(resp?.ok ? '✓ Shikoyat yuborildi' : (resp?.error || 'Xatolik'), resp?.ok ? 'success' : 'error');
          },
        }, ['Yuborish']),
      ]),
    ]);
    const bg = h('div', { class: 'modal-bg' }, [card]);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    wrap.appendChild(bg);
  }

  function renderClubBackground() {
    return h('div', { class: 'game-room-bg', 'aria-hidden': 'true' }, []);
  }

  function isTextChatAllowed() {
    return false;
  }

  function sendEmojiReaction(label) {
    sfx.play('click');
    socket.emit('chat:message', { code, content: label, type: 'emoji' }, (res) => {
      if (!res?.ok) toast(res?.error || 'Emoji yuborilmadi', 'error');
    });
  }

  function resetCardTouchState() {
    selectedCard = null;
    wrap.querySelectorAll('.my-hand .card.dragging,.my-hand .card.drop-ready,.my-hand .card.selected').forEach((cardEl) => {
      cardEl.classList.remove('dragging', 'drop-ready', 'selected', 'snap-back');
      cardEl.style.transform = '';
      cardEl.style.zIndex = '';
      cardEl.style.visibility = '';
    });
    document.querySelectorAll('.throw-clone').forEach((node) => node.remove());
  }

  function refreshLiveChatFeed() {
    wrap.querySelector('.game-chat-feed')?.remove();
  }

  function refreshReactionsPanel() {
    wrap.querySelector('.royal-reactions.open.reaction-all')?.remove();
    const panel = renderReactionsPanel();
    if (panel) wrap.appendChild(panel);
  }

  function setChatPanel(open) {
    chatOpen = false;
    wrap.querySelector('.chat-panel')?.remove();
    if (open) toast("Yozma chat o'yindan tashqarida. O'yinda voice va stiker ishlaydi.", 'info');
  }

  function toggleReactions(tab = 'emoji') {
    if (!pref('pref_emotions', state.user)) {
      toast('Emoji va stikerlar sozlamada o\'chirilgan', 'info');
      return;
    }
    resetCardTouchState();
    reactionsOpen = !(reactionsOpen && reactionsTab === tab);
    reactionsTab = tab;
    sfx.play('click');
    refreshReactionsPanel();
  }

  function setReactionTab(tab) {
    resetCardTouchState();
    reactionsOpen = true;
    reactionsTab = tab;
    sfx.play('click');
    refreshReactionsPanel();
  }

  function openReactionHistory() {
    sfx.play('click');
    const items = chatLog.slice(-12).reverse();
    const bg = h('div', { class: 'modal-bg' });
    const card = h('div', { class: 'modal reaction-history-modal' }, [
      h('h2', {}, ['Reaksiya tarixi']),
      items.length
        ? h('div', { class: 'reaction-history-list' }, items.map((m) => h('div', {}, [
          h('b', {}, [m.senderName || m.username || 'O\'yinchi']),
          h('span', {}, [m.content || '']),
        ])))
        : h('p', { class: 'muted' }, ['Hali reaksiya yuborilmagan.']),
      h('button', { class: 'btn-secondary mt-16', onclick: () => bg.remove() }, ['Yopish']),
    ]);
    bg.appendChild(card);
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
    wrap.appendChild(bg);
  }

  function loadOwnedEmojiForReactions({ force = false } = {}) {
    if (loadingOwnedEmoji) return;
    if (!force && ownedEmojiCache && Date.now() - Number(ownedEmojiCache.at || 0) < 15000) return;
    loadingOwnedEmoji = true;
    ownedEmojiError = '';
    api.inventoryGrouped()
      .then((data) => {
        ownedEmojiCache = { at: Date.now(), items: ownedEmojiItemsFromGrouped(data) };
      })
      .catch((err) => {
        ownedEmojiError = err.message || 'Emoji packlar yuklanmadi';
      })
      .finally(() => {
        loadingOwnedEmoji = false;
        if (reactionsOpen && reactionsTab === 'emoji') refreshReactionsPanel();
      });
  }

  function reactionEmojiItems() {
    loadOwnedEmojiForReactions();
    const extras = Array.isArray(ownedEmojiCache?.items) ? ownedEmojiCache.items : [];
    return [
      ...BASE_EMOJI_ITEMS.map((label) => ({ label, title: label })),
      ...extras,
    ].slice(0, 80);
  }

  function renderEmojiReactionButton(item) {
    const label = String(item?.label || '😀');
    return h('button', {
      onclick: () => sendEmojiReaction(label),
      title: item?.title || label,
    }, [
      item?.img ? h('img', {
        src: item.img,
        alt: item?.title || label,
        loading: 'lazy',
        style: 'width:34px;height:34px;object-fit:contain',
        onerror: (e) => { e.currentTarget.remove(); },
      }) : label,
    ]);
  }

  function renderReactionsPanel() {
    if (!reactionsOpen || !pref('pref_emotions', state.user)) return null;
    const tabButton = (tab, label) => h('button', {
      class: reactionsTab === tab ? 'active' : '',
      onclick: () => setReactionTab(tab),
    }, [label]);
    const emojiItems = reactionEmojiItems();
    const section = (title, child) => h('section', { class: `reaction-section ${reactionsTab === title ? 'active' : ''}` }, [
      h('div', { class: 'reaction-section-title' }, [title]),
      child,
    ]);
    const content = h('div', { class: 'reaction-sections' }, [
      section('emoji', h('div', { class: 'reaction-grid' }, emojiItems.map((e) =>
        renderEmojiReactionButton(e)
      ).concat(loadingOwnedEmoji ? [h('button', { disabled: true }, ['...'])] : ownedEmojiError ? [h('button', { onclick: () => loadOwnedEmojiForReactions({ force: true }) }, ['↻'])] : []))),
      section('stickers', h('div', { class: 'reaction-grid reaction-tool-grid' }, [
        h('button', { onclick: openStickerPicker }, [h('span', {}, ['🎭']), h('small', {}, ['Stikerlar'])]),
        h('button', { onclick: openStickerPicker }, [h('span', {}, ['GIF']), h('small', {}, ['Packlar'])]),
        h('button', { onclick: () => navigate('shop') }, [h('span', {}, ['🛒']), h('small', {}, ["Do'kon"])]),
        h('button', { onclick: () => toast('Stickerlar do\'kondan olingandan keyin shu yerdan yuboriladi', 'info') }, [h('span', {}, ['+']), h('small', {}, ['Yordam'])]),
      ])),
      section('perks', h('div', { class: 'reaction-grid reaction-tool-grid' }, PERKS.map((perk) =>
        h('button', { onclick: () => usePerk(perk), title: perk.label }, [
          h('span', {}, [perk.icon]),
          h('small', {}, [perk.label]),
        ])
      ))),
    ]);
    return h('div', { class: `royal-reactions open reaction-all ${reactionsTab}` }, [
      h('div', { class: 'reaction-tabs' }, [
        tabButton('emoji', 'Emoji'),
        tabButton('stickers', 'Stikerlar'),
        tabButton('perks', 'Kosoncha'),
      ]),
      content,
      h('div', { class: 'reaction-bottom' }, [
        h('button', { onclick: () => setReactionTab('emoji') }, ['😀']),
        h('button', { onclick: openStickerPicker }, ['GIF']),
        h('button', { onclick: () => setReactionTab('perks') }, ['🎭']),
        h('button', { onclick: openReactionHistory }, ['◷']),
      ]),
    ]);
  }

  function openForfeitDialog() {
    if (!view || view.phase === 'ended') {
      navigate('home');
      return;
    }
    sfx.play('click');
    const bg = h('div', { class: 'modal-bg' });
    const card = h('div', { class: 'modal forfeit-confirm-modal demo-surrender-modal' }, [
      h('p', { class: 'demo-surrender-question' }, ['Are you sure you want to surrender?']),
      h('small', {}, [`$${formatGameMoney(view.stake)} tikish qolgan o'yinchilarga taqsimlanadi.`]),
      h('div', { class: 'demo-surrender-actions' }, [
        h('button', { class: 'demo-surrender-no', onclick: () => bg.remove() }, ['NO']),
        h('button', {
          class: 'demo-surrender-yes btn-done',
          onclick: async () => {
            const btn = card.querySelector('.btn-done');
            if (btn) btn.disabled = true;
            showRoyalLoader({
              source: 'exit',
              variant: 'forfeit',
              title: 'STOLDAN CHIQILMOQDA',
              subtitle: 'Premium exit overlay',
              status: 'Tikilgan bank qolgan oyinchilarga taqsimlanmoqda',
              progress: 64,
              items: ['BANK', 'PAYOUT', 'RESULT'],
            });
            const resp = await emitWithAck('game:forfeit', { code }, 9000).catch((e) => ({ ok: false, error: e.message }));
            bg.remove();
            if (!resp?.ok) {
              hideRoyalLoader('exit');
              sfx.play('error');
              toast(resp?.error || 'Chiqish bajarilmadi', 'error');
              return;
            }
            if (resp.view) {
              view = resp.view;
              state.game = resp.view;
            }
            sfx.play('warning');
            completeRoyalLoader('NATIJA TAYYOR', 540, 'exit');
            scheduleRender();
          },
        }, ['YES']),
      ]),
    ]);
    bg.appendChild(card);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    wrap.appendChild(bg);
  }

  function renderPregame(room) {
    const maxPlayers = Number(room.maxPlayers || 2);
    const seats = Array.from({ length: maxPlayers }, (_, i) => room.seats?.[i] || null);
    const seated = seats.filter(Boolean);
    const taken = seated.length;
    const me = seated.find((s) => s.id === state.user?.id) || null;
    const allSeatedReady = taken > 0 && seated.every((s) => s.ready);
    const privateWaiting = room.isPrivate && taken < maxPlayers;
    const cardsSoon = allSeatedReady && !privateWaiting;
    const bank = Number(room.stake || 0) * Math.max(1, taken || 1);
    const statusText = privateWaiting
      ? "Do'stingiz stolga kirishini kutyapmiz"
      : cardsSoon
        ? 'Kartalar tarqatilmoqda'
        : me?.ready
          ? 'Boshqa o‘yinchilar tayyor bo‘lishini kutyapmiz'
          : '30 soniya ichida Tayyor bosing';
    const buttonText = readyChanging
      ? '...'
      : cardsSoon
        ? 'Tayyor'
        : 'Tayyor';
    const readySeconds = armPregameReadyClock(room, me, cardsSoon);

    const top = h('div', { class: 'game-topbar pregame-topbar' }, [
      h('button', { class: 'btn-icon danger-exit', title: 'Chiqish', onclick: leavePregame }, ['‹']),
      h('div', { class: 'pot' }, [
        h('span', {}, [`💰 ${Number(room.stake || 0).toLocaleString('ru-RU')}`]),
        h('span', {}, [`👥 ${taken}/${maxPlayers}`]),
        h('span', {}, [`🃏 ${room.deckSize || 36}`]),
      ]),
      h('button', { class: 'btn-icon game-settings-btn', title: 'Sozlamalar', onclick: () => navigate('settings') }, ['⚙']),
      h('div', { class: 'room-id' }, [`#${room.code || code}`]),
    ]);

    const seatNode = (seat, index) => {
      if (!seat) {
        return h('div', { class: 'pregame-seat empty' }, [
          h('div', { class: 'pregame-seat-avatar empty' }, ['+']),
          h('div', { class: 'pregame-seat-main' }, [
            h('b', {}, [`Joy ${index + 1}`]),
            h('small', {}, ['Kutilmoqda']),
          ]),
        ]);
      }
      const mine = seat.id === state.user?.id;
      const seatAvatar = renderPlayerAvatar(seat, { dataPlayer: false });
      if (seat.ready) seatAvatar.appendChild(h('span', { class: 'pregame-ready-check' }, ['✓']));
      return h('div', { class: `pregame-seat taken ${seat.ready ? 'ready' : ''} ${mine ? 'me' : ''}` }, [
        seatAvatar,
        h('div', { class: 'pregame-seat-main' }, [
          h('b', {}, [displayGameName(seat) || `O'yinchi ${index + 1}`]),
          h('small', {}, [seat.ready ? 'Tayyor' : 'Tayyor kutilmoqda']),
        ]),
        h('span', { class: 'pregame-ready-dot' }, [seat.ready ? '✓' : '']),
      ]);
    };

    return h('div', { class: 'game-pregame-shell' }, [
      renderClubBackground(),
      top,
      h('aside', { class: 'royal-game-left pregame-left' }, [
        h('button', { class: 'royal-square-btn', onclick: leavePregame, title: 'Chiqish' }, ['‹']),
        h('div', { class: 'royal-stake-box' }, [
          h('small', {}, ['Stavka:']),
          h('strong', {}, [`$ ${Number(room.stake || 0).toLocaleString('ru-RU')}`]),
          h('i', {}, []),
          h('small', {}, ['Bank:']),
          h('strong', { class: 'green' }, [`$ ${bank.toLocaleString('ru-RU')}`]),
        ]),
      ]),
      h('section', { class: 'pregame-table-stage' }, [
        h('div', { class: 'pregame-deck-stack', 'aria-hidden': 'true' }, [
          h('span', {}, []), h('span', {}, []), h('span', {}, []),
        ]),
        h('div', { class: 'pregame-title' }, ['STOL TAYYOR']),
        h('div', { class: 'pregame-status' }, [statusText]),
        h('div', { class: 'pregame-seats-grid' }, seats.map(seatNode)),
      ]),
      h('div', { class: 'pregame-bottom-dock' }, [
        renderPlayerAvatar(me || state.user, { dataPlayer: false, mine: true }),
        h('div', { class: 'pregame-me-info' }, [
          h('b', {}, [displayGameName(state.user) || 'Siz']),
          h('small', {}, [me?.ready ? 'Tayyor bosildi' : `${Math.max(0, readySeconds)} sekund qoldi`]),
        ]),
        h('button', {
          class: `pregame-start-button ${me?.ready ? 'ready' : ''}`,
          disabled: !me || readyChanging || cardsSoon,
          onclick: () => toggleReadyFromGame(room, me),
        }, [
          h('strong', {}, [buttonText]),
          !me?.ready && !cardsSoon ? h('small', {}, [`${Math.max(0, readySeconds)}s`]) : null,
        ]),
      ]),
    ]);
  }

  function render() {
    wrap.innerHTML = '';
    if (!view) {
      if (lobbyRoom) {
        wrap.appendChild(renderPregame(lobbyRoom));
        return;
      }
      wrap.appendChild(h('div', { class: 'end-overlay' }, [
        h('div', { class: 'result-title' }, ['Yuklanmoqda…']),
      ]));
      return;
    }

    const me = view.players.find((p) => p.hand);
    const opps = view.players.filter((p) => p !== me);
    const forfeitInfo = view.forfeit || null;
    const forfeitedId = forfeitInfo?.playerId || null;
    const payoutByPlayer = new Map((view.payoutShares || []).map((s) => [s.playerId, Number(s.amount || 0)]));
    const myPayout = me?.id ? (payoutByPlayer.get(me.id) || 0) : 0;
    const activeCardSkin = currentCardSkin();
    const liteRender = wrap.classList.contains('perf-lite');
    wrap.appendChild(renderClubBackground());

    // ── Top bar ──────────────────────────────────────────────────
    const tableSize = Number(view.maxPlayers || view.players.length || 0);
    const is1v1 = tableSize === 2;
    const voiceRoomEligible = view.voiceEligible === true;
    const gamesPlayed = state.user?.games_played || 0;
    const voiceUnlocked = voiceRoomEligible && gamesPlayed >= 10;
    const isPremium = !!(state.user?.premium_until && new Date(state.user.premium_until) > new Date());
    const voiceBtn = voiceUnlocked ? h('button', {
      class: `btn-icon voice-btn${voiceState === 'active' ? ' voice-active' : ''}`,
      title: voiceState === 'active' ? 'Ovozni o\'chirish' : 'Ovozli chat',
      onclick: () => {
        if (voiceState === 'active') {
          stopVoice({ emitEnd: true, notify: true, message: 'Ovoz o‘chirildi' });
        } else if (voiceState === 'idle') {
          voiceState = 'requesting';
          scheduleRender();
          clearVoiceTimers();
          voiceRequestTimer = setTimeout(() => {
            if (voiceState !== 'requesting') return;
            socket.emit('voice:end', { code, reason: 'request-timeout' }, () => {});
            stopVoice({ notify: true, message: 'Ovozli chat so‘rovi javobsiz qoldi' });
          }, VOICE_REQUEST_TIMEOUT_MS);
          socket.emit('voice:request', { code }, (res) => {
            if (!res?.ok) {
              stopVoice();
              toast(res?.error || 'Ovozli chat ochilmadi', 'error');
              return;
            }
            toast('Ovozli chat so\'rovi yuborildi…', 'info');
          });
        }
      },
    }, [voiceState === 'active' ? '🔇' : voiceState === 'requesting' ? '⏳' : '🎤']) : null;

    const aiBtn = h('button', {
      class: 'btn-icon ai-chat-btn',
      title: 'AI Yordamchi',
      onclick: () => { sfx.play('click'); openAIChatModal(state.user, isPremium); },
    }, ['🤖']);

    const emojiBtn = pref('pref_emotions', state.user) ? h('button', {
      class: `btn-icon game-emoji-btn${reactionsOpen ? ' active' : ''}`,
      title: 'Emoji va stikerlar',
      onclick: () => toggleReactions('emoji'),
    }, ['😀']) : null;
    const settingsBtn = h('button', {
      class: 'btn-icon game-settings-btn',
      title: 'Sozlamalar',
      onclick: () => { sfx.play('click'); navigate('settings'); },
    }, ['⚙']);

    const top = h('div', { class: 'game-topbar' }, [
      h('button', { class: 'btn-icon', onclick: () => { sfx.play('click'); navigate('rules'); } }, ['ⓘ']),
      h('div', { class: 'pot' }, [
        h('span', {}, [`💰 ${view.stake >= 1000 ? `${Math.round(view.stake/100)/10}K` : view.stake}`]),
        h('span', {}, [`👥 ${view.players.length}`]),
        h('span', {}, [`🃏 ${view.deckRemaining ?? view.deckSize ?? 0}`]),
      ]),
      voiceBtn,
      aiBtn,
      emojiBtn,
      settingsBtn,
      h('div', { class: 'room-id' }, [`#${code}`]),
    ].filter(Boolean));
    const exitBtn = top.querySelector('.btn-icon');
    if (exitBtn) {
      exitBtn.replaceWith(h('button', {
        class: 'btn-icon danger-exit',
        title: 'Chiqish',
        onclick: openForfeitDialog,
      }, ['‹']));
    }
    wrap.appendChild(top);

    const bank = Number(view.stake || 0) * Math.max(1, Number(view.players?.length || 1));
    const commandItems = [
      ['↪', 'Stolni tark etish', openForfeitDialog],
      ['👥', 'Do\'stlar', () => navigate('friends')],
      ['🎁', 'Sovg\'a yuborish', () => navigate('friends')],
      ['?', 'Yordam', () => openAIChatModal(state.user, isPremium)],
      ['🚩', 'Shikoyat', openReportDialog],
    ];
    wrap.appendChild(h('aside', { class: `royal-game-left${commandPanelOpen ? ' open' : ''}` }, [
      h('button', {
        class: `royal-square-btn demo-menu-trigger${commandPanelOpen ? ' active' : ''}`,
        onclick: () => {
          sfx.play('click');
          commandPanelOpen = !commandPanelOpen;
          scheduleRender({ immediate: true });
        },
        title: 'Menyu',
      }, ['☰']),
      h('div', { class: 'royal-stake-box' }, [
        h('small', {}, ['Stavka:']),
        h('strong', {}, [`$ ${Number(view.stake || 0).toLocaleString()}`]),
        h('i', {}, []),
        h('small', {}, ['Bank:']),
        h('strong', { class: 'green' }, [`$ ${bank.toLocaleString()}`]),
      ]),
      commandPanelOpen ? h('div', { class: 'demo-command-panel' }, commandItems.map(([icon, label, onclick]) =>
        h('button', {
          class: 'demo-command-item',
          onclick: () => {
            commandPanelOpen = false;
            sfx.play('click');
            scheduleRender({ immediate: true });
            onclick();
          },
        }, [
          h('span', { class: 'demo-command-icon' }, [icon]),
          h('span', {}, [label]),
        ])
      )) : null,
    ]));

    const trumpText = view.trumpCard
      ? `${view.trumpCard.rank === 'T' ? '10' : view.trumpCard.rank}${SUIT_GLYPH[view.trumpCard.suit] || ''}`
      : (SUIT_GLYPH[view.trumpSuit] || '');
    wrap.appendChild(h('aside', { class: 'royal-game-right' }, [
      h('div', { class: 'royal-trump-card' }, [
        h('small', {}, ['Kozir']),
        h('strong', {}, [trumpText]),
      ]),
    ]));

    const reactionsPanel = renderReactionsPanel();
    if (reactionsPanel) wrap.appendChild(reactionsPanel);

    // Active turn panel
    const activePlayer = currentTurnPlayer(view);
    if (activePlayer && view.turnDeadline) {
      const remaining = Math.max(0, (view.turnDeadline - Date.now()) / 1000);
      const isMe = activePlayer.id === me?.id;
      const timerPanel = h('div', { class: `royal-turn-panel${isMe ? ' mine' : ''}` }, [
        makeTimerRing(remaining, turnTotalSeconds(view)),
        h('div', {}, [
          h('div', { class: 'royal-turn-label' }, [isMe ? tSafe('game.your_turn', 'Sizning navbatingiz') : tSafe('game.not_your_turn', 'Sizning navbatingiz emas')]),
          h('div', { class: 'royal-turn-name' }, [displayGameName(activePlayer)]),
        ]),
      ]);
      wrap.appendChild(timerPanel);

      // 5 soniya qolganda 1 marta warning sound
      if (isMe && remaining <= 5 && remaining > 0 && !warnedTimeout) {
        warnedTimeout = true;
        sfx.play('warning');
        setTimeout(() => { warnedTimeout = false; }, 8000);
      }
    }

    // ── Opponents ────────────────────────────────────────────────
    const oppCount = Math.min(opps.length, 5);
    const positions = OPP_POS[oppCount] || OPP_POS[1];
    const oppTable = h('div', { class: 'opp-table' });

    for (let i = 0; i < opps.length; i++) {
      const p = opps[i];
      const pos = positions[Math.min(i, positions.length - 1)];
      const pIdx = view.players.indexOf(p);
      const isAttacker = pIdx === view.attackerIdx;
      const isDefender = pIdx === view.defenderIdx;
      const isTurn = (view.phase === 'attacking' && isAttacker) || (view.phase === 'defending' && isDefender);

      const oppEl = h('div', {
        class: `opp-slot opp-${pos}${isTurn ? ' turn' : ''}`,
        'data-player-id': p.id,
      });

      // Card fan
      const fanCount = Math.min(p.handSize || 0, 6);
      const fan = h('div', { class: 'opp-cards-fan' });
      for (let j = 0; j < fanCount; j++) {
        const mc = h('div', { class: 'mini-card-back' });
        mc.style.transform = `rotate(${(j - (fanCount-1)/2) * 9}deg) translateY(${Math.abs((j - (fanCount-1)/2) * 1.5)}px)`;
        mc.style.left = `${j * 6 - (fanCount-1) * 3}px`;
        fan.appendChild(mc);
      }
      if ((p.handSize || 0) > 0) fan.appendChild(h('div', { class: 'hand-count-badge' }, [String(p.handSize)]));
      oppEl.appendChild(fan);

      // Avatar
      const avatarEl = renderPlayerAvatar(p, { dataPlayer: false });
      if (isDefender) avatarEl.appendChild(h('span', { class: 'role-badge' }, ['🛡']));
      if (isAttacker) avatarEl.appendChild(h('span', { class: 'role-badge' }, ['⚔']));
      if (isTurn && view.turnDeadline) {
        const remaining = Math.max(0, (view.turnDeadline - Date.now()) / 1000);
        avatarEl.appendChild(makeTimerRing(remaining, turnTotalSeconds(view)));
      }
      if (forfeitedId === p.id) {
        avatarEl.appendChild(h('span', { class: 'white-flag-badge' }, [
          h('i', {}, []),
          h('b', {}, [`-${formatGameMoney(view.stake)}`]),
        ]));
      }
      if (payoutByPlayer.get(p.id)) {
        avatarEl.appendChild(h('span', { class: 'mini-payout-pop' }, [`+${formatGameMoney(payoutByPlayer.get(p.id))}`]));
      } else if (view.phase === 'ended' && view.durakId === p.id) {
        avatarEl.appendChild(h('span', { class: 'mini-payout-pop loss' }, [`-${formatGameMoney(view.stake)}`]));
      }
      oppEl.appendChild(avatarEl);
      oppEl.appendChild(h('div', { class: 'opp-name' }, [displayGameName(p)]));

      if (typingByPlayer[p.id]) {
        oppEl.appendChild(makeTypingBubble());
      }
      if (speechByPlayer[p.id]) {
        oppEl.appendChild(makeSpeechBubble(p.id));
      }
      // Sticker for opponents: handled by floating bubbles via syncEphemeralFor

      if (isTurn) oppEl.appendChild(h('div', { class: 'turn-glow' }));

      oppTable.appendChild(oppEl);
    }
    wrap.appendChild(oppTable);

    // ── Center area ──────────────────────────────────────────────
    const centerArea = h('div', { class: 'center-area' });

    // Deck + trump
    const deckTrump = h('div', { class: 'deck-trump' });
    const deckRemaining = view.deckRemaining ?? view.deckSize ?? 0;
    if (deckRemaining > 0) {
      const stack = h('div', { class: 'deck-stack' }, [
        renderCard({ faceDown: true }, { extraClass: 'deck-card', skin: activeCardSkin }),
        renderCard({ faceDown: true }, { extraClass: 'deck-card', skin: activeCardSkin }),
        renderCard({ faceDown: true }, { extraClass: 'deck-card', skin: activeCardSkin }),
        h('div', { class: 'count-badge' }, [String(deckRemaining)]),
      ]);
      deckTrump.appendChild(stack);
      if (view.trumpCard) {
        const trumpCardEl = renderCard(view.trumpCard, { extraClass: 'trump-show', skin: activeCardSkin });
        deckTrump.appendChild(trumpCardEl);
      }
    } else {
      deckTrump.appendChild(h('div', {
        class: 'trump-suit-indicator',
        style: `color:${SUIT_RED(view.trumpSuit) ? '#dc2626' : '#0f172a'}`,
      }, [SUIT_GLYPH[view.trumpSuit]]));
    }
    centerArea.appendChild(deckTrump);

    // Discard pile
    if (view.discardSize > 0) {
      centerArea.appendChild(h('div', { class: 'col center', style: 'gap:3px' }, [
        h('div', { class: 'discard-pile' }),
        h('div', { class: 'discard-count' }, [`${view.discardSize}`]),
      ]));
    }

    // Table cards
    const tableCards = h('div', { class: 'table-cards' });
    for (const pair of view.table) {
      const pairEl = h('div', { class: 'table-pair' });
      const att = renderCard(pair.attack, { extraClass: 'card thrown', skin: activeCardSkin });
      pairEl.appendChild(att);
      if (pair.defense) pairEl.appendChild(renderCard(pair.defense, { extraClass: 'card def', skin: activeCardSkin }));
      tableCards.appendChild(pairEl);
    }
    centerArea.appendChild(tableCards);
    if (view.phase === 'ended' && forfeitInfo) {
      const quitter = view.players.find((p) => p.id === forfeitedId);
      centerArea.appendChild(h('div', { class: 'forfeit-settlement-effects' }, [
        h('div', { class: 'forfeit-flag-card' }, [
          h('span', { class: 'flag-shape' }, []),
          h('strong', {}, [`-${formatGameMoney(view.stake)}`]),
          h('small', {}, [quitter?.username || 'chiqdi']),
        ]),
        myPayout ? h('div', { class: 'settlement-bill' }, [`+${formatGameMoney(myPayout)}`]) : null,
      ].filter(Boolean)));
    }
    wrap.appendChild(centerArea);

    // ── Action bar ───────────────────────────────────────────────
    const canTake = isMyTurnDefender(me);
    const canPass = isMyTurnAttacker(me) && view.table.length > 0;
    const canAttemptSelected = !!selectedCard && canAttemptCardPlay(view, me);
    const bluffIdx = firstChallengeableBluff();
    const canBluff = !!(view.bluffEnabled && selectedCard && isMyTurnAttacker(me));
    const primaryAction = primaryActionState(me);
    if (primaryAction) {
      wrap.appendChild(h('button', {
        class: `demo-primary-action ${primaryAction.key}${primaryAction.enabled ? '' : ' disabled'}`,
        disabled: !primaryAction.enabled,
        onclick: primaryAction.onclick,
      }, [
        h('strong', {}, [primaryAction.label]),
        primaryAction.sub ? h('small', {}, [primaryAction.sub]) : null,
      ]));
    }
    wrap.appendChild(h('div', { class: 'royal-action-dock' }, [
      h('button', {
        class: `royal-table-action pass ${canPass ? '' : 'disabled'}`,
        onclick: () => canPass ? emitAction('pass') : toast(tSafe('game.not_your_turn', 'Sizning navbatingiz emas'), 'info'),
      }, [h('strong', {}, [tSafe('game.pass', "O'tkazish")]), h('small', {}, [tSafe('game.done', 'Tugadi')])]),
      h('button', {
        class: `royal-table-action take ${canTake ? '' : 'disabled'}`,
        onclick: () => canTake ? (sfx.play('take'), vibrate(18), emitAction('take')) : toast(tSafe('game.take_not_allowed', 'Hozir karta olish navbati emas'), 'info'),
      }, [h('strong', {}, [tSafe('game.take', 'Olish')]), h('small', {}, [tSafe('game.take', 'Olish')])]),
      h('button', {
        class: `royal-table-action hit ${canAttemptSelected ? '' : 'disabled'}`,
        onclick: () => canAttemptSelected ? playCard(selectedCard) : toast(tSafe('game.select_card_first', 'Avval yuradigan kartani tanlang'), 'info'),
      }, [h('strong', {}, [tSafe('game.play_card', 'Tashlash')]), h('small', {}, [tSafe('game.play_card', 'Tashlash')])]),
      view.bluffEnabled ? h('button', {
        class: `royal-table-action bluff ${canBluff ? '' : 'disabled'}`,
        onclick: () => canBluff ? bluffAttack(selectedCard) : toast('Bluff uchun avval kartani tanlang', 'info'),
      }, [h('strong', {}, ['ALDASH']), h('small', {}, ['Yopiq tashlash'])]) : null,
      view.bluffEnabled ? h('button', {
        class: `royal-table-action challenge ${bluffIdx >= 0 ? '' : 'disabled'}`,
        onclick: () => bluffIdx >= 0 ? challengeBluffAt(bluffIdx) : toast('Shubha qiladigan yopiq karta yo‘q', 'info'),
      }, [h('strong', {}, ['SHUBHA']), h('small', {}, ['Bluffni ochish'])]) : null,
    ].filter(Boolean)));

    const actionBar = h('div', { class: `action-bar${pref('pref_right_action', state.user) ? ' action-bar-right' : ''}` });
    if (isMyTurnDefender(me)) {
      actionBar.appendChild(h('button', {
        class: 'btn-done',
        onclick: () => { sfx.play('take'); vibrate(18); emitAction('take'); },
      }, [tSafe('game.take_button_short', 'Olaman')]));
    }
    if (isMyTurnAttacker(me) && view.table.length > 0) {
      actionBar.appendChild(h('button', {
        class: 'btn-secondary',
        style: 'font-size:15px;padding:13px 22px',
        onclick: () => { emitAction('pass'); },
      }, [tSafe('game.pass_done_short', 'Pas / Bitti')]));
    }
    wrap.appendChild(actionBar);

    // Commands now live in the compact left menu to keep the table open.

    // Perk reveal overlay
    if (perkReveal) renderPerkReveal();

    // ── Bottom info bar ──────────────────────────────────────────
    const myAvatar = renderPlayerAvatar(me || state.user, {
      mine: true,
      title: 'Stikerlar',
      onclick: () => openStickerPicker(),
      dataPlayer: true,
    });
    if (activePlayer?.id === me?.id && view.turnDeadline) {
      const remaining = Math.max(0, (view.turnDeadline - Date.now()) / 1000);
      myAvatar.appendChild(makeTimerRing(remaining, turnTotalSeconds(view)));
    }
    if (forfeitedId === me?.id) {
      myAvatar.appendChild(h('span', { class: 'white-flag-badge mine' }, [
        h('i', {}, []),
        h('b', {}, [`-${formatGameMoney(view.stake)}`]),
      ]));
    }
    if (myPayout) {
      myAvatar.appendChild(h('span', { class: 'mini-payout-pop mine' }, [`+${formatGameMoney(myPayout)}`]));
    } else if (view.phase === 'ended' && view.durakId === me?.id) {
      myAvatar.appendChild(h('span', { class: 'mini-payout-pop mine loss' }, [`-${formatGameMoney(view.stake)}`]));
    }
    if (speechByPlayer[me?.id]) {
      myAvatar.appendChild(makeSpeechBubble(me.id));
    }
    // Sticker for me: floating bubble, not inline (to avoid overflow:hidden clipping)
    wrap.appendChild(h('div', { class: 'bottom-info-bar' }, [
      h('div', { class: 'me-info' }, [
        myAvatar,
        h('div', {}, [
          h('div', { class: 'name-line' }, [displayGameName(me)]),
          h('div', { class: 'stat-line' }, [`💰 ${(state.user?.coins || 0) >= 1000 ? `${Math.round(state.user.coins/100)/10}K` : state.user?.coins || 0}`]),
        ]),
      ]),
      pref('pref_emotions', state.user) ? h('button', {
        class: 'btn-icon',
        onclick: () => openStickerPicker(),
        title: 'Stikerlar',
      }, ['🎨']) : null,
      h('div', { class: 'game-stat' }, [
        h('div', { class: 'num' }, [String(me?.hand?.length || 0)]),
        h('div', { class: 'muted', style: 'font-size:10px' }, ['kartalar']),
      ]),
    ].filter(Boolean)));

    // ── My hand ─────────────────────────────────────────────────
    const hand = h('div', { class: 'my-hand' });
    if (me?.hand) {
      const sorted = [...me.hand].sort((a, b) => {
        if (pref('pref_sort_value', state.user)) {
          if (a.value !== b.value) return a.value - b.value;
          if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        }
        const at = a.suit === view.trumpSuit ? 1 : 0;
        const bt = b.suit === view.trumpSuit ? 1 : 0;
        if (at !== bt) return at - bt;
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return a.value - b.value;
      });
      sorted.forEach((c, i) => {
        const isTrump = c.suit === view.trumpSuit;
        const canPlay = canAttemptCardPlay(view, me);
        const cardEl = renderCard(c, { extraClass: isTrump ? 'trump' : '', skin: activeCardSkin });
        cardEl.dataset.cardId = cardWireId(c);
        if (selectedCard && c.rank === selectedCard.rank && c.suit === selectedCard.suit) cardEl.classList.add('selected');
        if (dealingHand && !liteRender) {
          cardEl.classList.add('dealing');
          cardEl.style.animationDelay = `${i * 0.1}s`;
        }
        attachDragToPlay(cardEl, c, canPlay, me);
        cardEl.addEventListener('click', () => {
          if (cardEl.dataset.dragPlayed === '1') return;
          if (isMyTurnAttacker(me) || isMyTurnDefender(me)) {
            const cardId = c.rank + c.suit;
            if (pref('pref_double_tap', state.user)) {
              const now = Date.now();
              if (lastTapCardId === cardId && now - lastTapAt < 650) {
                lastTapCardId = null;
                lastTapAt = 0;
                playCard(c);
                return;
              }
              lastTapCardId = cardId;
              lastTapAt = now;
              selectCardFast(c);
              sfx.play('click');
              vibrate(8);
              toast('Yana bir marta bosing - karta yuradi', 'info', 900);
              return;
            }
            sfx.play('click');
            selectCardFast(c);
            vibrate(8);
            toast(tSafe('game.press_attack_hint', 'Endi URISH tugmasini bosing yoki kartani stolga suring'), 'info');
          } else {
            toast(tSafe('game.not_your_turn', 'Sizning navbatingiz emas'), 'error');
            sfx.play('error');
          }
        });
        hand.appendChild(cardEl);
      });
    }
    wrap.appendChild(hand);
    requestAnimationFrame(() => applyFanLayout(hand, { lite: liteRender }));

    // ── End game overlay ─────────────────────────────────────────
    if (view.phase === 'ended') {
      const winnerId = view.winnerOrder?.[0];
      const winner = view.players.find((p) => p.id === winnerId);
      const isDraw = !view.durakId;
      const isForfeitEnd = !!forfeitInfo;
      const quitter = view.players.find((p) => p.id === forfeitedId);
      const loser = view.players.find((p) => p.id === view.durakId);
      const payoutRows = (view.payoutShares || [])
        .filter((s) => s.playerId !== forfeitedId && Number(s.amount || 0) > 0);
      const resultRows = [
        ...payoutRows.map((s) => ({ ...s, amount: Number(s.amount || 0), kind: 'win' })),
        loser ? { playerId: loser.id, amount: -Number(view.stake || 0), kind: 'loss' } : null,
      ].filter(Boolean);
      const meWon = myPayout > 0 || (!isForfeitEnd && winner && winner.id === me?.id);
      const cls = meWon ? 'win' : (isDraw ? 'draw' : 'lose');
      const title = isDraw
        ? 'DURANG'
        : (isForfeitEnd ? `${displayGameName(quitter) || 'O\'yinchi'} chiqib ketdi` : (meWon ? 'G\'ALABA!' : (winner ? `${displayGameName(winner)} yutdi` : 'O\'YIN TUGADI')));

      const overlay = h('div', { class: `end-overlay${isForfeitEnd ? ' forfeit-end-overlay' : ''}` }, [
        h('div', { class: 'result-card' }, [
          h('h1', { class: `result-title ${cls}` }, [title]),
          h('p', { class: 'muted', style: 'margin-top:14px;font-size:14px' }, [
            isForfeitEnd
              ? `Tikilgan pul qolgan o'yinchilarga bo'lib berildi`
              : (view.durakId ? `Durak: ${view.players.find((p) => p.id === view.durakId)?.username || ''}` : ''),
          ]),
          meWon ? h('div', {
            class: 'demo-result-prize',
          }, [`+ ${formatGameMoney(myPayout || view.stake * view.players.length)}`]) : null,
          resultRows.length ? h('div', { class: 'payout-list demo-payout-list' }, resultRows.map((s) => {
            const p = view.players.find((pl) => pl.id === s.playerId);
            return h('div', { class: s.kind === 'loss' ? 'loss-row' : 'win-row' }, [
              h('span', {}, [displayGameName(p) || 'o‘yinchi']),
              h('b', {}, [`${s.amount > 0 ? '+' : ''}${formatGameMoney(s.amount)}`]),
            ]);
          })) : null,
          h('button', {
            class: 'btn-big green',
            style: 'margin-top:24px;max-width:280px',
            onclick: () => {
              sfx.play('click');
              showRoyalLoader({
                source: 'exit',
                variant: 'exit',
                title: 'NATIJA SAQLANMOQDA',
                subtitle: 'Bosh menyu ochilmoqda',
                status: 'Balans, reyting va natija yangilanmoqda',
                progress: 78,
                items: ['RESULT', 'COIN', 'RANK'],
              });
              navigate('home', {}, { silent: true });
              completeRoyalLoader('BOSH MENYU OCHILDI', 720, 'exit');
            },
          }, ['Bosh menyu']),
        ].filter(Boolean)),
      ]);
      wrap.appendChild(overlay);
      if (meWon && !confettiShown && pref('pref_reward_anim', state.user)) { confettiShown = true; dropWinnerConfetti(); }
    }

    if (stickerOpen) renderStickerPanel();
  }

  // Timer tick
  timerInterval = setInterval(() => {
    if (!view || view.phase === 'ended' || !view.turnDeadline) return;
    const remainingMs = view.turnDeadline - Date.now();
    if (remainingMs <= -800 && !timeoutPoked) {
      timeoutPoked = true;
      emitWithAck('game:poke-timeout', { code }, 2500)
        .then((gv) => {
          if (gv?.ok && gv.view) {
            view = gv.view;
            state.game = gv.view;
            scheduleRender();
          }
        })
        .catch(() => {});
    }
    const now = Date.now();
    if (!timerNodeCache.length || now - timerCacheAt > 2500) {
      timerNodeCache = Array.from(wrap.querySelectorAll('.opp-slot.turn .turn-timer, .bottom-info-bar .turn-timer, .royal-turn-panel .turn-timer'));
      timerCacheAt = now;
    }
    for (const ring of timerNodeCache) {
      if (!ring.isConnected) continue;
      const remaining = Math.max(0, (view.turnDeadline - now) / 1000);
      const fill = ring.querySelector('.timer-fill');
      const text = ring.querySelector('.timer-text');
      if (fill) {
        fill.style.strokeDashoffset = String(TIMER_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, remaining / turnTotalSeconds(view)))));
        fill.classList.toggle('urgent', remaining <= 5);
      }
      if (text) text.textContent = String(Math.max(0, Math.ceil(remaining)));
    }
  }, 1000);

  const cleanup = () => {
    if (timerInterval) clearInterval(timerInterval);
    stopPregameReadyClock();
    if (loadingWatchdog) clearTimeout(loadingWatchdog);
    if (perkRevealTimer) clearTimeout(perkRevealTimer);
    liveChatTimers.forEach((timer) => clearTimeout(timer));
    liveChatTimers.clear();
    if (_aiContextProvider) _aiContextProvider = null;
    if (renderFrame) cancelAnimationFrame(renderFrame);
    if (renderTimer) clearTimeout(renderTimer);
    if (onRuntimePrefChange) window.removeEventListener('imperia:pref-change', onRuntimePrefChange);
    stopVoice({ emitEnd: true });
    document.documentElement.classList.remove('game-perf-mode');
    document.querySelector('.game-sticker-sheet-bg')?.remove();
    timerNodeCache = [];
    socket.off('room:state', onRoomState);
    socket.off('chat:message', onChatMessage);
    socket.off('game:start', onGameStart);
    socket.off('game:move', onGameMove);
    socket.off('game:timeout', onGameTimeout);
    socket.off('game:forfeit', onGameForfeit);
    socket.off('game:end', onGameEnd);
    socket.off('spectator:state', onSpectatorState);
    if (isSpectating && params?.tournamentId && params?.matchId) {
      socket.emit('tournament:unwatch_match', {
        tournamentId: params.tournamentId,
        matchId: params.matchId,
      });
    }
    socket.off('player:speech', onPlayerSpeech);
    socket.off('player:typing', onPlayerTyping);
    socket.off('emoji:react', onEmojiReact);
    socket.off('sticker:show', onStickerShow);
    cleanAllFloatingStickerBubbles();
    socket.off('room:error', onRoomError);
    socket.off('voice:request', onVoiceRequest);
    socket.off('voice:accept', onVoiceAccept);
    socket.off('voice:offer', onVoiceOffer);
    socket.off('voice:answer', onVoiceAnswer);
    socket.off('voice:ice', onVoiceIce);
    socket.off('voice:reject', onVoiceReject);
    socket.off('voice:timeout', onVoiceTimeout);
    socket.off('voice:error', onVoiceError);
    socket.off('voice:end', onVoiceEnd);
    socket.off('game:action_confirm_request', onActionConfirmRequest);
    socket.off('game:action_confirm_waiting', onActionConfirmWaiting);
    socket.off('game:action_confirm_rejected', onActionConfirmRejected);
    socket.off('game:action_confirm_cancelled', onActionConfirmCancelled);
    socket.off('game:action_confirmed', onActionConfirmed);
    closeActionConfirmModal();
  };
  window.addEventListener('beforeunload', cleanup, { once: true });

  function renderChat() {
    const existing = wrap.querySelector('.chat-panel');
    if (existing) existing.remove();
    chatOpen = false;
  }

  function renderLiveChatFeed() {
    wrap.querySelector('.game-chat-feed')?.remove();
  }

  function renderPerkReveal() {
    const overlay = h('div', { class: 'perk-reveal', style: 'padding:14px;width:300px' });
    if (perkReveal.kind === 'peek_opponents' && perkReveal.opponents) {
      overlay.appendChild(h('div', { style: 'font-size:12px;margin-bottom:8px;color:var(--rc-gold-bright);font-weight:800' }, ['👁  Raqib qo\'llari']));
      for (const opp of perkReveal.opponents) {
        const row = h('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:5px' });
        row.appendChild(h('span', { style: 'min-width:70px;font-size:11px' }, [opp.username]));
        for (const c of opp.hand) row.appendChild(renderCard(c, { extraClass: 'mini', skin: currentCardSkin() }));
        overlay.appendChild(row);
      }
    } else if (perkReveal.kind === 'peek_next_card' && perkReveal.card) {
      overlay.appendChild(h('div', { style: 'font-size:12px;margin-bottom:8px;color:var(--rc-gold-bright);font-weight:800' }, ['🃏 Keyingi karta']));
      overlay.appendChild(renderCard(perkReveal.card, { skin: currentCardSkin() }));
    } else if (perkReveal.kind === 'best_move_hint' && perkReveal.hint) {
      const hint = perkReveal.hint;
      let text = 'Aniq yo\'l yo\'q';
      if (hint.action === 'wait_for_turn') text = t('game.perk_wait_turn');
      else if (hint.card) text = `${hint.action === 'defense' ? tSafe('game.hint_defend_prefix', 'Uring: ') : tSafe('game.hint_attack_prefix', 'Yurish: ')}${hint.card.rank === 'T' ? '10' : hint.card.rank}${SUIT_GLYPH[hint.card.suit]}`;
      else if (hint.action === 'take') text = 'Eng yaxshi: olish';
      else if (hint.action === 'pass') text = t('game.perk_best_pass');
      overlay.appendChild(h('div', { style: 'font-size:14px;font-weight:700' }, ['🧠 ' + text]));
    }
    overlay.appendChild(h('button', {
      class: 'btn-secondary',
      style: 'margin-top:10px;width:100%;padding:8px',
      onclick: () => { perkReveal = null; scheduleRender(); },
    }, ['Yopish']));
    wrap.appendChild(overlay);
  }

  function openStickerPicker() {
    if (!pref('pref_emotions', state.user)) {
      toast('Emotsiyalar o\u2018chirilgan', 'info');
      return;
    }
    resetCardTouchState();
    sfx.play('click');
    stickerOpen = !(stickerOpen && !chatOpen);
    chatOpen = false;
    reactionsOpen = false;
    renderChat();
    refreshReactionsPanel();
    renderStickerPanel();
  }

  function renderStickerPanel() {
    const existing = wrap.querySelector('.sticker-picker.game-sticker-sheet');
    if (existing) existing.remove();
    if (!stickerOpen) return;

    const closeSheet = () => {
      stickerOpen = false;
      wrap.querySelector('.sticker-picker.game-sticker-sheet')?.remove();
    };
    const panel = h('div', { class: 'sticker-picker game-sticker-sheet' }, [
      h('div', { class: 'game-sticker-sheet-head' }, [
        h('div', {}, [
          h('b', {}, ['Stickerlar']),
          h('small', {}, ['Oddiy bepul va olingan stickerlar']),
        ]),
        h('button', { class: 'chat-close-btn', onclick: closeSheet }, ['×']),
      ]),
    ]);
    const grid = h('div', { class: 'game-sticker-grid' }, [
      h('div', { class: 'game-sticker-loading' }, ['Yuklanmoqda...']),
    ]);
    panel.appendChild(grid);
    panel.appendChild(h('button', {
      class: 'btn-secondary',
      style: 'margin-top:10px;width:100%',
      onclick: closeSheet,
    }, ['Yopish']));
    wrap.appendChild(panel);

    const fillGrid = (packs = []) => {
      grid.innerHTML = '';
      const available = withStarterStickerPack(packs)
        .filter((p) => Number(p.owned || 0) > 0 || Number(p.priceGold || 0) === 0)
        .filter((p) => Array.isArray(p.stickers) && p.stickers.length);
      if (!available.length) {
        grid.appendChild(h('div', { class: 'game-sticker-loading' }, [
          'Avval do\'kondan sticker pack oling',
          h('button', { class: 'btn-secondary mt-16', onclick: () => { closeSheet(); navigate('shop'); } }, ["Do'konga o'tish"]),
        ]));
        return;
      }
      for (const pack of available) {
        for (const s of (pack.stickers || [])) {
          const stickerNo = String(s.name || s.id || '').match(/#?(\d+)$/)?.[1] || String((pack.stickers || []).indexOf(s) + 1);
          const initials = String(pack.name || 'ST').replace(/[^a-z0-9]+/gi, ' ').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'ST';
          grid.appendChild(h('button', {
            class: 'game-sticker-btn',
            style: {
              '--sticker-color': pack.themeColor || '#e0b15d',
              '--sticker-panel': pack.panelColor || 'rgba(10,18,26,.95)',
            },
            title: s.name || `${pack.name || 'Sticker'} #${stickerNo}`,
            onclick: async (event) => {
              const btn = event.currentTarget;
              if (btn?.disabled) return;
              if (btn) {
                btn.disabled = true;
                btn.classList.add('is-sending');
              }
              sfx.play('click');
              try {
                const result = await api.stickerSend(s.id, code);
                closeSheet();
                if (result?.sticker?.img) onStickerShow(result.sticker);
              } catch (err) {
                if (btn) {
                  btn.disabled = false;
                  btn.classList.remove('is-sending');
                }
                toast(err.message || 'Stiker yuborilmadi', 'error');
              }
            },
          }, [
            h('span', { class: 'game-sticker-fallback' }, [
              h('b', {}, [initials]),
              h('i', {}, [`#${stickerNo}`]),
            ]),
            h('img', {
              src: s.img,
              alt: s.name || `${pack.name || 'Sticker'} #${stickerNo}`,
              loading: 'lazy',
              onload: (e) => e.currentTarget.closest('.game-sticker-btn')?.classList.add('has-sticker-img'),
              onerror: (e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.closest('.game-sticker-btn')?.classList.add('broken-sticker-img');
              },
            }),
            h('small', {}, [`#${stickerNo}`]),
          ]));
        }
      }
    };

    if (stickerInventoryCache && Date.now() - stickerInventoryCacheAt < 15000) {
      fillGrid(stickerInventoryCache);
      return;
    }
    if (stickerInventoryError) {
      grid.innerHTML = '';
      grid.appendChild(h('div', { class: 'game-sticker-loading' }, [stickerInventoryError]));
      return;
    }
    if (!stickerInventoryLoading) {
      stickerInventoryLoading = true;
      Promise.all([
        api.stickerInventory().catch(() => []),
        api.stickerFree ? api.stickerFree().catch(() => []) : Promise.resolve([]),
      ])
        .then(([ownedPacks, freePacks]) => {
          const byId = new Map();
          for (const pack of withStarterStickerPack([...(freePacks || []), ...(ownedPacks || [])])) {
            byId.set(pack.id, { ...(byId.get(pack.id) || {}), ...pack, owned: Math.max(Number(pack.owned || 0), Number(pack.priceGold || 0) === 0 ? 1 : 0) });
          }
          stickerInventoryCache = Array.from(byId.values());
          stickerInventoryCacheAt = Date.now();
          stickerInventoryError = '';
        })
        .catch((err) => {
          stickerInventoryError = err.message || 'Stikerlar yuklanmadi';
        })
        .finally(() => {
          stickerInventoryLoading = false;
          if (stickerOpen) renderStickerPanel();
        });
    }
  }

  render();
  return cleanup;
}

// ── Helpers ──────────────────────────────────────────────────────────
function labelBlock(label, child) {
  return h('div', { style: 'margin-bottom:10px' }, [
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:5px' }, [label]),
    child,
  ]);
}

function selectFromList(pairs, onChange) {
  const sel = document.createElement('select');
  pairs.forEach(([v, label]) => {
    const op = document.createElement('option');
    op.value = v; op.textContent = label;
    sel.appendChild(op);
  });
  sel.addEventListener('change', (e) => onChange(e.target.value));
  return sel;
}


function emojiLabelFromPack(packId, emojiId) {
  const pool = ['😀','😃','😄','😁','😆','😅','😂','🙂','😉','😍','😘','😎','🤩','😏','😮','😢','😡','😈','🥳','🤯','👏','👍','👎','🔥','💎','👑','⭐','🎉','🎯','🏆'];
  const idx = Math.max(1, Number(String(emojiId || '').split('_').pop() || 1)) - 1;
  return pool[idx % pool.length];
}
// ═══════════════════════════════════════════════════════════════════════
// BAND 30: Ovozli chat moduli — 1v1, 10 o'yindan keyin, tasdiq kerak
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ovozli chat boshqaruvchisi
 * - Faqat 1v1 o'yinda ishlaydi
 * - 10 ta o'yindan keyin ochiladi
 * - Premium: cheksiz; Oddiy: kuniga 3 o'yin davomida
 * - "Ovoz yoqish" so'rovi → sherik tasdiq → ikkala tomonda yoqiladi
 * - Istalgan tomon o'chirsa — ikkala tomonda o'chadi
 */
export class VoiceChatManager {
  constructor(socket, roomCode, user) {
    this.socket = socket;
    this.roomCode = roomCode;
    this.user = user;
    this.localStream = null;
    this.peerConnection = null;
    this.active = false;
    this.requesting = false;
    this.pendingIce = [];
    this.requestTimer = null;
    this._ui = null;

    // Socket events
    this._onVoiceRequest = this._onVoiceRequest.bind(this);
    this._onVoiceAccept  = this._onVoiceAccept.bind(this);
    this._onVoiceOffer   = this._onVoiceOffer.bind(this);
    this._onVoiceAnswer  = this._onVoiceAnswer.bind(this);
    this._onVoiceIce     = this._onVoiceIce.bind(this);
    this._onVoiceReject  = this._onVoiceReject.bind(this);
    this._onVoiceTimeout = this._onVoiceTimeout.bind(this);
    this._onVoiceError   = this._onVoiceError.bind(this);
    this._onVoiceEnd     = this._onVoiceEnd.bind(this);

    socket.on('voice:request', this._onVoiceRequest);
    socket.on('voice:accept',  this._onVoiceAccept);
    socket.on('voice:offer',   this._onVoiceOffer);
    socket.on('voice:answer',  this._onVoiceAnswer);
    socket.on('voice:ice',     this._onVoiceIce);
    socket.on('voice:reject',  this._onVoiceReject);
    socket.on('voice:timeout', this._onVoiceTimeout);
    socket.on('voice:error',   this._onVoiceError);
    socket.on('voice:end',     this._onVoiceEnd);
  }

  // Ovozli chat tugmasini render qilish
  renderButton(container, gameStats = {}) {
    const totalGames = gameStats.totalGames || Number(this.user?.games_played || 0);
    const isPremium = this.user?.premium_until && new Date(this.user.premium_until) > new Date();
    const dailyCount = Number(gameStats.dailyVoiceCount || 0);

    // 10 o'yindan keyin ochiladi
    const unlocked = totalGames >= 10;
    const limitReached = !isPremium && dailyCount >= 3;

    if (this._ui) this._ui.remove();

    const btn = document.createElement('button');
    btn.className = 'voice-btn' + (this.active ? ' active' : '') + (!unlocked ? ' locked' : '');
    btn.style.cssText = `
      display:flex;align-items:center;gap:6px;padding:8px 14px;
      border-radius:20px;border:2px solid ${this.active ? '#9be7a8' : 'rgba(216,179,95,.4)'};
      background:${this.active ? 'rgba(27,131,76,.3)' : 'rgba(0,0,0,.4)'};
      color:${this.active ? '#9be7a8' : '#f4e2b3'};font-size:13px;font-weight:700;
      cursor:${unlocked && !limitReached ? 'pointer' : 'not-allowed'};
    `;

    if (!unlocked) {
      btn.innerHTML = `🔒 Ovoz chat (${totalGames}/10)`;
    } else if (limitReached) {
      btn.innerHTML = `🎙️ Limit: 3/kun`;
    } else if (this.active) {
      btn.innerHTML = `🔴 Ovoz o'chirish`;
    } else if (this.requesting) {
      btn.innerHTML = `⏳ So'rov yuborildi...`;
    } else {
      btn.innerHTML = `🎙️ Ovoz yoqish`;
    }

    btn.onclick = () => {
      if (!unlocked) { this._toast('Ovoz chat 10 ta o\'yindan keyin ochiladi 🔒', 'info'); return; }
      if (limitReached) { this._toast('Kunlik limit: 3 ta o\'yin davomida. Premium oling!', 'info'); return; }
      if (this.active) this.endVoice();
      else this.requestVoice();
    };

    container.appendChild(btn);
    this._ui = btn;
    return btn;
  }

  // Ovoz so'rovi yuborish
  requestVoice() {
    this.requesting = true;
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = setTimeout(() => {
      if (!this.requesting) return;
      this.socket.emit('voice:end', { code: this.roomCode, reason: 'request-timeout' });
      this._cleanup();
      this._toast('Ovozli chat so‘rovi javobsiz qoldi', 'info');
    }, VOICE_REQUEST_TIMEOUT_MS);
    this.socket.emit('voice:request', { code: this.roomCode }, (res) => {
      if (res?.ok) return;
      this._cleanup();
      this._toast(res?.error || 'Ovozli chat ochilmadi', 'error');
    });
    this._toast('🎙️ Ovoz so\'rovi yuborildi. Sherik javobini kuting...', 'info');
    if (this._ui) this._ui.innerHTML = '⏳ So\'rov yuborildi...';
  }

  // Kirib kelgan so'rov
  _onVoiceRequest(data) {
    const fromName = data.fromName || 'Raqib';
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9998;
      display:flex;align-items:center;justify-content:center;
    `;
    overlay.innerHTML = `
      <div style="background:linear-gradient(180deg,#1a2640,#0d1424);border:2px solid rgba(216,179,95,.5);
                  border-radius:20px;padding:28px;text-align:center;max-width:280px;gap:16px;display:flex;flex-direction:column">
        <div style="font-size:36px">🎙️</div>
        <div style="color:#f8e4a0;font-size:16px;font-weight:900">${fromName}</div>
        <div style="color:#f4e2b3;font-size:13px">Ovozli suhbat so'ramoqda</div>
        <div style="display:flex;gap:12px;justify-content:center">
          <button id="voice-accept" style="flex:1;padding:12px;background:#1d834c;border:none;border-radius:12px;color:#fff;font-size:15px;font-weight:900;cursor:pointer">✓ Qabul</button>
          <button id="voice-reject" style="flex:1;padding:12px;background:#7a1320;border:none;border-radius:12px;color:#fff;font-size:15px;font-weight:900;cursor:pointer">✗ Rad</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#voice-accept').onclick = () => {
      overlay.remove();
      this.socket.emit('voice:accept', { code: this.roomCode });
      this._startVoice(false);
    };
    overlay.querySelector('#voice-reject').onclick = () => {
      overlay.remove();
      this.socket.emit('voice:reject', { code: this.roomCode });
    };

    // 30 soniya timeout
    setTimeout(() => { if (overlay.parentNode) { overlay.remove(); this.socket.emit('voice:reject', { code: this.roomCode }); } }, VOICE_REQUEST_TIMEOUT_MS);
  }

  _onVoiceAccept() {
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = null;
    this.requesting = false;
    this._startVoice(true);
  }

  async _startVoice(isInitiator) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      const config = { iceServers: voiceIceServers() };
      this.peerConnection = new RTCPeerConnection(config);

      for (const track of this.localStream.getTracks()) {
        this.peerConnection.addTrack(track, this.localStream);
      }

      this.peerConnection.onicecandidate = (e) => {
        if (e.candidate) this.socket.emit('voice:ice', { code: this.roomCode, candidate: e.candidate });
      };

      this.peerConnection.ontrack = (e) => {
        const audio = document.createElement('audio');
        audio.srcObject = e.streams[0];
        audio.autoplay = true;
        audio.id = 'voice-remote-audio';
        sfx.applyVoiceAudio?.(audio);
        document.body.appendChild(audio);
      };

      this.peerConnection.onconnectionstatechange = () => {
        if (this.peerConnection?.connectionState === 'failed') this.endVoice();
      };
      this.peerConnection.oniceconnectionstatechange = () => {
        if (this.peerConnection?.iceConnectionState === 'failed') this.endVoice();
      };

      if (isInitiator) {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        this.socket.emit('voice:offer', { code: this.roomCode, offer });
      }

      this.active = true;
      if (this._ui) this._ui.innerHTML = '🔴 Ovoz o\'chirish';
      this._toast('🎙️ Ovozli suhbat boshlandi!', 'success');
    } catch (e) {
      this._toast('Mikrofonga ruxsat yo\'q: ' + (e.message || 'Xatolik'), 'error');
      this.socket.emit('voice:end', { code: this.roomCode, reason: 'media-error' });
      this._cleanup();
    }
  }

  async _onVoiceOffer(data) {
    try {
      if (!this.peerConnection) await this._startVoice(false);
      if (!this.peerConnection) return;
      await this.peerConnection.setRemoteDescription(data.offer);
      await this._flushIce();
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      this.socket.emit('voice:answer', { code: this.roomCode, answer });
    } catch (_) {
      this.endVoice();
    }
  }

  async _onVoiceAnswer(data) {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(data.answer);
    await this._flushIce();
  }

  async _onVoiceIce(data) {
    if (!data?.candidate) return;
    if (!this.peerConnection?.remoteDescription) {
      this.pendingIce.push(data.candidate);
      return;
    }
    try { await this.peerConnection.addIceCandidate(data.candidate); } catch (_) {}
  }

  async _flushIce() {
    if (!this.peerConnection?.remoteDescription) return;
    const queue = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of queue) {
      try { await this.peerConnection.addIceCandidate(candidate); } catch (_) {}
    }
  }

  _onVoiceReject() {
    this._cleanup();
    this._toast('Ovozli chat rad etildi', 'info');
  }

  _onVoiceTimeout() {
    this._cleanup();
    this._toast('Ovozli chat so‘rovi javobsiz qoldi', 'info');
  }

  _onVoiceError(data = {}) {
    this._cleanup();
    this._toast(data.error || 'Ovozli chat xatosi', 'error');
  }

  // Istalgan tomon o'chirsa — ikkala tomonda o'chadi (Band 30)
  _onVoiceEnd() {
    this._cleanup();
    this._toast('🎙️ Ovozli suhbat tugatildi', 'info');
  }

  endVoice() {
    this.socket.emit('voice:end', { code: this.roomCode, reason: 'client-cleanup' });
    this._cleanup();
    this._toast('🎙️ Ovoz o\'chirildi', 'info');
  }

  _cleanup() {
    this.active = false;
    this.requesting = false;
    this.pendingIce = [];
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = null;
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    if (this.peerConnection) { try { this.peerConnection.close(); } catch (_) {} this.peerConnection = null; }
    const remoteAudio = document.getElementById('voice-remote-audio');
    if (remoteAudio) remoteAudio.remove();
    if (this._ui) this._ui.innerHTML = '🎙️ Ovoz yoqish';
  }

  destroy() {
    this.endVoice();
    this.socket.off('voice:request', this._onVoiceRequest);
    this.socket.off('voice:accept',  this._onVoiceAccept);
    this.socket.off('voice:offer',   this._onVoiceOffer);
    this.socket.off('voice:answer',  this._onVoiceAnswer);
    this.socket.off('voice:ice',     this._onVoiceIce);
    this.socket.off('voice:reject',  this._onVoiceReject);
    this.socket.off('voice:timeout', this._onVoiceTimeout);
    this.socket.off('voice:error',   this._onVoiceError);
    this.socket.off('voice:end',     this._onVoiceEnd);
  }

  _toast(msg, type) {
    if (typeof window !== 'undefined') {
      const ev = new CustomEvent('imperiaToast', { detail: { msg, type } });
      window.dispatchEvent(ev);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature 24: openAIChatModal — AI Yordamchi chat oynasi
// ─────────────────────────────────────────────────────────────────────────────
function cardLabel(card) {
  if (!card) return '';
  return `${card.rank === 'T' ? '10' : card.rank}${SUIT_GLYPH[card.suit] || card.suit || ''}`;
}

function lowestCard(cards = []) {
  return [...cards].sort((a, b) => (a.value || 0) - (b.value || 0))[0] || null;
}

function buildMoveSuggestion(view, me) {
  if (!view || !me?.hand || view.phase === 'ended') return 'Oyin tugagan yoki qolingiz korinmayapti.';
  const hand = me.hand || [];
  const isDefender = view.players?.[view.defenderIdx]?.id === me.id;
  const isAttacker = view.players?.[view.attackerIdx]?.id === me.id || (view.throwInMode === 'all' && view.players?.[view.defenderIdx]?.id !== me.id);
  if (view.phase === 'defending' && isDefender) {
    const open = [...(view.table || [])].reverse().find((pair) => pair.attack && !pair.defense);
    const attack = open?.attack;
    if (!attack) return 'Hozir urilmagan karta yoq.';
    const sameSuit = hand.filter((c) => c.suit === attack.suit && (c.value || 0) > (attack.value || 0));
    const trumps = attack.suit === view.trumpSuit ? [] : hand.filter((c) => c.suit === view.trumpSuit);
    const card = lowestCard(sameSuit.length ? sameSuit : trumps);
    return card
      ? `Himoyada ${cardLabel(card)} bilan ${cardLabel(attack)} ni uring. Kozirni zarur bolmasa saqlang.`
      : tSafe('game.hint_take_better', `${cardLabel(attack)} ni uradigan karta yoq. Olish yaxshiroq, keyin kichik kartalarni chiqarishga harakat qiling.`, { card: cardLabel(attack) });
  }
  if (view.phase === 'attacking' && isAttacker) {
    const ranks = new Set();
    for (const pair of view.table || []) {
      if (pair.attack?.rank) ranks.add(pair.attack.rank);
      if (pair.defense?.rank) ranks.add(pair.defense.rank);
    }
    const legal = ranks.size ? hand.filter((c) => ranks.has(c.rank)) : hand;
    const nonTrump = legal.filter((c) => c.suit !== view.trumpSuit);
    const card = lowestCard(nonTrump.length ? nonTrump : legal);
    return card
      ? `Hujumda ${cardLabel(card)} ni yurish yaxshi: kichik kartani chiqarasiz va koziringizni saqlaysiz.`
      : 'Hozir mos karta yoq. Stol yopilsa yoki navbat ozgarsa kuting.';
  }
  const active = currentTurnPlayer(view);
  return `Hozir sizning navbatingiz emas. Navbat ${active?.nickname || active?.username || 'raqib'} da, raqib kartalar sonini kuzating.`;
}

function buildAIContext(view, user) {
  if (!view) return null;
  const me = view.players?.find((p) => p.hand) || null;
  const active = currentTurnPlayer(view);
  return {
    phase: view.phase,
    roomCode: view.code,
    trumpSuit: view.trumpSuit,
    trumpCard: cardLabel(view.trumpCard),
    deckRemaining: view.deckRemaining ?? view.deckSize ?? 0,
    discardSize: view.discardSize || 0,
    stake: view.stake || 0,
    myName: me?.nickname || me?.username || user?.username || 'guest',
    myCards: (me?.hand || []).map(cardLabel),
    myCardCount: me?.hand?.length || 0,
    activePlayer: active?.nickname || active?.username || '',
    attacker: view.players?.[view.attackerIdx]?.nickname || view.players?.[view.attackerIdx]?.username || '',
    defender: view.players?.[view.defenderIdx]?.nickname || view.players?.[view.defenderIdx]?.username || '',
    table: (view.table || []).map((pair) => ({
      attack: cardLabel(pair.attack),
      defense: cardLabel(pair.defense),
    })),
    players: (view.players || []).map((p) => ({
      name: p.nickname || p.username,
      cards: p.hand ? p.hand.length : (p.handSize || 0),
      isMe: p.id === me?.id,
    })),
    suggestion: buildMoveSuggestion(view, me),
  };
}

let _aiModalOpen = false;
let _aiMessages  = [];      // [{role:'user'|'ai', text, id}]
let _aiTyping    = false;
let _aiReady     = false;
let _aiMsgIdSeq  = 0;
let _aiUsage     = { limit: 30, remaining: 30, isPremium: false };
let _aiContextProvider = null;

function _renderAIModal(user, isPremium) {
  const existing = document.getElementById('ai-chat-modal-bg');
  if (existing) existing.remove();
  if (!_aiModalOpen) return;

  const userId   = user?.id || 'guest';
  const limit    = Number(_aiUsage.limit || 30);
  const remaining = isPremium ? '∞' : Math.max(0, Number(_aiUsage.remaining ?? limit));
  const limitBar = isPremium
    ? h('div', { class: 'ai-limit-bar premium' }, ['⭐ Premium — Cheksiz so\'rovlar'])
    : h('div', { class: 'ai-limit-bar' }, [
        h('span', {}, [`📊 ${remaining}/${limit} so'rov qoldi`]),
        remaining === 0 ? h('button', {
          class: 'ai-upgrade-btn',
          onclick: () => { _aiModalOpen = false; _renderAIModal(user, isPremium); navigate('shop'); },
        }, ['⭐ Premium']) : null,
      ].filter(Boolean));

  const msgEls = _aiMessages.map(m =>
    h('div', { class: `ai-msg ai-msg-${m.role}`, key: m.id }, [
      m.role === 'ai' ? h('span', { class: 'ai-avatar' }, ['🤖']) : null,
      h('div', { class: 'ai-bubble' }, [m.text]),
      m.role === 'user' ? h('span', { class: 'ai-avatar ai-avatar-user' }, ['👤']) : null,
    ].filter(Boolean))
  );

  if (_aiTyping) {
    msgEls.push(h('div', { class: 'ai-msg ai-msg-ai' }, [
      h('span', { class: 'ai-avatar' }, ['🤖']),
      h('div', { class: 'ai-bubble ai-typing' }, [
        h('span', {}, ['.']), h('span', {}, ['.']), h('span', {}, ['.']),
      ]),
    ]));
  }

  const modal = h('div', { id: 'ai-chat-modal-bg', class: 'ai-chat-modal-bg', onclick: (e) => {
    if (e.target.id === 'ai-chat-modal-bg') { _aiModalOpen = false; _renderAIModal(user, isPremium); }
  }}, [
    h('div', { class: 'ai-chat-modal' }, [
      // Header
      h('div', { class: 'ai-chat-header' }, [
        h('div', { class: 'ai-chat-title' }, [
          h('span', { class: 'ai-chat-icon' }, ['🤖']),
          h('div', {}, [
            h('div', { class: 'ai-chat-name' }, ['Imperia AI']),
            h('div', { class: 'ai-chat-status' }, [
              _aiReady
                ? h('span', { class: 'ai-online' }, ['● Tayyor'])
                : h('span', { class: 'ai-loading' }, ['○ Yuklanmoqda…']),
            ]),
          ]),
        ]),
        h('button', { class: 'ai-close-btn', onclick: () => {
          _aiModalOpen = false; _renderAIModal(user, isPremium);
        }}, ['✕']),
      ]),
      // Limit bar
      limitBar,
      // Messages
      h('div', { class: 'ai-messages', id: 'ai-messages-list' }, [
        _aiMessages.length === 0 && !_aiTyping
          ? h('div', { class: 'ai-welcome' }, [
              h('div', { class: 'ai-welcome-icon' }, ['🤖']),
              h('div', { class: 'ai-welcome-title' }, ['Assalomu alaykum!']),
              h('div', { class: 'ai-welcome-text' }, ['O\'yin qoidalari, premium, baraban yoki do\'kon haqida savol bering!']),
              h('div', { class: 'ai-quick-btns' }, [
                '🃏 Qoidalar', '⭐ Premium', '🎰 Baraban', '🔗 Referal', '🏆 Turnir',
              ].map(label => h('button', {
                class: 'ai-quick-btn',
                onclick: () => _sendAIMessage(label.replace(/^\S+\s/, ''), user, isPremium),
              }, [label]))),
            ])
          : null,
        ...msgEls,
      ]),
      // Input
      h('div', { class: 'ai-input-bar' }, [
        h('input', {
          class: 'ai-input',
          type: 'text',
          placeholder: 'Savol yozing…',
          maxlength: '300',
          disabled: _aiTyping,
          onkeydown: (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              _sendAIMessage(e.target.value, user, isPremium);
            }
          },
        }, []),
        h('button', {
          type: 'button',
          class: `ai-send-btn${_aiTyping ? ' disabled' : ''}`,
          disabled: _aiTyping,
          onclick: () => {
            const inp = modal.querySelector('.ai-input');
            if (inp) _sendAIMessage(inp.value, user, isPremium);
          },
        }, ['➤']),
      ]),
    ]),
  ]);

  document.body.appendChild(modal);
  // Auto-scroll messages
  requestAnimationFrame(() => {
    const list = document.getElementById('ai-messages-list');
    if (list) list.scrollTop = list.scrollHeight;
    const inp = modal.querySelector('.ai-input');
    if (inp) inp.focus();
  });
}

async function _sendAIMessage(text, user, isPremium) {
  text = (text || '').trim();
  if (!text || _aiTyping) return;

  const userId = user?.id || 'guest';
  const input = document.getElementById('ai-chat-modal-bg')?.querySelector('.ai-input');
  if (input) input.value = '';

  // Add user message
  _aiMessages.push({ role: 'user', text, id: ++_aiMsgIdSeq });
  _aiTyping = true;
  _renderAIModal(user, isPremium);

  // Placeholder bot message that streams in
  const botMsgId = ++_aiMsgIdSeq;
  _aiMessages.push({ role: 'ai', text: '', id: botMsgId });

  let lastText = '';
  try {
    const usage = await api.aiConsume();
    if (usage) _aiUsage = { ..._aiUsage, ...usage };
  } catch (e) {
    const idx = _aiMessages.findIndex(m => m.id === botMsgId);
    if (idx !== -1) _aiMessages[idx].text = e.message || "Siz bugungi so'rovlaringizni tugatdingiz.";
    _aiTyping = false;
    _renderAIModal(user, isPremium);
    return;
  }
  const gameContext = typeof _aiContextProvider === 'function' ? _aiContextProvider() : null;
  await askAI(text, userId, isPremium, (partial, done) => {
    lastText = partial;
    const msg = _aiMessages.find(m => m.id === botMsgId);
    if (msg) msg.text = partial;
    if (done) {
      _aiTyping = false;
    }
    // Throttle re-render
    const list = document.getElementById('ai-messages-list');
    if (list) {
      const last = list.lastElementChild;
      if (last) {
        const bubble = last.querySelector('.ai-bubble');
        if (bubble) {
          // Format markdown bold **text** → <strong>
          bubble.innerHTML = partial
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
        }
        list.scrollTop = list.scrollHeight;
      }
    }
    if (done) _renderAIModal(user, isPremium);
  }, gameContext);
}

function openAIChatModal(user, isPremium) {
  _aiModalOpen = true;
  _renderAIModal(user, isPremium);
  api.aiUsage().then((usage) => {
    _aiUsage = { ..._aiUsage, ...usage };
    _renderAIModal(user, isPremium || !!usage?.isPremium);
  }).catch(() => {});

  // Lazy-init AI on first open
  if (!_aiReady) {
    initAI((progress, text) => {
      if (progress >= 1) {
        _aiReady = true;
        _renderAIModal(user, isPremium);
      }
    }).then(() => {
      _aiReady = true;
      _renderAIModal(user, isPremium);
    }).catch(() => {
      _aiReady = true; // rule-based is always ready
      _renderAIModal(user, isPremium);
    });
  }
}
