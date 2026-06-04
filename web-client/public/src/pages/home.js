import { h } from '../ui.js';
import { api } from '../api.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { avatarColorFor, avatarLetter } from '../cards.js';
import { sfx } from '../sfx.js?v=111-encoding-fix';
import { showRewardedAd as showNativeRewardedAd } from '../native/capacitor-bridge.js';
import { initAI, askAI } from '../services/aiChat.js?v=46-royal-dashboard';
import { attachGoldScrollIndicator } from '../scrollIndicator.js';
import { hideRoyalLoader, showRoyalLoader, updateRoyalLoader } from '../royalLoading.js?v=129-royal-loader-clean';
import { refreshLiveState } from '../realtime.js?v=140-full-audit';

const AD_REWARD = 800;
const AD_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const HOME_FAST_USER_MS = 320;
const HOME_FAST_PANEL_MS = 420;
let homePanelCache = { baraban: null, leaders: null, donors: [], at: 0 };
let homeLiveCleanups = [];

function clearHomeLiveCleanups() {
  for (const cleanup of homeLiveCleanups.splice(0)) {
    try { cleanup(); } catch (_) {}
  }
}

const BARABAN_SEGMENTS = [
  { type: 'coins', amount: 50, label: '50', value: 'COIN', color: '#0d8a62' },
  { type: 'coins', amount: 100, label: '100', value: 'COIN', color: '#15825d' },
  { type: 'coins', amount: 250, label: '250', value: 'COIN', color: '#147a73' },
  { type: 'coins', amount: 500, label: '500', value: 'COIN', color: '#b47b18' },
  { type: 'coins', amount: 1000, label: '1000', value: 'COIN', color: '#c3962c' },
  { type: 'premium_day', label: 'VIP', value: '1 KUN', color: '#7d3ac1' },
  { type: 'avatar_frame', label: 'AVATAR', value: 'EXCLUSIVE', color: '#8e163d' },
  { type: 'emoji_pack', label: 'EMOJI', value: 'PACK', color: '#bf4b89' },
  { type: 'rank_points', label: 'REYTING', value: '+25', color: '#314a9b' },
  { type: 'reroll', label: 'YANA', value: 'SPIN', color: '#ba6a18' },
  { type: 'empty', label: 'BOSH', value: 'OMAD', color: '#20232b' },
];

