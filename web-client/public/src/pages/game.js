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
import { renderCard, SUIT_GLYPH, SUIT_RED, avatarColorFor, avatarLetter } from '../cards.js?v=160-curated-card-skins';
import { t } from '../i18n.js';
import { sfx } from '../sfx.js?v=111-encoding-fix';
import { initAI, askAI, isLimitReached, remainingToday } from '../services/aiChat.js?v=44-ai-tournament-rank';
import { pref, prefValue, vibrate } from '../preferences.js?v=111-encoding-fix';
import { completeRoyalLoader, hideRoyalLoader, showRoyalLoader, updateRoyalLoader } from '../royalLoading.js?v=129-royal-loader-clean';

const OPP_POS = { 1: ['top-c'], 2: ['top-l','top-r'], 3: ['top-l','top-c','top-r'], 4: ['top-l','top-c','top-r','top-l'], 5: ['top-l','top-c','top-r','top-l','top-r'] };

const PERKS = [
  { id: 'peek_opponents', label: 'Qo\'llarni ko\'r', icon: '👁', cost: 3 },
  { id: 'peek_next_card', label: 'Keyingi karta', icon: '🃏', cost: 1 },
  { id: 'best_move_hint', label: 'Maslahat',     icon: '🧠', cost: 1 },
];

