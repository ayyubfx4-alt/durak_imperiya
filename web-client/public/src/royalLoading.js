let loaderEl = null;
let hideTimer = null;
let autoTimer = null;
let loaderSource = '';
let currentProgress = 0;

const LOADER_IMAGES = {
  boot: { src: '/images/loading/1.jpg', position: '47% center' },
  duel: { src: '/images/loading/2.jpg', position: '50% center' },
  forfeit: { src: '/images/loading/3.jpg', position: '50% center' },
  section: { src: '/images/loading/4.jpg', position: '50% center' },
  menu: { src: '/images/loading/4.jpg', position: '50% center' },
  tournament: { src: '/images/loading/5.jpg', position: '50% center' },
  exit: { src: '/images/loading/6.jpg', position: '50% center' },
};

const ROUTE_META = {
  home: {
    variant: 'menu',
    title: 'DURAK IMPERIA',
    subtitle: 'Bosh menyu ochilmoqda',
    status: 'Profil, balans va menyu tayyorlanmoqda',
    progress: 60,
    items: ['PLAY', 'SHOP', 'PROFILE', 'RANK'],
  },
  game: {
    variant: 'duel',
    title: '1 VS 1',
    subtitle: 'Battle loading',
    status: 'Xona, voice va kartalar tayyorlanmoqda',
    progress: 68,
    items: ['VOICE', 'CHAT', 'GOLD'],
  },
  tournaments: {
    variant: 'tournament',
    title: 'TURNIR',
    subtitle: 'Bracket va mukofotlar yuklanmoqda',
    status: 'Jonli turnirlar va reyting olinmoqda',
    progress: 70,
    items: ['BRACKET', 'PRIZE', 'LIVE'],
  },
  shop: {
    variant: 'section',
    title: 'IMPERIA SHOP',
    subtitle: "Premium do'kon ochilmoqda",
    status: 'Gold Coin va kolleksiyalar yuklanmoqda',
    progress: 58,
    items: ['GOLD', 'SKIN', 'STICKER'],
  },
  stickers: {
    variant: 'section',
    title: 'STICKER PACKS',
    subtitle: "3D sticker to'plamlari",
    status: 'Packlar tayyorlanmoqda',
    progress: 62,
    items: ['VAMPIR', 'ROBOT', 'WOLF'],
  },
  leaderboard: {
    variant: 'section',
    title: 'REYTING',
    subtitle: "Eng kuchli o'yinchilar",
    status: 'Natijalar saralanmoqda',
    progress: 58,
    items: ['KUNLIK', 'HAFTALIK', 'OYLIK'],
  },
  profile: {
    variant: 'section',
    title: 'PROFIL',
    subtitle: "Akkaunt ma'lumotlari",
    status: 'Daraja va nishonlar yuklanmoqda',
    progress: 55,
    items: ['LEVEL', 'BADGE', 'STATS'],
  },
  inventory: {
    variant: 'section',
    title: 'KARTALAR',
    subtitle: 'Kolleksiya ochilmoqda',
    status: 'Karta va skinlar tayyorlanmoqda',
    progress: 58,
    items: ['CARD', 'DECK', 'GIFT'],
  },
  donations: {
    variant: 'section',
    title: 'GOLD COIN',
    subtitle: "To'lov oynasi ochilmoqda",
    status: 'Paketlar va balans tekshirilmoqda',
    progress: 56,
    items: ['VISA', 'GOLD', 'SHOP'],
  },
};