export function invalidateHomePanelCache() {
  homePanelCache = { baraban: null, leaders: null, donors: [], at: 0 };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHomePanelResults(results, user) {
  const [barabanResult, leadersResult, donationResult] = Array.isArray(results) ? results : [];
  const baraban = barabanResult?.status === 'fulfilled' ? barabanResult.value : homePanelCache.baraban;
  const receivedAt = Date.now();
  if (baraban && typeof baraban === 'object') baraban._clientReceivedAt = receivedAt;
  const leaders = leadersResult?.status === 'fulfilled'
    ? normalizeLeaders(leadersResult.value)
    : (homePanelCache.leaders || fallbackLeaders(user));
  const donors = donationResult?.status === 'fulfilled' && Array.isArray(donationResult.value)
    ? donationResult.value
    : (homePanelCache.donors || []);
  return {
    baraban,
    leaders: leaders?.length ? leaders : fallbackLeaders(user),
    donors,
    at: receivedAt,
  };
}

function saveHomePanelCache(results, user) {
  homePanelCache = readHomePanelResults(results, user);
  return homePanelCache;
}

export async function renderHome(root) {
  clearHomeLiveCleanups();
  const cleanups = homeLiveCleanups;
  const mePromise = api.me();
  try {
    const fastUser = await Promise.race([mePromise, wait(HOME_FAST_USER_MS).then(() => null)]);
    if (fastUser) state.user = fastUser;
    else mePromise.then((freshUser) => { state.user = freshUser; }).catch(() => {});
  } catch (_) {}
  const user = state.user || {};

  const panelPromise = Promise.allSettled([
    api.request('GET', '/baraban/status'),
    api.leaderboard('season', 3),
    api.donationsUsersLeaderboard(),
  ]);
  let panelSnapshot = homePanelCache;
  if (homePanelCache.at && Date.now() - homePanelCache.at < 45000) {
    panelPromise.then((results) => saveHomePanelCache(results, state.user || user));
  } else {
    const hadPanelCache = !!homePanelCache.at;
    const fastPanels = await Promise.race([panelPromise, wait(HOME_FAST_PANEL_MS).then(() => null)]);
    if (fastPanels) panelSnapshot = saveHomePanelCache(fastPanels, user);
    else panelPromise.then((results) => {
      saveHomePanelCache(results, state.user || user);
      if (!hadPanelCache && root?.isConnected) renderHome(root);
    });
  }

  const baraban = panelSnapshot.baraban;
  const leaders = panelSnapshot.leaders || fallbackLeaders(user);
  const donors = panelSnapshot.donors || [];
  const donationTotal = Array.isArray(donors)
    ? donors.reduce((sum, item) => sum + Number(item.total_usd_cents || item.totalUsdCents || 0), 0)
    : 0;

  root.innerHTML = '';
  const screen = h('div', { class: 'screen home-screen royal-dashboard-screen' });

  screen.appendChild(h('aside', { class: 'royal-dash-side' }, [
    brandBlock(),
    sideNav([
      ['home', '⌂', 'Bosh sahifa', () => toast('Siz bosh sahifadasiz', 'info')],
      ['profile', '♟', 'Profil', () => go('profile')],
      ['leaderboard', '♛', 'Reytinglar', () => go('leaderboard')],
      ['friends', '♟', "Do'stlar", () => go('friends')],
      ['messages', '✉', 'Xabarlar', () => toast('Xabarlar o\'yin ichida ko\'rinadi', 'info'), 3],
      ['inventory', '♠', 'Kolleksiya', () => go('inventory')],
      ['achievements', '★', 'Nishonlar', () => go('achievements')],
      ['shop', '🛒', "Do'kon", () => go('shop')],
      ['premium', '♕', 'Premium', () => go('shop', { tab: 'premium' })],
      ['ai', '🤖', "Sun'iy intellekt", () => openHomeAI(user)],
    ]),
  ]));

  screen.appendChild(h('main', { class: 'royal-dash-main' }, [
    topStrip(user),
    h('section', { class: 'royal-dash-grid' }, [
      featureCard({
        className: 'play hero',
        title: "O'YNASH",
        subtitle: "TEZKOR O'YIN",
        art: h('div', { class: 'dash-card-art cards' }, [
          h('span', { class: 'dash-playing-card black' }, ['K♠']),
          h('span', { class: 'dash-playing-card red' }, ['Q♥']),
        ]),
        button: "O'YINNI BOSHLASH",
        onClick: quickPlay,
      }),
      featureCard({
        className: 'tables hero',
        title: 'STOLLAR',
        subtitle: "O'Z STOLINGIZNI TANLANG",
        art: h('div', { class: 'dash-card-art table' }, [h('span', {}, ['♕'])]),
        button: 'STOL YARATISH',
        onClick: () => go('lobby'),
      }),
      featureCard({
        className: 'tournaments hero',
        title: 'TURNIRLAR',
        subtitle: 'KATTA MUKOFOTLAR',
        art: h('div', { class: 'dash-card-art trophy' }, ['🏆']),
        button: 'TURNIRGA KIRISH',
        onClick: () => go('tournaments'),
      }),
      miniCard('😎', 'KOLLEKSIYA', "EMOJI, KARTA VA NISHONLARNI YIG'ING", "KO'RISH", () => go('inventory'), 'collection'),
      miniCard('🛍', "DO'KON", "EMOJI, KARTA, STIKER VA KO'P YANA", "DO'KONGA KIRISH", () => go('shop'), 'shop'),
      miniCard('🛡', 'NISHONLAR', "YUTUQLARINGIZNI KO'RING", "KO'RISH", () => go('achievements'), 'badges'),
      miniCard('🎁', 'REFERAL', "DO'STLARINGIZNI TAKLIF QILING VA BONUS OLING", 'TAKLIF QILISH', shareInvite, 'referral'),
      miniCard('💝', 'DONAT', donationTotal > 0
        ? `LOYIHAGA ${(donationTotal / 100).toFixed(0)}$ YORDAM YIG'ILDI`
        : 'MAJBURIY EMAS, LOYIHA RIVOJI UCHUN YORDAM', 'YORDAM BERISH', () => go('donations'), 'donat-mini'),
    ]),
    aiBanner(user),
  ]));

  screen.appendChild(h('aside', { class: 'royal-dash-right' }, [
    promoPanel({
      className: 'gold-shop',
      title: "GOLD COIN DO'KONI",
      text: 'Sotib oling va imtiyozlarga ega bo\'ling',
      icon: '🪙',
      button: 'SOTIB OLISH',
      onClick: () => go('shop', { tab: 'gold' }),
    }),
    barabanPanel(baraban, user, () => renderHome(root), panelSnapshot.at, cleanups),
    promoPanel({
      className: 'donat old-donat-hidden',
      title: 'DONAT',
      text: donationTotal > 0
        ? `Loyihaga ${(donationTotal / 100).toFixed(0)}$ yordam yig'ildi`
        : 'Majburiy emas, loyiha rivoji uchun yordam',
      icon: '💝',
      button: 'YORDAM BERISH',
      onClick: () => go('donations'),
    }),
    promoPanel({
      className: 'premium',
      title: 'PREMIUM',
      text: "Reklamasiz o'yin va ko'proq imtiyozlar",
      icon: '♕',
      button: 'BATAFSIL',
      onClick: () => go('shop', { tab: 'premium' }),
    }),
    leadersPanel(leaders),
  ]));

  screen.appendChild(bottomBar(() => renderHome(root)));
  root.appendChild(screen);
  const detachScroll = attachGoldScrollIndicator(screen, {
    className: 'home-gold-scroll-track',
    top: 88,
    bottom: 82,
  });

  function go(page, params) {
    sfx.play('click');
    navigate(page, params);
  }

  async function quickPlay() {
    sfx.play('click');
    const myName = user.nickname || user.username || (user.email ? String(user.email).split('@')[0] : '') || 'SIZ';
    showRoyalLoader({
      source: 'duel',
      variant: 'duel',
      title: '1 VS 1',
      subtitle: 'Duel battle loading',
      status: 'Voice, chat va gold progress tayyorlanmoqda',
      progress: 28,
      items: ['VOICE', 'CHAT', 'GOLD'],
      players: [myName, 'RAQIB'],
    });
    try {
      const { emitWithAck, connectSocket } = await import('../socket.js');
      const socket = connectSocket();
      const liveCoins = Number((state.user || user).coins || 0);
      if (liveCoins < 100) {
        hideRoyalLoader('duel');
        toast('100$ minimum o\'yin uchun mablag\' yetarli emas', 'error');
        return;
      }
      toast("O'yin ochilmoqda...", 'info');
      updateRoyalLoader({ source: 'duel', progress: 48, status: 'Stavka, xona va battle sozlanmoqda' });
      const created = await emitWithAck('room:create', {
        maxPlayers: 2,
        stake: 100,
        deckSize: 36,
        turnSeconds: 30,
        transferEnabled: false,
        throwInMode: 'neighbor',
        bluffEnabled: false,
        isPrivate: false,
        mode: 'classic',
        botLevel: 'medium',
      }, 5000).catch((e) => ({ ok: false, error: e.message }));
      if (!created?.ok) {
        hideRoyalLoader('duel');
        return toast(created?.error || "O'yin ochilmadi", 'error');
      }

      let moved = false;
      updateRoyalLoader({ source: 'duel', progress: 74, status: 'Kartalar aralashtirilmoqda' });
      socket.once('game:start', (gameView) => {
        moved = true;
        state.game = gameView;
        const opponent = gameView?.players?.find((p) => p.id !== (state.user || user)?.id);
        updateRoyalLoader({
          source: 'duel',
          progress: 92,
          status: 'Duel boshlanmoqda',
          players: [myName, opponent?.nickname || opponent?.username || 'RAQIB'],
        });
        navigate('game', { code: created.code });
      });
      const started = await emitWithAck('room:start', { code: created.code }, 5000)
        .catch((e) => ({ ok: false, error: e.message }));
      if (!started?.ok) {
        hideRoyalLoader('duel');
        return toast(started?.error || "O'yin boshlanmadi", 'error');
      }
      setTimeout(() => { if (!moved) navigate('game', { code: created.code }); }, 250);
    } catch (e) {
      hideRoyalLoader('duel');
      toast(e.message || 'Xatolik', 'error');
    }
  }

  return () => {
    for (const cleanup of cleanups.splice(0)) {
      try { cleanup(); } catch (_) {}
    }
    detachScroll?.();
  };
}

function brandBlock() {
  return h('div', { class: 'royal-dash-brand' }, [
    h('img', { class: 'brand-logo-img', src: '/images/durak-imperia-logo.jpg', alt: 'Durak Imperia' }),
    h('div', { class: 'brand-title' }, ['DURAK']),
    h('div', { class: 'brand-sub' }, ['IMPERIA']),
  ]);
}

function sideNav(items) {
  return h('nav', { class: 'royal-side-nav' }, items.map(([key, icon, label, onClick, badge]) =>
    h('button', { class: `royal-side-item ${key === 'home' ? 'active' : ''}`, onclick: onClick }, [
      h('span', { class: 'side-icon' }, [icon]),
      h('span', { class: 'side-label' }, [label]),
      badge ? h('b', { class: 'side-badge' }, [String(badge)]) : null,
    ].filter(Boolean))
  ));
}

function topStrip(user) {
  const premium = user.premium_until && new Date(user.premium_until) > new Date();
  return h('header', { class: 'royal-dash-top' }, [
    h('button', { class: 'dash-profile', onclick: () => navigate('profile') }, [
      h('div', { class: `avatar xl color-${avatarColorFor(user.id || user.username)} ${user.selected_avatar_frame ? `profile-frame frame-${user.selected_avatar_frame}` : ''}` }, [
        user.avatar_url ? h('img', { src: user.avatar_url, alt: user.username || 'avatar' }) : avatarLetter(user.username || user.nickname),
      ]),
      h('div', { class: 'dash-profile-meta' }, [
        h('strong', {}, [user.nickname ? `@${user.nickname}` : `@${user.username || 'guest'}`]),
        h('span', {}, [`🏆 ${premium ? 'Premium Liga' : 'Oltin Liga'}   ♞ ${Number(user.rating || 0).toLocaleString()}`]),
        h('div', { class: 'dash-level-row' }, [
          h('b', {}, [String(user.level ?? 0)]),
          h('i', {}, [h('em', { style: `width:${Math.min(100, Number(user.level_progress ?? 0))}%` })]),
          h('small', {}, [`${Number(user.level_progress ?? 0)} / 100`]),
        ]),
      ]),
    ]),
    balanceCard('💵', Number(user.coins || 0), 'DURAK DOLLARI', () => navigate('shop', { tab: 'dollar' })),
    balanceCard('🪙', Number(user.gold_coins || 0), 'GOLD COIN', () => navigate('shop', { tab: 'gold' })),
    h('div', { class: 'dash-top-actions' }, [
      topAction('🎁', "Do'stlar", () => navigate('friends')),
      topAction('✉', 'Xabarlar', () => toast('Yangi xabarlar o\'yin ichida ko\'rinadi', 'info'), 3),
      topAction('⚙', 'Sozlamalar', () => navigate('settings')),
    ]),
  ]);
}

function balanceCard(icon, value, label, onClick) {
  return h('button', { class: 'dash-balance', onclick: onClick }, [
    h('span', {}, [icon]),
    h('strong', {}, [value.toLocaleString()]),
    h('small', {}, [label]),
    h('b', {}, ['+']),
  ]);
}

function topAction(icon, label, onClick, badge) {
  return h('button', { class: 'dash-action', onclick: onClick }, [
    h('span', {}, [icon]),
    h('small', {}, [label]),
    badge ? h('b', {}, [String(badge)]) : null,
  ].filter(Boolean));
}

function featureCard({ className, title, subtitle, art, button, onClick }) {
  return h('article', { class: `dash-feature-card ${className}` }, [
    h('h2', {}, [title]),
    h('p', {}, [subtitle]),
    art,
    h('button', { class: 'dash-gold-btn', onclick: onClick }, [button]),
  ]);
}

function miniCard(icon, title, text, button, onClick, className) {
  return h('article', { class: `dash-mini-card ${className}` }, [
    h('div', { class: 'mini-icon' }, [icon]),
    h('h3', {}, [title]),
    h('p', {}, [text]),
    h('button', { class: 'dash-dark-btn', onclick: onClick }, [button]),
  ]);
}

function promoPanel({ className, title, text, icon, button, onClick }) {
  return h('section', { class: `dash-promo ${className}` }, [
    h('div', {}, [
      h('h3', {}, [title]),
      h('p', {}, [text]),
      h('button', { class: 'dash-gold-btn small', onclick: onClick }, [button]),
    ]),
    h('span', { class: 'promo-icon' }, [icon]),
  ]);
}

function barabanPanel(status, user, refresh, panelAt = Date.now(), cleanups = []) {
  const requiredGames = Math.max(0, Number(status?.requiredGames ?? status?.required_games ?? 10));
  const gamesPlayed = Number(status?.gamesPlayed ?? status?.games_played ?? user.games_played ?? 0);
  const locked = status?.unlocked === undefined ? gamesPlayed < requiredGames : !status.unlocked;
  const canSpin = !locked && !!status?.canSpin;
  const waitingForStatus = !locked && !status;
  const nextMs = Number(status?.nextSpinMs || 0);
  const extraSpins = Number(status?.extraSpins ?? status?.extra_spins ?? 0);
  const timer = locked
    ? `${gamesPlayed}/${requiredGames} o'yin`
    : extraSpins > 0
      ? `Bonus spin x${extraSpins}`
    : canSpin
      ? 'Tayyor'
      : waitingForStatus
        ? 'Tekshirilmoqda'
        : formatDuration(nextMs);
  const receivedAt = Number(status?._clientReceivedAt || panelAt || Date.now());
  let liveCanSpin = canSpin;
  let lastTimerText = timer;
  let expiryRefreshRequested = false;
  const timerValue = h('span', { class: 'baraban-time-value' }, ['']);
  const buttonEl = h('button', {
    class: `dash-gold-btn small ${canSpin ? '' : 'disabled'}`,
    onclick: () => liveCanSpin
      ? spinBaraban(refresh)
      : toast(locked ? `Baraban ${requiredGames} ta o'yindan keyin ochiladi` : (waitingForStatus ? 'Baraban holati tekshirilmoqda' : `Keyingi spin: ${lastTimerText}`), 'info'),
  }, ['AYLANTIRISH']);

  const updateCountdown = () => {
    const elapsed = Math.max(0, Date.now() - receivedAt);
    const left = Math.max(0, nextMs - elapsed);
    liveCanSpin = canSpin || (!locked && !waitingForStatus && left <= 0);
    lastTimerText = locked
      ? `${gamesPlayed}/${requiredGames} o'yin`
      : liveCanSpin
        ? (extraSpins > 0 ? `Bonus spin x${extraSpins}` : 'Tayyor')
        : waitingForStatus
          ? 'Tekshirilmoqda'
          : formatDuration(left);
    timerValue.textContent = lastTimerText;
    buttonEl.classList.toggle('disabled', !liveCanSpin);
    if (liveCanSpin && !canSpin && !expiryRefreshRequested) {
      expiryRefreshRequested = true;
      invalidateHomePanelCache();
      setTimeout(() => refresh?.(), 250);
    }
  };
  updateCountdown();
  if (!locked && !canSpin && !waitingForStatus && nextMs > 0) {
    const interval = setInterval(updateCountdown, 1000);
    cleanups.push(() => clearInterval(interval));
  }

  return h('section', { class: 'dash-promo baraban' }, [
    h('div', {}, [
      h('h3', {}, ['KUNLIK BARABAN']),
      h('p', {}, [extraSpins > 0 ? 'Bonus aylantirish huquqi bor' : 'Har 24 soatda 1 marta bepul']),
      h('div', { class: 'baraban-time live', 'aria-live': 'polite' }, [String.fromCodePoint(0x23f1), ' ', timerValue]),
      buttonEl,
    ]),
    h('span', { class: 'promo-icon wheel' }, [String.fromCodePoint(0x1f3a1)]),
  ]);
}

async function spinBaraban(refresh) {
  sfx.play('click');
  const wheel = openBarabanWheel();
  try {
    wheel.setStatus('Server natijani tekshiryapti...');
    const result = await api.request('POST', '/baraban/spin');
    wheel.setStatus('Baraban aylanmoqda...');
    await wheel.spinTo(pickPrizeSegmentIndex(result));
    applyBarabanBalances(result);
    sfx.play(result?.prize_type === 'empty' ? 'click' : 'coin');
    wheel.showResult(result, () => {
      wheel.close();
      invalidateHomePanelCache();
      refresh?.();
    });
    refreshLiveState('baraban-spin', { force: true }).catch(() => {});
  } catch (e) {
    wheel.showError(e.message || 'Baraban ishlamadi');
  }
}

function barabanWheelBackground() {
  const slice = 360 / BARABAN_SEGMENTS.length;
  return `conic-gradient(${BARABAN_SEGMENTS.map((seg, i) => (
    `${seg.color} ${i * slice}deg ${(i + 1) * slice}deg`
  )).join(', ')})`;
}

function pickPrizeSegmentIndex(result) {
  const type = result?.prize_type || 'empty';
  const amount = Number(result?.prize_amount || 0);
  const matches = BARABAN_SEGMENTS
    .map((seg, index) => ({ seg, index }))
    .filter((item) => item.seg.type === type);
  if (!matches.length) return 0;
  const exact = matches.find((item) => item.seg.amount === amount);
  if (exact) return exact.index;
  return matches[Math.abs(amount) % matches.length].index;
}

function openBarabanWheel() {
  document.querySelector('.baraban-wheel-bg')?.remove();
  const slice = 360 / BARABAN_SEGMENTS.length;
  const wheel = h('div', {
    class: 'baraban-wheel',
    style: { background: barabanWheelBackground() },
  }, [
    ...BARABAN_SEGMENTS.map((seg, index) => h('span', {
      class: 'baraban-segment-label',
      style: `--angle:${index * slice + slice / 2}deg`,
    }, [
      h('b', {}, [seg.label]),
      h('small', {}, [seg.value]),
    ])),
    h('i', { class: 'baraban-wheel-rim' }, []),
    h('strong', { class: 'baraban-wheel-center' }, ['SPIN']),
  ]);
  const status = h('p', { class: 'baraban-wheel-status' }, ['Tayyorlanmoqda...']);
  const resultBox = h('div', { class: 'baraban-result-box' }, [
    h('b', {}, ['Mukofot serverda tasdiqlangandan keyin hisobga qo‘shiladi']),
  ]);
  const action = h('button', { class: 'dash-gold-btn small', disabled: true }, ['Kuting']);
  const bg = h('div', { class: 'baraban-wheel-bg' }, [
    h('div', { class: 'baraban-wheel-modal' }, [
      h('div', { class: 'baraban-wheel-head' }, [
        h('div', {}, [
          h('h2', {}, ['KUNLIK BARABAN']),
          h('p', {}, ['Natija backend orqali beriladi, balans avtomatik yangilanadi']),
        ]),
        h('button', { class: 'baraban-wheel-x', onclick: () => bg.remove(), title: 'Yopish' }, ['×']),
      ]),
      h('div', { class: 'baraban-wheel-stage' }, [
        h('div', { class: 'baraban-pointer' }, []),
        wheel,
      ]),
      status,
      resultBox,
      h('div', { class: 'baraban-wheel-actions' }, [action]),
    ]),
  ]);
  document.body.appendChild(bg);

  return {
    close: () => bg.remove(),
    setStatus(text) {
      status.textContent = text;
    },
    spinTo(index) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const duration = reduce ? 900 : 4700;
      const center = index * slice + slice / 2;
      const rotation = (reduce ? 360 : 360 * 7) - center;
      wheel.style.transitionDuration = `${duration}ms`;
      requestAnimationFrame(() => {
        wheel.classList.add('is-spinning');
        wheel.style.transform = `rotate(${rotation}deg)`;
      });
      return new Promise((resolve) => setTimeout(() => {
        wheel.classList.remove('is-spinning');
        resolve();
      }, duration + 120));
    },
    showResult(result, onClose) {
      const lines = prizeDetailLines(result);
      resultBox.innerHTML = '';
      resultBox.classList.remove('error');
      resultBox.classList.toggle('empty', result?.prize_type === 'empty');
      resultBox.classList.toggle('win', result?.prize_type !== 'empty');
      resultBox.appendChild(h('strong', {}, [prizeLabel(result)]));
      for (const line of lines) resultBox.appendChild(h('span', {}, [line]));
      status.textContent = result?.prize_type === 'empty'
        ? "Bu safar bo'sh chiqdi, balans o'zgarmadi"
        : result?.prize_type === 'reroll'
          ? 'Bonus aylantirish huquqi yozildi'
        : 'Mukofot backendda tasdiqlandi va hisobingizga yozildi';
      action.disabled = false;
      action.textContent = 'Yopish';
      action.onclick = onClose;
    },
    showError(message) {
      resultBox.innerHTML = '';
      resultBox.classList.add('error');
      resultBox.appendChild(h('strong', {}, [message]));
      status.textContent = 'Baraban to‘xtadi';
      action.disabled = false;
      action.textContent = 'Yopish';
      action.onclick = () => bg.remove();
      toast(message, 'error');
    },
  };
}