const REPORT_REASONS = [
  { id: 'cheating', label: 'Aldash' },
  { id: 'abuse',    label: 'Haqorat' },
  { id: 'spam',     label: 'Spam' },
  { id: 'other',    label: 'Boshqa' },
];
const DEFAULT_TURN_SECONDS = 30;
const CARD_THROW_COMMIT_MS = 80;
const SPEECH = { take: 'Olaman', pass: 'Pas', defended: 'Urdim', attack: 'Mana!' };
const CONFETTI_SYMBOLS = ['🎉','⭐','✨','🏆','💫','🎊','🎯','💎'];
const TIMER_CIRCUMFERENCE = 88;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function applyFanLayout(handEl) {
  const cards = Array.from(handEl.querySelectorAll('.card'));
  const n = cards.length;
  if (n === 0) return;
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

function dropWinnerConfetti() {
  const container = document.body;
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.className = 'fall-emoji';
    el.textContent = CONFETTI_SYMBOLS[Math.floor(Math.random() * CONFETTI_SYMBOLS.length)];
    el.style.left = `${Math.random() * 100}%`;
    el.style.fontSize = `${24 + Math.random() * 24}px`;
    el.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    el.style.animationDelay = `${Math.random() * 0.9}s`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

/** Qaysi kartalar berilgan attackni urishi mumkin */
function highlightableCards(view, me) {
  if (!view || !me?.hand) return new Set();
  const result = new Set();
  const isDefender = view.players[view.defenderIdx]?.id === me.id;
  const isAttacker = view.players[view.attackerIdx]?.id === me.id;

  if (isDefender && view.phase === 'defending') {
    // Topmost unbeaten attack
    let open = null;
    for (let i = view.table.length - 1; i >= 0; i--) {
      if (!view.table[i].defense) { open = view.table[i]; break; }
    }
    if (!open?.attack || open.attack.faceDown) return result;
    const att = open.attack;
    for (const c of me.hand) {
      // beats logic mirror of engine.beats
      if (c.suit === att.suit && c.value > att.value) result.add(c.rank + c.suit);
      else if (c.suit === view.trumpSuit && att.suit !== view.trumpSuit) result.add(c.rank + c.suit);
      else if (view.transferEnabled && view.table.every((t) => !t.defense) && c.rank === att.rank) result.add(c.rank + c.suit);
    }
  } else if ((isAttacker || view.throwInMode === 'all') && view.phase === 'attacking') {
    if (view.table.length === 0) {
      // Birinchi karta — har qanday
      for (const c of me.hand) result.add(c.rank + c.suit);
    } else {
      // Stol ustidagi ranklar bilan mos
      const ranks = new Set();
      for (const t of view.table) {
        if (t.attack && !t.faceDown) ranks.add(t.attack.rank);
        if (t.defense) ranks.add(t.defense.rank);
      }
      for (const c of me.hand) if (ranks.has(c.rank)) result.add(c.rank + c.suit);
    }
  }
  return result;
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
  const lowEndDevice = Number(navigator.hardwareConcurrency || 8) <= 4;
  const nativeWebView = Boolean(window.Capacitor || window.CapacitorPlugins || window.cordova);
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
    items: ['VOICE', 'CHAT', 'GOLD'],
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
  if (!code && !view) {
    hideRoyalLoader('game');
    wrap.appendChild(renderGameError('O\'yin kodi topilmadi. Stollar bo\'limidan qayta kiring.'));
    return () => {};
  }
  let selectedCard = null;
  let chatOpen = false;
  let stickerOpen = false;
  let reactionsOpen = false;
  let reactionsTab = 'emoji';
  const chatLog = [];
  let ownedEmojiCache = null;
  let loadingOwnedEmoji = false;
  let stickerInventoryCache = null;
  let stickerInventoryLoading = false;
  let stickerInventoryError = '';
  const liveChat = [];
  let liveChatSeq = 0;
  const liveChatTimers = new Set();
  const speechByPlayer = {};
  const typingByPlayer = {};
  let dealingHand = false;
  let confettiShown = false;
  let timerInterval = null;
  let loadingWatchdog = null;
  let lastTableSize = 0;
  let warnedTimeout = false;
  let timeoutPoked = false;
  let playingCard = false;
  let renderFrame = null;
  let renderTimer = null;
  let lastRenderAt = 0;
  let gameLoaderDone = false;
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

  async function stopVoice() {
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (voicePeer) { voicePeer.close(); voicePeer = null; }
    voiceState = 'idle';
    scheduleRender();
  }

  async function startVoiceCall(initiator) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (_) {
      toast('Mikrofon ruxsati berilmadi', 'error'); voiceState = 'idle'; scheduleRender(); return;
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    voicePeer = pc;
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.ontrack = (e) => {
      const audio = document.getElementById('voice-remote-audio') || document.createElement('audio');
      audio.id = 'voice-remote-audio';
      audio.autoplay = true;
      audio.srcObject = e.streams[0];
      sfx.applyVoiceAudio?.(audio);
      document.body.appendChild(audio);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('voice:ice', { code, candidate: e.candidate });
    };
    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('voice:offer', { code, offer });
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
    const maxDomFps = nativeWebView || lowEndDevice ? 30 : 45;
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
    completeRoyalLoader(status, 520, 'game');
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

  function makeTypingBubble() {
    return h('div', { class: 'typing-bubble dynamic-ephemeral' }, [
      h('span', {}, []), h('span', {}, []), h('span', {}, []),
    ]);
  }

  function makeSpeechBubble(playerId) {
    return h('div', { class: 'speech dynamic-ephemeral' }, [
      SPEECH[speechByPlayer[playerId]] || speechByPlayer[playerId],
    ]);
  }

  function syncEphemeralFor(playerId) {
    const host = wrap.querySelector(`[data-player-id="${selectorId(playerId)}"]`);
    if (!host) { scheduleRender(); return; }
    host.querySelectorAll('.dynamic-ephemeral').forEach((el) => el.remove());
    if (typingByPlayer[playerId]) host.appendChild(makeTypingBubble());
    if (speechByPlayer[playerId]) host.appendChild(makeSpeechBubble(playerId));
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

  // Socket events
  const onChatMessage = (m) => {
    chatLog.push(m);
    pushLiveChat(m);
    sfx.play('notification');
    if (chatOpen) renderChat();
  };
  const onGameStart = (gv) => {
    if (loadingWatchdog) { clearTimeout(loadingWatchdog); loadingWatchdog = null; }
    view = gv; state.game = gv; dealingHand = true;
    updateRoyalLoader({ source: 'game', progress: 94, status: 'Kartalar tarqatilmoqda' });
    finishGameLoader('DUEL BOSHLANDI');
    lastTableSize = 0;
    timeoutPoked = false;
    sfx.play('shuffle');
    setTimeout(() => sfx.play('deal'), 200);
    scheduleRender();
    setTimeout(() => { dealingHand = false; scheduleRender(); }, 1400);
  };
  const onGameMove = (gv) => {
    const prevSize = lastTableSize;
    view = gv; state.game = gv;
    timeoutPoked = false;
    if (gv.table.length > prevSize) {
      sfx.play('cardThrow');
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
  const onStickerShow = ({ img, senderName }) => {
    if (!pref('pref_emotions', state.user)) return;
    showStickerOverlay(img, senderName);
  };
  const onRoomError = ({ error }) => toast(error || 'Xatolik', 'error');

  // ── Feature 30: Voice Chat socket handlers ────────────────────────────────
  const onVoiceRequest = ({ fromName }) => {
    // Show incoming voice request dialog
    const existing = document.getElementById('voice-request-modal');
    if (existing) existing.remove();
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
        startVoiceCall(false); // answerer
        scheduleRender();
      });
    };
    document.getElementById('voice-decline-btn').onclick = () => { bg.remove(); };
    // Auto-remove after 20s
    setTimeout(() => bg.isConnected && bg.remove(), 20000);
  };

  const onVoiceAccept = async () => {
    voiceState = 'active';
    scheduleRender();
    // initiator side — now create and send offer
    if (!voicePeer) await startVoiceCall(true);
  };

  const onVoiceOffer = async ({ offer }) => {
    if (!voicePeer) await startVoiceCall(false);
    if (voicePeer) {
      await voicePeer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await voicePeer.createAnswer();
      await voicePeer.setLocalDescription(answer);
      socket.emit('voice:answer', { code, answer });
    }
  };

  const onVoiceAnswer = async ({ answer }) => {
    if (voicePeer) await voicePeer.setRemoteDescription(new RTCSessionDescription(answer));
  };

  const onVoiceIce = async ({ candidate }) => {
    if (voicePeer && candidate) {
      try { await voicePeer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
    }
  };

  const onVoiceEnd = () => {
    stopVoice();
    // Remove remote audio element
    const el = document.getElementById('voice-remote-audio');
    if (el) el.remove();
    toast('Ovozli chat tugatildi', 'info');
  };

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
  // Feature 30: Voice chat
  socket.on('voice:request', onVoiceRequest);
  socket.on('voice:accept',  onVoiceAccept);
  socket.on('voice:offer',   onVoiceOffer);
  socket.on('voice:answer',  onVoiceAnswer);
  socket.on('voice:ice',     onVoiceIce);
  socket.on('voice:end',     onVoiceEnd);

  // Bug 4 fix: Barcha listenerlar ro'yxatga olingandan KEYIN room:join yuboriladi.
  // Aks holda server game:start ni listener tayyor bo'lmasdan yuborishi mumkin (race condition).
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
    socket.emit('room:join', { code }, (res) => {
      if (!res?.ok && !res?.reconnected) {
        hideRoyalLoader('game');
        wrap.innerHTML = '';
        wrap.appendChild(renderGameError(res?.error || 'O\'yin xonasi topilmadi'));
        return;
      }
      if (res?.reconnected) {
        // game:start event orqali view keladi — scheduleRender uni ushlaydi.
        // Agar view callback da ham kelsa (kelajakdagi compat uchun), ishlatamiz:
        if (res.view) {
          if (loadingWatchdog) { clearTimeout(loadingWatchdog); loadingWatchdog = null; }
          view = res.view; state.game = res.view; finishGameLoader('STOL TAYYOR'); scheduleRender();
        }
      }
    });
  }

  if (!view && code && !isSpectating) {
    loadingWatchdog = setTimeout(() => {
      if (view) return;
      socket.emit('room:join', { code }, (res) => {
        if (res?.view) {
          view = res.view;
          state.game = res.view;
          finishGameLoader('STOL TAYYOR');
          scheduleRender({ immediate: true });
          return;
        }
        if (!view) {
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
        h('h2', {}, ['O\'yin ochilmadi']),
        h('p', {}, [message || 'Xona yoki server javob bermadi.']),
        h('div', { class: 'row gap-12 mt-16' }, [
          h('button', { class: 'btn-secondary grow', onclick: () => navigate('home') }, ['Bosh sahifa']),
          h('button', { class: 'btn-big green grow', style: 'width:auto;min-height:auto;padding:13px', onclick: () => navigate('lobby') }, ['Stollar']),
        ]),
      ]),
    ]);
  }

  function showStickerOverlay(img, senderName) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9000;pointer-events:none;text-align:center;animation:cardDealIn .42s cubic-bezier(.34,1.56,.64,1)';
    ov.innerHTML = `
      <img src="${img}" style="max-width:200px;max-height:200px;filter:drop-shadow(0 12px 28px rgba(0,0,0,.7))" onerror="this.style.display='none'" />
      <div style="margin-top:8px;color:var(--rc-gold-bright);font-weight:900;font-size:13px;text-shadow:0 2px 4px #000">${senderName || ''}</div>`;
    document.body.appendChild(ov);
    setTimeout(() => ov.remove(), 2200);
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
    const cardId = `${card.rank}${card.suit}`;
    sfx.play(isDef && !canTransfer ? 'cardBeat' : 'cardThrow');
    vibrate(isDef && !canTransfer ? 18 : 12);
    try {
      const resp = await emitWithAck('game:action', { code, action, payload: { card: cardId } })
        .catch((e) => ({ ok: false, error: e.message }));
      if (!resp?.ok) {
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

  function animatePlayedCard(cardEl, zone) {
    const rect = cardEl.getBoundingClientRect();
    const target = zone || getTableDropZone();
    const targetX = (target.left + target.right) / 2 - rect.width / 2;
    const targetY = target.top + (target.bottom - target.top) * 0.54 - rect.height / 2;
    const dx = targetX - rect.left;
    const dy = targetY - rect.top;
    const clone = cardEl.cloneNode(true);
    clone.classList.remove('dragging', 'drop-ready', 'selected', 'snap-back', 'fly-to-table');
    clone.classList.add('throw-clone');
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.margin = '0';
    clone.style.transform = 'translate3d(0,0,0) scale(1.06)';
    clone.style.zIndex = '10000';
    document.body.appendChild(clone);
    cardEl.style.visibility = 'hidden';
    const animation = clone.animate([
      { transform: 'translate3d(0,0,0) scale(1.06) rotate(0deg)', opacity: 1, offset: 0 },
      { transform: `translate3d(${dx * 0.82}px, ${dy * 0.82}px, 0) scale(1.03) rotate(2deg)`, opacity: 1, offset: 0.72 },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(.94) rotate(0deg)`, opacity: 0.12, offset: 1 },
    ], {
      duration: 560,
      easing: 'cubic-bezier(.18,.82,.24,1)',
      fill: 'forwards',
    });
    animation.onfinish = () => clone.remove();
    animation.oncancel = () => clone.remove();
    setTimeout(() => clone.remove(), 760);
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
      cardEl.style.zIndex = '999';
      cardEl.classList.toggle('drop-ready', pointIsOnTable(e.clientX, e.clientY, dropZone) || dy < -82);
      e.preventDefault();
    });

    cardEl.addEventListener('pointerup', async (e) => {
      if (!dragging) return;
      dragging = false;
      if (rafMove) { cancelAnimationFrame(rafMove); rafMove = null; }
      cardEl.releasePointerCapture?.(e.pointerId);
      cardEl.classList.remove('dragging');
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const cardRect = cardEl.getBoundingClientRect();
      const cardCenterX = cardRect.left + cardRect.width / 2;
      const cardCenterY = cardRect.top + cardRect.height / 2;
      const upwardThrow = dy < -72 && Math.abs(dx) < 220;
      const enoughMove = Math.hypot(dx, dy) > 18;
      const shouldPlay = enoughMove && (
        pointIsOnTable(cardCenterX, cardCenterY, dropZone)
        || pointIsOnTable(e.clientX, e.clientY, dropZone)
        || pointIsOnTable(lastX, lastY, dropZone)
        || upwardThrow
      );
      cardEl.style.transform = baseTransform;
      cardEl.style.zIndex = '';
      cardEl.classList.remove('drop-ready');
      if (shouldPlay) {
        if (playingCard) { dropZone = null; return; }
        playingCard = true;
        cardEl.dataset.dragPlayed = '1';
        setTimeout(() => { delete cardEl.dataset.dragPlayed; }, 700);
        animatePlayedCard(cardEl, dropZone);
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
      cardEl.classList.remove('drop-ready');
      cardEl.style.transform = baseTransform;
      cardEl.style.zIndex = '';
      dropZone = null;
    });
  }

  function emitAction(action) {
    sfx.play('click');
    vibrate(10);
    return emitWithAck('game:action', { code, action }).catch(() => {});
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
    let reason = REPORT_REASONS[0].id;
    let details = '';

    const card = h('div', { class: 'modal' }, [
      h('h2', {}, ['🚩 Shikoyat']),
      labelBlock('O\'yinchi', selectFromList(opponents.map(p => [p.id, p.username]), v => target = v)),
      labelBlock('Sabab',    selectFromList(REPORT_REASONS.map(r => [r.id, r.label]), v => reason = v)),
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
    const tableSize = Number(view?.maxPlayers || view?.players?.length || 0);
    return view?.textChatEligible !== false && tableSize === 2;
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
    if (liveChat.length) renderLiveChatFeed();
  }

  function refreshReactionsPanel() {
    wrap.querySelector('.royal-reactions.open.reaction-all')?.remove();
    const panel = renderReactionsPanel();
    if (panel) wrap.appendChild(panel);
  }

  function setChatPanel(open) {
    chatOpen = Boolean(open);
    if (chatOpen) {
      stickerOpen = false;
      reactionsOpen = false;
      renderStickerPanel();
      refreshReactionsPanel();
    }
    renderChat();
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

  function renderReactionsPanel() {
    if (!reactionsOpen || !pref('pref_emotions', state.user)) return null;
    const tabButton = (tab, label) => h('button', {
      class: reactionsTab === tab ? 'active' : '',
      onclick: () => setReactionTab(tab),
    }, [label]);
    const emojiItems = ['😀','😂','🤔','😎','😡','🥳','👍','👎','❤️','🔥','💯','🎉','🎴','♠','♥','♦','♣','🏆'];
    const section = (title, child) => h('section', { class: `reaction-section ${reactionsTab === title ? 'active' : ''}` }, [
      h('div', { class: 'reaction-section-title' }, [title]),
      child,
    ]);
    const content = h('div', { class: 'reaction-sections' }, [
      section('emoji', h('div', { class: 'reaction-grid' }, emojiItems.map((e) =>
        h('button', { onclick: () => sendEmojiReaction(e) }, [e])
      ))),
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
    const card = h('div', { class: 'modal forfeit-confirm-modal' }, [
      h('h2', {}, ['O‘yindan chiqish']),
      h('p', { class: 'muted' }, [`Chiqsangiz, $${formatGameMoney(view.stake)} tikishingiz qolgan o‘yinchilarga taqsimlanadi. Natija shu ekranda ko‘rsatiladi.`]),
      h('div', { class: 'row gap-12 mt-16' }, [
        h('button', { class: 'btn-secondary grow', onclick: () => bg.remove() }, ['Qolish']),
        h('button', {
          class: 'btn-done',
          style: 'padding:12px 20px;font-size:14px',
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
        }, ['Chiqish']),
      ]),
    ]);
    bg.appendChild(card);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    wrap.appendChild(bg);
  }

  function render() {
    wrap.innerHTML = '';
    if (!view) {
      wrap.appendChild(h('div', { class: 'end-overlay' }, [
        h('div', { class: 'result-title' }, ['Yuklanmoqda…']),
      ]));
      return;
    }

    const me = view.players.find((p) => p.hand);
    const opps = view.players.filter((p) => p !== me);
    const highlights = highlightableCards(view, me);
    const forfeitInfo = view.forfeit || null;
    const forfeitedId = forfeitInfo?.playerId || null;
    const payoutByPlayer = new Map((view.payoutShares || []).map((s) => [s.playerId, Number(s.amount || 0)]));
    const myPayout = me?.id ? (payoutByPlayer.get(me.id) || 0) : 0;
    const activeCardSkin = currentCardSkin();
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
          socket.emit('voice:end', { code });
          stopVoice();
          const el = document.getElementById('voice-remote-audio');
          if (el) el.remove();
        } else if (voiceState === 'idle') {
          voiceState = 'requesting';
          scheduleRender();
          socket.emit('voice:request', { code }, (res) => {
            if (!res?.ok) {
              voiceState = 'idle';
              scheduleRender();
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
      h('button', {
        class: 'btn-icon notif',
        'data-count': String(chatLog.length || 0),
        onclick: () => {
          sfx.play('click');
          setChatPanel(!chatOpen);
        },
      }, ['💬']),
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
    wrap.appendChild(h('aside', { class: 'royal-game-left' }, [
      h('button', { class: 'royal-square-btn', onclick: openForfeitDialog, title: 'Menyu' }, ['☰']),
      h('button', { class: 'royal-square-btn', onclick: () => navigate('rules'), title: 'Qoida' }, ['▣']),
      h('div', { class: 'royal-stake-box' }, [
        h('small', {}, ['Stavka:']),
        h('strong', {}, [`$ ${Number(view.stake || 0).toLocaleString()}`]),
        h('i', {}, []),
        h('small', {}, ['Bank:']),
        h('strong', { class: 'green' }, [`$ ${bank.toLocaleString()}`]),
      ]),
      h('button', { class: 'royal-rule-btn', onclick: () => navigate('rules') }, ['📖', h('span', {}, ['Qoida'])]),
    ]));

    const trumpText = view.trumpCard
      ? `${view.trumpCard.rank === 'T' ? '10' : view.trumpCard.rank}${SUIT_GLYPH[view.trumpCard.suit] || ''}`
      : (SUIT_GLYPH[view.trumpSuit] || '');
    wrap.appendChild(h('aside', { class: 'royal-game-right' }, [
      h('div', { class: 'royal-right-actions' }, [
        h('button', {
          class: reactionsOpen ? 'active' : '',
          onclick: () => toggleReactions('emoji'),
          title: 'Emoji va stikerlar',
        }, ['😀']),
        h('button', {
          onclick: () => {
            setChatPanel(!chatOpen);
          },
          title: 'Chat',
        }, ['💬']),
        h('button', { onclick: () => navigate('settings'), title: 'Sozlamalar' }, ['⚙']),
        h('button', { class: 'wide', onclick: openForfeitDialog }, ['Chiqish']),
      ]),
      h('div', { class: 'royal-trump-card' }, [
        h('small', {}, ['Kozir']),
        h('strong', {}, [trumpText]),
      ]),
      h('div', { class: 'royal-reactions' }, [
        h('div', { class: 'reaction-tabs' }, [
          h('button', { onclick: () => sendEmojiReaction('😀') }, ['Emoji']),
          h('button', { class: 'active', onclick: openStickerPicker }, ['Stikerlar']),
          h('button', { onclick: () => toast('Kosoncha keyingi yangilanishda', 'info') }, ['Kosoncha']),
        ]),
        h('div', { class: 'reaction-grid' }, ['😀','😂','🤔','😎','😡','🥳','👍','👎','❤️','🔥','💯','🎉','🎴','♠','♥','♦','♣','🏆'].map((e) =>
          h('button', { onclick: () => sendEmojiReaction(e) }, [e])
        )),
        h('div', { class: 'reaction-bottom' }, [
          h('button', { onclick: () => sendEmojiReaction('😀') }, ['😀']),
          h('button', { onclick: openStickerPicker }, ['GIF']),
          h('button', { onclick: openStickerPicker }, ['🎭']),
          h('button', { onclick: () => toast('Tarix hozircha bo\'sh', 'info') }, ['◷']),
        ]),
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
          h('div', { class: 'royal-turn-label' }, [isMe ? 'SIZNING NAVBATINGIZ' : 'RAQIB NAVBATI']),
          h('div', { class: 'royal-turn-name' }, [activePlayer.nickname ? `@${activePlayer.nickname}` : activePlayer.username]),
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
      const avatarEl = h('div', { class: `avatar md color-${avatarColorFor(p.id)}`, style: 'position:relative' }, [
        avatarLetter(p.username),
        isDefender ? h('span', { class: 'role-badge' }, ['🛡']) : null,
        isAttacker ? h('span', { class: 'role-badge' }, ['⚔']) : null,
      ].filter(Boolean));
      if (forfeitedId === p.id) {
        avatarEl.appendChild(h('span', { class: 'white-flag-badge' }, [
          h('i', {}, []),
          h('b', {}, [`-${formatGameMoney(view.stake)}`]),
        ]));
      }
      if (payoutByPlayer.get(p.id)) {
        avatarEl.appendChild(h('span', { class: 'mini-payout-pop' }, [`+${formatGameMoney(payoutByPlayer.get(p.id))}`]));
      }
      oppEl.appendChild(avatarEl);
      oppEl.appendChild(h('div', { class: 'opp-name' }, [
        p.nickname ? `@${p.nickname}` : p.username,
      ]));

      if (typingByPlayer[p.id]) {
        oppEl.appendChild(makeTypingBubble());
      }
      if (speechByPlayer[p.id]) {
        oppEl.appendChild(makeSpeechBubble(p.id));
      }

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
    const canPlaySelected = selectedCard && (canTake || isMyTurnAttacker(me)) && highlights.has(selectedCard.rank + selectedCard.suit);
    wrap.appendChild(h('div', { class: 'royal-action-dock' }, [
      h('button', {
        class: `royal-table-action pass ${canPass ? '' : 'disabled'}`,
        onclick: () => canPass ? emitAction('pass') : toast('Hozir pass qilib bo\'lmaydi', 'info'),
      }, [h('strong', {}, ['PASS']), h('small', {}, ["O'TKAZIB YUBORISH"])]),
      h('button', {
        class: `royal-table-action take ${canTake ? '' : 'disabled'}`,
        onclick: () => canTake ? (sfx.play('take'), vibrate(18), emitAction('take')) : toast('Hozir karta olish navbati emas', 'info'),
      }, [h('strong', {}, ['OLISH']), h('small', {}, ['KARTANI OLISH'])]),
      h('button', {
        class: `royal-table-action hit ${canPlaySelected ? '' : 'disabled'}`,
        onclick: () => canPlaySelected ? playCard(selectedCard) : toast('Avval yuradigan kartani tanlang', 'info'),
      }, [h('strong', {}, ['URISH']), h('small', {}, ['KARTANI URISH'])]),
    ]));

    const actionBar = h('div', { class: `action-bar${pref('pref_right_action', state.user) ? ' action-bar-right' : ''}` });
    if (isMyTurnDefender(me)) {
      actionBar.appendChild(h('button', {
        class: 'btn-done',
        onclick: () => { sfx.play('take'); vibrate(18); emitAction('take'); },
      }, ['Olaman']));
    }
    if (isMyTurnAttacker(me) && view.table.length > 0) {
      actionBar.appendChild(h('button', {
        class: 'btn-secondary',
        style: 'font-size:15px;padding:13px 22px',
        onclick: () => { emitAction('pass'); },
      }, ['Pas / Bitti']));
    }
    wrap.appendChild(actionBar);

    // ── Perks bar ────────────────────────────────────────────────
    if (view.mode !== 'tournament' && view.phase !== 'ended') {
      const perksBar = h('div', { class: 'perks-bar' });
      const commands = [
        ['↪', 'Stolni tark etish', openForfeitDialog],
        ['👥', 'Do\'stlar', () => navigate('friends')],
        ['💬', 'Chat', () => {
          setChatPanel(true);
        }],
        ['🎁', 'Sovg\'a yuborish', () => navigate('friends')],
        ['?', 'Yordam', () => openAIChatModal(state.user, isPremium)],
      ];
      for (const [icon, label, onclick] of commands) {
        perksBar.appendChild(h('button', {
          class: 'perk-btn royal-command-btn',
          onclick: () => {
            sfx.play('click');
            onclick();
          },
        }, [
          h('span', { class: 'perk-icon' }, [icon]),
          h('span', {}, [label]),
        ]));
      }
      for (const perk of []) {
        perksBar.appendChild(h('button', {
          class: 'perk-btn',
          onclick: () => usePerk(perk),
        }, [
          h('span', { class: 'perk-icon' }, [perk.icon]),
          h('span', {}, [perk.label]),
          h('span', { class: 'perk-cost' }, [`${perk.cost} ⚡`]),
        ]));
      }
      perksBar.appendChild(h('button', {
        class: 'btn-secondary',
        style: 'margin-left:10px;padding:8px 14px;font-size:11px',
        onclick: openReportDialog,
      }, ['🚩 Shikoyat']));
      wrap.appendChild(perksBar);
    }

    // Perk reveal overlay
    if (perkReveal) renderPerkReveal();

    // ── Bottom info bar ──────────────────────────────────────────
    const meColorIdx = avatarColorFor(me?.id || me?.username);
    const myAvatar = h('div', {
      class: `avatar md color-${meColorIdx}`,
      style: 'position:relative',
      'data-player-id': me?.id || '',
    }, [avatarLetter(me?.username || '')]);
    if (forfeitedId === me?.id) {
      myAvatar.appendChild(h('span', { class: 'white-flag-badge mine' }, [
        h('i', {}, []),
        h('b', {}, [`-${formatGameMoney(view.stake)}`]),
      ]));
    }
    if (myPayout) {
      myAvatar.appendChild(h('span', { class: 'mini-payout-pop mine' }, [`+${formatGameMoney(myPayout)}`]));
    }
    if (speechByPlayer[me?.id]) {
      myAvatar.appendChild(makeSpeechBubble(me.id));
    }
    wrap.appendChild(h('div', { class: 'bottom-info-bar' }, [
      h('div', { class: 'me-info' }, [
        myAvatar,
        h('div', {}, [
          h('div', { class: 'name-line' }, [me?.nickname ? `@${me.nickname}` : me?.username || '']),
          h('div', { class: 'stat-line' }, [`💰 ${(state.user?.coins || 0) >= 1000 ? `${Math.round(state.user.coins/100)/10}K` : state.user?.coins || 0}`]),
        ]),
      ]),
      h('button', {
        class: 'btn-icon',
        onclick: () => {
          sfx.play('click');
          setChatPanel(true);
        },
        title: 'Chat',
      }, ['💬']),
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

    // ── My hand (with highlights) ────────────────────────────────
    const hand = h('div', { class: 'my-hand' });
    if (me?.hand) {
      const sorted = [...me.hand].sort((a, b) => {
        if (pref('pref_turn_sorting', state.user)) {
          const ap = highlights.has(a.rank + a.suit) ? 1 : 0;
          const bp = highlights.has(b.rank + b.suit) ? 1 : 0;
          if (ap !== bp) return bp - ap;
        }
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
        const canPlay = highlights.has(c.rank + c.suit);
        const cardEl = renderCard(c, { extraClass: isTrump ? 'trump' : '', skin: activeCardSkin });
        if (selectedCard && c.rank === selectedCard.rank && c.suit === selectedCard.suit) cardEl.classList.add('selected');
        if (!canPlay && (isMyTurnAttacker(me) || isMyTurnDefender(me))) {
          cardEl.style.opacity = '.55';
          cardEl.style.filter = 'grayscale(.4)';
        } else if (canPlay) {
          cardEl.style.boxShadow = isTrump
            ? '0 0 0 2px #60d98a, 0 0 18px rgba(96,217,138,.4), 0 6px 18px rgba(216,179,95,.3)'
            : '0 0 0 2px rgba(96,217,138,.65), 0 0 14px rgba(96,217,138,.35), 0 6px 16px rgba(0,0,0,.55)';
        }
        if (dealingHand) {
          cardEl.classList.add('dealing');
          cardEl.style.animationDelay = `${i * 0.08}s`;
        }
        attachDragToPlay(cardEl, c, canPlay, me);
        cardEl.addEventListener('click', () => {
          if (cardEl.dataset.dragPlayed === '1') return;
          if (isMyTurnAttacker(me) || isMyTurnDefender(me)) {
            if (!canPlay) {
              sfx.play('error');
              toast('Bu karta bilan yurib bo\'lmaydi', 'error');
              return;
            }
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
              selectedCard = c;
              sfx.play('click');
              vibrate(8);
              toast('Yana bir marta bosing - karta yuradi', 'info', 900);
              scheduleRender();
              return;
            }
            sfx.play('click');
            selectedCard = c;
            vibrate(8);
            toast('Endi URISH tugmasini bosing yoki kartani stolga suring', 'info');
            scheduleRender();
          } else {
            toast('Sizning navbatingiz emas', 'error');
            sfx.play('error');
          }
        });
        hand.appendChild(cardEl);
      });
    }
    wrap.appendChild(hand);
    requestAnimationFrame(() => applyFanLayout(hand));

    // ── End game overlay ─────────────────────────────────────────
    if (view.phase === 'ended') {
      const winnerId = view.winnerOrder?.[0];
      const winner = view.players.find((p) => p.id === winnerId);
      const isDraw = !view.durakId && view.players.length === 0;
      const isForfeitEnd = !!forfeitInfo;
      const quitter = view.players.find((p) => p.id === forfeitedId);
      const payoutRows = (view.payoutShares || [])
        .filter((s) => s.playerId !== forfeitedId && Number(s.amount || 0) > 0);
      const meWon = isForfeitEnd ? myPayout > 0 : (winner && winner.id === me?.id);
      const cls = meWon ? 'win' : (isDraw ? 'draw' : 'lose');
      const title = isDraw
        ? 'DURANG'
        : (isForfeitEnd ? `${quitter?.username || 'O\'yinchi'} chiqib ketdi` : (meWon ? 'G\'ALABA!' : (winner ? `${winner.username} yutdi` : 'O\'YIN TUGADI')));

      const overlay = h('div', { class: `end-overlay${isForfeitEnd ? ' forfeit-end-overlay' : ''}` }, [
        h('div', { class: 'result-card' }, [
          h('h1', { class: `result-title ${cls}` }, [title]),
          h('p', { class: 'muted', style: 'margin-top:14px;font-size:14px' }, [
            isForfeitEnd
              ? `Tikilgan pul qolgan o'yinchilarga bo'lib berildi`
              : (view.durakId ? `Durak: ${view.players.find((p) => p.id === view.durakId)?.username || ''}` : ''),
          ]),
          meWon ? h('div', {
            style: 'margin-top:18px;font-size:24px;font-weight:900;color:var(--rc-gold-bright)'
          }, [`+ ${formatGameMoney(myPayout || view.stake * view.players.length)}`]) : null,
          isForfeitEnd && payoutRows.length ? h('div', { class: 'payout-list' }, payoutRows.map((s) => {
            const p = view.players.find((pl) => pl.id === s.playerId);
            return h('div', {}, [
              h('span', {}, [p?.username || 'o‘yinchi']),
              h('b', {}, [`+${formatGameMoney(s.amount)}`]),
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

    if (liveChat.length) renderLiveChatFeed();
    if (chatOpen) renderChat();
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
    if (!timerNodeCache.length || now - timerCacheAt > 1200) {
      timerNodeCache = Array.from(wrap.querySelectorAll('.opp-slot.turn .turn-timer, .royal-turn-panel .turn-timer'));
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
    if (loadingWatchdog) clearTimeout(loadingWatchdog);
    if (perkRevealTimer) clearTimeout(perkRevealTimer);
    liveChatTimers.forEach((timer) => clearTimeout(timer));
    liveChatTimers.clear();
    if (_aiContextProvider) _aiContextProvider = null;
    if (renderFrame) cancelAnimationFrame(renderFrame);
    if (renderTimer) clearTimeout(renderTimer);
    if (onRuntimePrefChange) window.removeEventListener('imperia:pref-change', onRuntimePrefChange);
    document.documentElement.classList.remove('game-perf-mode');
    document.querySelector('.game-sticker-sheet-bg')?.remove();
    timerNodeCache = [];
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
    socket.off('room:error', onRoomError);
  };
  window.addEventListener('beforeunload', cleanup, { once: true });

  function renderChat() {
    const existing = wrap.querySelector('.chat-panel');
    if (existing) existing.remove();
    if (!chatOpen) return;
    if (!isTextChatAllowed()) {
      chatOpen = false;
      toast("Yozishish faqat 1 ga 1 o'yinda ishlaydi", 'info');
      return;
    }
    const panel = h('div', { class: 'chat-panel' });
    panel.appendChild(h('div', { class: 'chat-panel-head' }, [
      h('strong', {}, ['Chat']),
      h('button', {
        class: 'chat-close-btn',
        type: 'button',
        title: 'Yopish',
        onclick: () => {
          sfx.play('click');
          setChatPanel(false);
        },
      }, ['×']),
    ]));
    const msgs = h('div', { class: 'chat-msgs' });
    for (const m of chatLog) {
      msgs.appendChild(h('div', { class: 'chat-msg' }, [
        h('span', { class: 'name' }, [`${m.senderName || m.username || ''}: `]),
        h('span', {}, [m.content || m.text || '']),
      ]));
    }
    panel.appendChild(msgs);
    const input = h('input', { placeholder: 'Xabar...' });
    const send = h('button', {
      class: 'btn-secondary',
      onclick: () => {
        const content = String(input.value || '').trim();
        if (!content) return;
        sfx.play('click');
        send.disabled = true;
        socket.emit('chat:message', { code, content, type: 'text' }, (res) => {
          send.disabled = false;
          if (!res?.ok) toast(res?.error || 'Xabar yuborilmadi', 'error');
          else input.focus();
        });
        input.value = '';
      },
    }, ['→']);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });
    panel.appendChild(h('div', { class: 'chat-input-row' }, [input, send]));
    if (pref('pref_emotions', state.user)) {
      const grid = h('div', { class: 'emoji-grid' });
      if (ownedEmojiCache?.length) {
        for (const e of ownedEmojiCache.slice(0, 24)) {
          grid.appendChild(h('button', {
            class: 'emoji-btn owned-emoji-btn',
            title: e.name,
            onclick: () => {
              sfx.play('click');
              socket.emit('chat:message', { code, content: e.label, type: 'emoji' });
            },
          }, [e.label]));
        }
      } else if (!loadingOwnedEmoji) {
        loadingOwnedEmoji = true;
        api.inventoryGrouped().then((data) => {
          ownedEmojiCache = [];
          for (const pack of data?.emoji || []) {
            for (const item of pack.owned || []) {
              ownedEmojiCache.push({
                name: `${pack.name} ${item.emojiId}`,
                label: emojiLabelFromPack(pack.packId, item.emojiId),
              });
            }
          }
          loadingOwnedEmoji = false;
          if (chatOpen) renderChat();
        }).catch(() => { loadingOwnedEmoji = false; });
      }
      for (const e of ['😀','😂','🤔','😎','😡','🥳','👍','👎','❤️','🔥','💯','🎉','🎴','🃏','♠','♥','♦','♣']) {
        grid.appendChild(h('button', {
          class: 'emoji-btn',
          onclick: () => { sfx.play('click'); socket.emit('chat:message', { code, content: e, type: 'emoji' }); },
        }, [e]));
      }
      panel.appendChild(grid);
    }
    wrap.appendChild(panel);
  }

  function renderLiveChatFeed() {
    const feed = h('div', { class: 'game-chat-feed' });
    for (const m of liveChat.slice(-3)) {
      const sender = m.senderName || m.username || 'Player';
      const content = String(m.content || m.text || '').slice(0, 120);
      feed.appendChild(h('div', { class: `game-chat-bubble ${m.type || 'text'}` }, [
        h('span', { class: 'game-chat-sender' }, [`${sender}: `]),
        h('span', { class: 'game-chat-text' }, [content]),
      ]));
    }
    wrap.appendChild(feed);
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
      if (hint.action === 'wait_for_turn') text = 'Navbatingizni kuting';
      else if (hint.card) text = `${hint.action === 'defense' ? 'Uring: ' : 'Yurish: '}${hint.card.rank === 'T' ? '10' : hint.card.rank}${SUIT_GLYPH[hint.card.suit]}`;
      else if (hint.action === 'take') text = 'Eng yaxshi: olish';
      else if (hint.action === 'pass') text = 'Eng yaxshi: pas';
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
          h('small', {}, ['Olingan sticker packlardan yuboring']),
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
      const available = (packs || []).filter((p) => Number(p.owned || 0) > 0 || Number(p.priceGold || 0) === 0);
      if (!available.length) {
        grid.appendChild(h('div', { class: 'game-sticker-loading' }, [
          'Avval do\'kondan sticker pack oling',
          h('button', { class: 'btn-secondary mt-16', onclick: () => { closeSheet(); navigate('shop'); } }, ["Do'konga o'tish"]),
        ]));
        return;
      }
      for (const pack of available) {
        for (const s of (pack.stickers || [])) {
          grid.appendChild(h('button', {
            class: 'game-sticker-btn',
            title: s.name,
            onclick: async () => {
              sfx.play('click');
              try {
                await api.stickerSend(s.id, code);
                closeSheet();
              } catch (err) {
                toast(err.message || 'Stiker yuborilmadi', 'error');
              }
            },
          }, [
            h('img', {
              src: s.img,
              alt: s.name,
              onerror: (e) => { e.currentTarget.style.display = 'none'; },
            }),
            h('small', {}, [String(s.name || '').replace(/^.*#/, '#')]),
          ]));
        }
      }
    };

    if (stickerInventoryCache) {
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
      api.stickerInventory()
        .then((packs) => {
          stickerInventoryCache = packs || [];
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
    this._ui = null;

    // Socket events
    this._onVoiceRequest = this._onVoiceRequest.bind(this);
    this._onVoiceAccept  = this._onVoiceAccept.bind(this);
    this._onVoiceOffer   = this._onVoiceOffer.bind(this);
    this._onVoiceAnswer  = this._onVoiceAnswer.bind(this);
    this._onVoiceIce     = this._onVoiceIce.bind(this);
    this._onVoiceEnd     = this._onVoiceEnd.bind(this);

    socket.on('voice:request', this._onVoiceRequest);
    socket.on('voice:accept',  this._onVoiceAccept);
    socket.on('voice:offer',   this._onVoiceOffer);
    socket.on('voice:answer',  this._onVoiceAnswer);
    socket.on('voice:ice',     this._onVoiceIce);
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
    this.socket.emit('voice:request', { code: this.roomCode });
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
      this.socket.emit('voice:end', { code: this.roomCode });
    };

    // 30 soniya timeout
    setTimeout(() => { if (overlay.parentNode) { overlay.remove(); this.socket.emit('voice:end', { code: this.roomCode }); } }, 30000);
  }

  _onVoiceAccept() {
    this.requesting = false;
    this._startVoice(true);
  }

  async _startVoice(isInitiator) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
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
    }
  }

  async _onVoiceOffer(data) {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(data.offer);
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    this.socket.emit('voice:answer', { code: this.roomCode, answer });
  }

  async _onVoiceAnswer(data) {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(data.answer);
  }

  async _onVoiceIce(data) {
    if (!this.peerConnection) return;
    try { await this.peerConnection.addIceCandidate(data.candidate); } catch (_) {}
  }

  // Istalgan tomon o'chirsa — ikkala tomonda o'chadi (Band 30)
  _onVoiceEnd() {
    this._cleanup();
    this._toast('🎙️ Ovozli suhbat tugatildi', 'info');
  }

  endVoice() {
    this.socket.emit('voice:end', { code: this.roomCode });
    this._cleanup();
    this._toast('🎙️ Ovoz o\'chirildi', 'info');
  }

  _cleanup() {
    this.active = false;
    this.requesting = false;
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
      : `${cardLabel(attack)} ni uradigan karta yoq. Olish yaxshiroq, keyin kichik kartalarni chiqarishga harakat qiling.`;
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