function clampProgress(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function text(selector) {
  return loaderEl?.querySelector(selector) || null;
}

function normalizeVariant(source, variant) {
  if (variant && LOADER_IMAGES[variant]) return variant;
  if (source && LOADER_IMAGES[source]) return source;
  return 'section';
}

function applyLoaderImage(variant = 'boot') {
  if (!loaderEl) return;
  const meta = LOADER_IMAGES[variant] || LOADER_IMAGES.section;
  loaderEl.dataset.variant = variant;
  loaderEl.style.setProperty('--royal-loader-image', `url("${meta.src}")`);
  loaderEl.style.setProperty('--royal-loader-position', meta.position || '50% center');
  loaderEl.classList.add('uses-image');
  const bg = text('.royal-loader-bg-blur');
  if (bg) bg.style.backgroundImage = `url("${meta.src}")`;
}

function createLoader() {
  const el = document.createElement('div');
  el.className = 'royal-loader-overlay';
  el.innerHTML = `
    <div class="royal-loader-bg-blur" aria-hidden="true"></div>
    <div class="royal-loader-frame">
      <div class="royal-loader-top">
        <span data-icon="voice">VOICE</span>
        <span data-icon="chat">CHAT</span>
        <span data-icon="secure">SECURE</span>
      </div>
      <div class="royal-loader-hero">
        <div class="royal-loader-art" aria-hidden="true">
          <div class="royal-loader-card"><b>A</b><i>&#9824;</i></div>
          <div class="royal-loader-mic"></div>
        </div>
        <div class="royal-loader-brand">
          <div class="royal-loader-kicker">DURAK IMPERIA</div>
          <h1>DURAK IMPERIA</h1>
          <p>VOICE. STRATEGY. VICTORY.</p>
          <div class="royal-loader-duel" hidden>
            <span class="royal-loader-player royal-loader-player-a">SIZ</span>
            <b>VS</b>
            <span class="royal-loader-player royal-loader-player-b">RAQIB</span>
          </div>
          <div class="royal-loader-items"></div>
        </div>
      </div>
      <div class="royal-loader-progress-wrap">
        <div class="royal-loader-status">Yuklanmoqda...</div>
        <div class="royal-loader-track"><div class="royal-loader-fill"></div></div>
        <div class="royal-loader-percent">0%</div>
      </div>
    </div>
  `;
  return el;
}

function renderItems(items = []) {
  const node = text('.royal-loader-items');
  if (!node) return;
  node.innerHTML = '';
  for (const item of items.slice(0, 4)) {
    const pill = document.createElement('span');
    pill.textContent = item;
    node.appendChild(pill);
  }
}

function renderPlayers(players = [], variant = '') {
  const duel = text('.royal-loader-duel');
  if (!duel) return;
  const shouldShow = variant === 'duel';
  duel.hidden = !shouldShow;
  if (!shouldShow) return;
  const p1 = String(players?.[0] || 'SIZ').slice(0, 18);
  const p2 = String(players?.[1] || 'RAQIB').slice(0, 18);
  const a = text('.royal-loader-player-a');
  const b = text('.royal-loader-player-b');
  if (a) a.textContent = p1;
  if (b) b.textContent = p2;
}

function startAutoProgress(target = 92) {
  clearInterval(autoTimer);
  autoTimer = setInterval(() => {
    if (!loaderEl || currentProgress >= target) return;
    const step = currentProgress < 55 ? 4 : currentProgress < 80 ? 2 : 0.7;
    setRoyalLoaderProgress(Math.min(target, currentProgress + step));
  }, 180);
}

export function showRoyalLoader(options = {}) {
  if (!document.body) return null;
  clearTimeout(hideTimer);
  if (!loaderEl) loaderEl = createLoader();
  if (!loaderEl.isConnected) document.body.appendChild(loaderEl);

  loaderSource = options.source || loaderSource || 'manual';
  currentProgress = clampProgress(options.progress ?? currentProgress ?? 12);
  const variant = normalizeVariant(options.source, options.variant || 'boot');
  applyLoaderImage(variant);
  loaderEl.classList.remove('is-done', 'is-hiding');

  const title = text('.royal-loader-brand h1');
  const subtitle = text('.royal-loader-brand p');
  const status = text('.royal-loader-status');
  const kicker = text('.royal-loader-kicker');
  if (title) title.textContent = options.title || 'DURAK IMPERIA';
  if (subtitle) subtitle.textContent = options.subtitle || 'VOICE. STRATEGY. VICTORY.';
  if (status) status.textContent = options.status || 'Yuklanmoqda...';
  if (kicker) kicker.textContent = options.kicker || 'DURAK IMPERIA';
  renderItems(options.items || ['PLAY', 'VOICE', 'TOURNAMENT']);
  renderPlayers(options.players, variant);
  setRoyalLoaderProgress(currentProgress);
  startAutoProgress(options.autoTarget || 92);
  requestAnimationFrame(() => loaderEl?.classList.add('is-visible'));
  return loaderEl;
}

export function showRouteLoader(name, params = {}) {
  const meta = ROUTE_META[name] || {
    variant: 'section',
    title: 'DURAK IMPERIA',
    subtitle: `${String(name || 'menu').toUpperCase()} bo'limi`,
    status: "Bo'lim ochilmoqda",
    progress: 52,
    items: ['CARD', 'VOICE', 'TROPHY'],
  };
  showRoyalLoader({ ...meta, source: 'route' });
}

export function setRoyalLoaderProgress(progress, status) {
  currentProgress = clampProgress(progress);
  const fill = text('.royal-loader-fill');
  const percent = text('.royal-loader-percent');
  const statusNode = text('.royal-loader-status');
  if (fill) fill.style.width = `${currentProgress}%`;
  if (percent) percent.textContent = `${Math.round(currentProgress)}%`;
  if (status && statusNode) statusNode.textContent = status;
}

export function updateRoyalLoader(options = {}) {
  if (!loaderEl?.isConnected) return;
  if (options.source) loaderSource = options.source;
  const variant = options.variant ? normalizeVariant(options.source, options.variant) : loaderEl.dataset.variant;
  if (options.variant) applyLoaderImage(variant);
  const title = text('.royal-loader-brand h1');
  const subtitle = text('.royal-loader-brand p');
  const status = text('.royal-loader-status');
  const kicker = text('.royal-loader-kicker');
  if (options.title && title) title.textContent = options.title;
  if (options.subtitle && subtitle) subtitle.textContent = options.subtitle;
  if (options.status && status) status.textContent = options.status;
  if (options.kicker && kicker) kicker.textContent = options.kicker;
  if (options.items) renderItems(options.items);
  if (options.players) renderPlayers(options.players, variant);
  if (options.progress !== undefined) setRoyalLoaderProgress(options.progress, options.status);
}

export function completeRoyalLoader(status = 'READY TO PLAY', delay = 520, source = '') {
  if (!loaderEl?.isConnected) return;
  if (source && loaderSource && loaderSource !== source) return;
  clearInterval(autoTimer);
  setRoyalLoaderProgress(100, status);
  loaderEl.classList.add('is-done');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hideRoyalLoader(source), delay);
}

export function hideRoyalLoader(source = '') {
  if (!loaderEl?.isConnected) return;
  if (source && loaderSource && loaderSource !== source) return;
  clearInterval(autoTimer);
  clearTimeout(hideTimer);
  loaderEl.classList.add('is-hiding');
  loaderEl.classList.remove('is-visible');
  const el = loaderEl;
  setTimeout(() => {
    if (el === loaderEl && el.isConnected && el.classList.contains('is-hiding')) {
      el.remove();
      loaderSource = '';
      currentProgress = 0;
    }
  }, 260);
}

export function royalLoaderSource() {
  return loaderSource;
}