function applyBarabanBalances(result) {
  const balances = result?.balances || {};
  if (!state.user) state.user = {};
  if (balances.coins !== undefined) state.user.coins = Number(balances.coins || 0);
  if (balances.gold_coins !== undefined) state.user.gold_coins = Number(balances.gold_coins || 0);
  if (balances.tournament_tickets !== undefined) state.user.tournament_tickets = Number(balances.tournament_tickets || 0);
  if (balances.premium_until !== undefined) state.user.premium_until = balances.premium_until;
  if (balances.selected_avatar_frame !== undefined) state.user.selected_avatar_frame = balances.selected_avatar_frame;
  if (balances.rank_wins !== undefined) state.user.rank_wins = Number(balances.rank_wins || 0);
  if (balances.rank_color !== undefined) state.user.rank_color = balances.rank_color;
  if (balances.rank_lines !== undefined) state.user.rank_lines = Number(balances.rank_lines || 0);
  if (balances.rank_pluses !== undefined) state.user.rank_pluses = Number(balances.rank_pluses || 0);
  if (balances.rank_progress !== undefined) state.user.rank_progress = Number(balances.rank_progress || 0);
  if (balances.baraban_extra_spins !== undefined) state.user.baraban_extra_spins = Number(balances.baraban_extra_spins || 0);
}

function prizeDetailLines(result) {
  const balances = result?.balances || {};
  const lines = [];
  const amount = Number(result?.prize_amount || 0);
  if (result?.prize_type === 'coins' && amount > 0) lines.push(`Hisobga qo'shildi: +${amount.toLocaleString()} Durak Dollar`);
  if ((result?.prize_type === 'gold_coin' || result?.prize_type === 'jackpot') && amount > 0) lines.push(`Hisobga qo'shildi: +${amount.toLocaleString()} Gold Coin`);
  if (result?.prize_type === 'tournament_ticket' && amount > 0) lines.push(`Hisobga qo'shildi: +${amount.toLocaleString()} turnir bileti`);
  if (result?.prize_type === 'premium_day' && amount > 0) lines.push(`Premium faollashdi: +${amount} kun VIP`);
  if (result?.prize_type === 'rank_points' && amount > 0) lines.push(`Reytingga qo'shildi: +${amount.toLocaleString()} ochko`);
  if (result?.prize_type === 'reroll') lines.push('Ikkinchi marta aylantirish huquqi berildi');
  if (result?.item?.label) lines.push(`Kolleksiyaga qo'shildi: ${result.item.label}`);
  if (result?.prize_type === 'empty') lines.push("Balans o'zgarmadi");
  if (result?.multiplier && Number(result.multiplier) > 1) lines.push(`Ko‘paytirgich: x${result.multiplier}`);
  if (balances.coins !== undefined) lines.push(`Durak Dollar: ${Number(balances.coins || 0).toLocaleString()}`);
  if (balances.gold_coins !== undefined) lines.push(`Gold Coin: ${Number(balances.gold_coins || 0).toLocaleString()}`);
  if (balances.tournament_tickets !== undefined) lines.push(`Turnir bileti: ${Number(balances.tournament_tickets || 0).toLocaleString()}`);
  if (balances.rank_wins !== undefined) lines.push(`Reyting: ${Number(balances.rank_wins || 0).toLocaleString()}`);
  if (balances.baraban_extra_spins !== undefined && Number(balances.baraban_extra_spins || 0) > 0) {
    lines.push(`Bonus spin: ${Number(balances.baraban_extra_spins || 0).toLocaleString()}`);
  }
  return lines;
}

function leadersPanel(leaders) {
  return h('section', { class: 'dash-leaders' }, [
    h('h3', {}, ["BUGUNGI TOP O'YINCHILAR", h('span', {}, ['›'])]),
    ...leaders.slice(0, 3).map((p, idx) => h('div', { class: 'dash-leader-row' }, [
      h('b', {}, [String(idx + 1)]),
      h('span', { class: `avatar sm color-${avatarColorFor(p.id || p.username)}` }, [avatarLetter(p.username || p.nickname)]),
      h('strong', {}, [p.nickname || p.username || `player_${idx + 1}`]),
      h('em', {}, [`${Number(p.score || p.wins || 0).toLocaleString()} 🏆`]),
    ])),
  ]);
}

function aiBanner(user) {
  return h('section', { class: 'dash-ai-banner' }, [
    h('div', { class: 'ai-bot-art' }, ['🤖']),
    h('div', {}, [
      h('h2', {}, ["SUN'IY INTELLEKT YORDAMCHISI ", h('span', {}, ['AI'])]),
      h('p', {}, ["Savollaringiz bormi? O'yin qoidalari, premium, donat va turnirlar haqida AI yordamchidan so'rang!"]),
    ]),
    h('button', { class: 'dash-purple-btn', onclick: () => openHomeAI(user) }, ['YORDAM OLISH  •••']),
  ]);
}

function bottomBar(refresh) {
  const items = [
    ['◷', "O'yin tarixi", () => navigate('profile')],
    ['▶', 'Reklama +$800', () => claimRewardedAd(refresh)],
    ['🎙', 'Ovozli chat', () => toast('Ovozli chat faqat 1 ga 1 o\'yinda yoqiladi', 'info')],
    ['i', 'Qoidalar', () => navigate('rules')],
    ['⇥', 'Chiqish', () => navigate('login')],
  ];
  return h('footer', { class: 'royal-dash-bottom' }, items.map(([icon, label, onClick, badge]) =>
    h('button', { onclick: onClick }, [
      h('span', {}, [icon]),
      h('small', {}, [label]),
      badge ? h('b', {}, [String(badge)]) : null,
    ].filter(Boolean))
  ));
}

function normalizeLeaders(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.users)) return data.users;
  if (Array.isArray(data?.leaders)) return data.leaders;
  return [];
}

function fallbackLeaders(user) {
  return [
    user,
    { username: 'IslomKing', score: 12850 },
    { username: 'CARD_MASTER', score: 11420 },
  ].filter(Boolean);
}

function formatDuration(ms) {
  const safe = Math.max(0, Number(ms || 0));
  const h = Math.floor(safe / 3600000);
  const m = Math.floor((safe % 3600000) / 60000);
  const s = Math.floor((safe % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function prizeLabel(result) {
  const amount = Number(result?.prize_amount || 0).toLocaleString();
  const map = {
    empty: "Bo'sh chiqdi. Keyingi safar omad!",
    coins: `+${amount} Durak Dollar olindi`,
    gold_coin: `+${amount} Gold Coin olindi`,
    sticker: "Yangi stiker kolleksiyangizga qo'shildi",
    card: "Yangi karta kolleksiyangizga qo'shildi",
    tournament_ticket: 'Turnir chiptasi olindi',
    jackpot: `JACKPOT! +${amount} Gold Coin`,
    premium_day: `VIP faollashdi: ${amount} kun`,
    avatar_frame: 'Eksklyuziv avatar olindi',
    emoji_pack: "Emoji pack kolleksiyaga qo'shildi",
    rank_points: `+${amount} reyting ochkosi`,
    reroll: 'Ikkinchi aylantirish huquqi olindi',
  };
  return map[result?.prize_type] || 'Sovrin olindi';
}

async function shareInvite() {
  sfx.play('click');
  try {
    let me = state.user;
    if (!me?.referral_code) {
      try { me = await api.me(); state.user = me; } catch (_) {}
    }
    const refCode = me?.referral_code || me?.nickname || me?.username || (me?.id ? me.id.replace(/-/g, '').slice(0, 10) : 'PLAY');
    const url = `${location.origin}/?ref=${encodeURIComponent(refCode)}`;
    const text = `Durak Imperia - premium karta o'yini. Mening havolam: ${url}`;
    if (navigator.share) {
      await navigator.share({ title: 'Durak Imperia', text, url });
      toast('Havola yuborildi', 'success');
      return;
    }
    await navigator.clipboard?.writeText(url);
    toast('Havola nusxalandi', 'success');
  } catch (e) {
    if (e?.name !== 'AbortError') toast(e.message || 'Havola yuborilmadi', 'error');
  }
}

async function claimRewardedAd(refresh) {
  const user = state.user || {};
  const key = `imperia_last_ad_${user.id || 'guest'}`;
  const last = Number(localStorage.getItem(key) || 0);
  const left = last + AD_COOLDOWN_MS - Date.now();
  if (left > 0) {
    toast(`Keyingi reklama: ${formatDuration(left)}`, 'info');
    return;
  }
  const rewarded = await showNativeRewardedAd();
  if (!rewarded?.completed) {
    toast('Reklama yakunlanmadi', 'error');
    return;
  }
  try {
    const result = await api.adBonus({ adSource: rewarded.source, reward: rewarded.reward });
    localStorage.setItem(key, String(Date.now()));
    if (state.user) state.user.coins = result.coins;
    toast(`+$${Number(result.awarded || AD_REWARD).toLocaleString()} olindi`, 'success');
    refresh?.();
  } catch (e) {
    toast(e.message || 'Mukofot berilmadi', 'error');
  }
}

function showRoyalModal(title, lines, buttons = [['Yopish', () => document.querySelector('.royal-info-modal-bg')?.remove()]]) {
  document.querySelector('.royal-info-modal-bg')?.remove();
  const bg = h('div', { class: 'royal-info-modal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } }, [
    h('div', { class: 'royal-info-modal' }, [
      h('h2', {}, [title]),
      ...lines.map((line) => h('p', {}, [line])),
      h('div', { class: 'royal-info-actions' }, buttons.map(([label, onClick]) =>
        h('button', { class: 'dash-gold-btn small', onclick: onClick }, [label])
      )),
    ]),
  ]);
  document.body.appendChild(bg);
}

function openHomeAI(user) {
  document.querySelector('.royal-ai-modal-bg')?.remove();
  let messages = [
    { role: 'ai', text: "Assalomu alaykum! Durak qoidalari, premium, donat, do'kon, baraban yoki turnir haqida savol bering." },
  ];
  let busy = false;

  const bg = h('div', { class: 'royal-ai-modal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } });
  const modal = h('div', { class: 'royal-ai-modal' });
  bg.appendChild(modal);
  document.body.appendChild(bg);

  const draw = () => {
    modal.innerHTML = '';
    const list = h('div', { class: 'royal-ai-list' }, messages.map((m) =>
      h('div', { class: `royal-ai-msg ${m.role}` }, [
        h('span', {}, [m.role === 'ai' ? '🤖' : '♟']),
        h('p', {}, [m.text]),
      ])
    ));
    const input = h('input', {
      placeholder: 'Savol yozing...',
      maxlength: '300',
      disabled: busy,
      onkeydown: (e) => {
        if (e.key === 'Enter') send(e.target.value);
      },
    });
    modal.appendChild(h('div', { class: 'royal-ai-head' }, [
      h('strong', {}, ['Imperia AI']),
      h('button', { onclick: () => bg.remove() }, ['×']),
    ]));
    modal.appendChild(list);
    modal.appendChild(h('div', { class: 'royal-ai-input' }, [
      input,
      h('button', { disabled: busy, onclick: () => send(input.value) }, ['➤']),
    ]));
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
      input.focus();
    });
  };

  const send = async (text) => {
    text = String(text || '').trim();
    if (!text || busy) return;
    busy = true;
    messages.push({ role: 'user', text });
    messages.push({ role: 'ai', text: 'Yozmoqda...' });
    draw();
    try {
      await api.aiConsume();
      await initAI();
      await askAI(text, user?.id || 'guest', !!user?.premium_until, (partial, done) => {
        messages[messages.length - 1].text = partial || '...';
        if (done) busy = false;
        draw();
      });
    } catch (e) {
      messages[messages.length - 1].text = e.message || "Bugungi so'rov limiti tugadi. Premium cheksiz so'rov beradi.";
      busy = false;
      draw();
    }
  };

  draw();
}
