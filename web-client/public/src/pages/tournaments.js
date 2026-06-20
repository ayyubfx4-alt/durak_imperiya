import { h } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { state, toast } from '../state.js';
import { avatarColorFor, avatarLetter, flagEmoji } from '../cards.js';
import { sfx } from '../sfx.js?v=164-i18n-audio';
import { connectSocket } from '../socket.js';
import { completeRoyalLoader, hideRoyalLoader, showRoyalLoader, updateRoyalLoader } from '../royalLoading.js?v=129-royal-loader-clean';

const BRACKET_THRESHOLD = 32;
let VIEW = 'live';
let tournamentLiveCleanups = [];

function clearTournamentLiveCleanups() {
  for (const cleanup of tournamentLiveCleanups.splice(0)) {
    try { cleanup(); } catch (_) {}
  }
}

export async function renderTournaments(root) {
  clearTournamentLiveCleanups();
  const cleanups = tournamentLiveCleanups;
  root.innerHTML = '';
  showRoyalLoader({
    source: 'tournament',
    variant: 'tournament',
    title: 'TURNIR',
    subtitle: 'Kubok va bracket loading',
    status: 'Turnir jadvali, mukofotlar va live reyting tayyorlanmoqda',
    progress: 60,
    items: ['TROPHY', 'BRACKET', 'PRIZE'],
  });
  try { state.user = await api.me(); } catch (_) {}

  const screen = h('div', { class: 'screen royal-tournament-screen' });
  const body = h('main', { class: 'royal-tournament-body' }, [loading()]);
  screen.appendChild(renderTopbar());
  screen.appendChild(h('div', { class: 'royal-tournament-layout' }, [
    renderSideNav(root),
    body,
  ]));
  screen.appendChild(renderBottomNav());
  root.appendChild(screen);

  try {
    updateRoyalLoader({ source: 'tournament', progress: 78, status: 'Jonli turnirlar va bracket olinmoqda' });
    const overview = await api.tournamentOverview().catch(async () => ({
      featured: (await api.tournamentsList().catch(() => []))[0] || null,
      tournaments: await api.tournamentsList().catch(() => []),
      topPlayers: await api.leaderboard('season', 10).catch(() => []),
      hall: await api.tournamentHallOfFame().catch(() => []),
      entry: { goldCoins: 35, ticketAccepted: true },
      prizes: [],
      broadcastThreshold: BRACKET_THRESHOLD,
    }));
    body.innerHTML = '';
    if (VIEW === 'live') await renderLiveDashboard(body, root, overview, cleanups);
    else if (VIEW === 'upcoming') renderTournamentList(body, root, overview.tournaments || []);
    else if (VIEW === 'mine') await renderMine(body, root, overview);
    else if (VIEW === 'history') renderHistory(body, overview.hall || []);
    else if (VIEW === 'rules') renderRules(body, overview);
    else renderRanking(body, overview.topPlayers || []);
    completeRoyalLoader('TURNIR TAYYOR', 560, 'tournament');
  } catch (e) {
    hideRoyalLoader('tournament');
    body.innerHTML = '';
    body.appendChild(h('div', { class: 'royal-tournament-empty' }, [e.message || 'Turnir yuklanmadi']));
  }
  return clearTournamentLiveCleanups;
}

function renderTopbar() {
  const me = state.user || {};
  return h('header', { class: 'royal-tournament-top' }, [
    h('button', { class: 'rt-back', onclick: () => { sfx.play('click'); navigate('home'); } }, ['‹']),
    h('div', { class: 'rt-title' }, [
      h('strong', {}, ['TOURNIR']),
      h('small', {}, ['LIVE CUP']),
    ]),
    h('div', { class: 'rt-balance-row' }, [
      balance('GC', fmt(me.gold_coins || 0), () => navigate('shop')),
      balance('$', fmt(me.coins || 0), () => navigate('shop')),
    ]),
    h('button', { class: 'rt-crown', onclick: () => navigate('profile') }, ['♛']),
  ]);
}

function balance(icon, value, onClick) {
  return h('button', { class: 'rt-balance', onclick: onClick }, [
    h('span', {}, [icon]),
    h('b', {}, [value]),
    h('i', {}, ['+']),
  ]);
}

function renderSideNav(root) {
  const items = [
    ['live', '🏆', 'Jonli turnirlar'],
    ['upcoming', '◷', 'Kelayotgan'],
    ['mine', '♛', 'Menga turnirlar'],
    ['history', '▣', 'Tarix'],
    ['rules', '▤', 'Qoidalar'],
    ['ranking', '▥', 'Reyting'],
  ];
  return h('aside', { class: 'royal-tournament-side' }, [
    h('div', { class: 'rt-side-tabs' }, items.map(([key, icon, label]) => h('button', {
      class: VIEW === key ? 'active' : '',
      onclick: () => { sfx.play('click'); VIEW = key; renderTournaments(root); },
    }, [h('span', {}, [icon]), h('b', {}, [label])]))),
    h('div', { class: 'rt-ticket-card' }, [
      h('small', {}, ['Sizning chipingiz']),
      h('strong', {}, [fmt((state.user || {}).gold_coins || 0)]),
      h('button', { onclick: () => navigate('shop') }, ['+']),
    ]),
    h('div', { class: 'rt-support-card' }, [
      h('small', {}, ['Qo‘llab-quvvatlash']),
      h('strong', {}, ['Donat']),
      h('p', {}, ['Majburiy emas, loyiha rivoji uchun.']),
      h('button', { onclick: () => navigate('donations') }, ['Donat']),
    ]),
  ]);
}

async function renderLiveDashboard(body, root, overview, cleanups = []) {
  const tour = overview.featured;
  const bracket = await loadBracket(tour);
  const entries = tour ? await api.tournamentEntries(tour.id).catch(() => []) : [];
  body.appendChild(renderHero(root, tour, overview, entries, cleanups));
  let _liveActiveTab = 'live';
  const _liveTabs = h('section', { class: 'rt-main-tabs' }, []);

  function _setLiveTab(key, selector) {
    _liveActiveTab = key;
    _liveTabs.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === key);
    });
    if (selector) scrollToSelector(selector);
  }

  [
    { key: 'live',    label: 'Jonli',             selector: null },
    { key: 'bracket', label: 'Bracket',           selector: '.rt-bracket-card' },
    { key: 'top',     label: 'Top o‘yinchilar', selector: '.rt-top-card' },
    { key: 'info',    label: 'Ma’lumot',       selector: '.rt-info-grid' },
  ].forEach(({ key, label, selector }) => {
    const _btn = h('button', {
      class: key === _liveActiveTab ? 'active' : '',
      onclick: () => _setLiveTab(key, selector),
    }, [label]);
    _btn.dataset.tab = key;
    _liveTabs.appendChild(_btn);
  });

  body.appendChild(_liveTabs);
  body.appendChild(renderBracketCard(root, tour, bracket, entries, overview));
  body.appendChild(h('section', { class: 'rt-info-grid' }, [
    renderInfoCard(tour, overview),
    renderTopPlayers(overview.topPlayers || []),
    renderPrizeCard(tour, overview),
  ]));
}

function renderHero(root, tour, overview, entries, cleanups = []) {
  const max = Number(tour?.max_players || 64);
  const joined = Number(tour?.entries || entries.length || 0);
  const entry = Number(tour?.entry_gold_coins || overview.entry?.goldCoins || 35);
  const prize = prizeFund(tour, overview);
  const starts = liveTimeUntil(tour?.starts_at, cleanups);
  return h('section', { class: 'rt-hero' }, [
    h('div', { class: 'rt-cup-art' }, [
      h('div', { class: 'rt-cup' }, ['♛']),
      h('div', { class: 'rt-cards-glow' }, ['A', 'K', 'Q']),
    ]),
    h('div', { class: 'rt-hero-copy' }, [
      h('small', {}, ['Durak Imperia']),
      h('h1', {}, [tour?.name || 'Grand Cup']),
      h('p', {}, [tour ? 'Eng kuchlilar maydoni.' : 'Hozircha ochiq turnir yo‘q. Admin paneldan yangi turnir oching.']),
      h('div', { class: 'rt-hero-stats' }, [
        stat('Sovrin fondi', `${fmt(prize)} GC`),
        stat('O‘yinchi', `${joined}/${max}`),
        stat('Translyatsiya', Number(tour?.remaining || max) <= BRACKET_THRESHOLD && tour?.bracket_seeded ? 'Jonli' : '32 qolganda'),
      ]),
    ]),
    h('div', { class: 'rt-prize-panel' }, [
      h('small', {}, ['Sovrin fondi']),
      h('strong', {}, [fmt(prize)]),
      h('span', {}, [`$${fmt(Math.round(prize / 1000))} ekvivalent`]),
      h('div', { class: 'rt-countdown' }, [
        h('small', {}, ['Tur boshlanishiga']),
        starts,
      ]),
      h('button', {
        disabled: !tour || tour.status !== 'scheduled',
        onclick: async () => {
          if (!tour) return;
          sfx.play('coin');
          try {
            const r = await api.tournamentRegister(tour.id);
            toast(r?.alreadyRegistered ? 'Siz allaqachon ro‘yxatdasiz' : 'Turnirga qo‘shildingiz', 'success');
            renderTournaments(root);
          } catch (e) {
            toast(e.message || 'Turnirga kirib bo‘lmadi', 'error');
          }
        },
      }, [tour?.status === 'running' ? 'Turnir boshlangan' : `Turnirga qo‘shilish · ${fmt(entry)} GC`]),
    ]),
  ]);
}

function stat(label, value) {
  return h('div', {}, [h('b', {}, [value]), h('span', {}, [label])]);
}

async function loadBracket(tour) {
  if (!tour || !tour.bracket_seeded || Number(tour.remaining || 999) > BRACKET_THRESHOLD) return null;
  try {
    const socket = connectSocket();
    socket.emit('tournament:watch', { tournamentId: tour.id });
  } catch (_) {}
  return api.tournamentBracket(tour.id).catch(() => null);
}

function renderBracketCard(root, tour, bracket, entries, overview) {
  const open = !!bracket?.matches?.length;
  return h('section', { class: 'rt-bracket-card' }, [
    h('div', { class: 'rt-section-head' }, [
      h('div', {}, [
        h('h2', {}, ['Bracket']),
        h('p', {}, [open ? `${Number(bracket.viewers || 0)} tomoshabin · sovg‘alar jonli ko‘rinadi` : `${overview.broadcastThreshold || BRACKET_THRESHOLD} ishtirokchi qolganda to‘liq ochiladi`]),
      ]),
      open ? h('button', { onclick: () => scrollToSelector('.rt-bracket-board') }, ['To‘liq bracket']) : null,
    ].filter(Boolean)),
    open ? renderBracketBoard(root, tour, bracket) : renderPreviewBracket(tour, entries, overview),
    open ? renderGiftPanel(root, tour, entries) : null,
  ].filter(Boolean));
}

function renderBracketBoard(root, tour, bracket) {
  const rounds = new Map();
  for (const match of bracket.matches || []) {
    if (!rounds.has(match.round_no)) rounds.set(match.round_no, []);
    rounds.get(match.round_no).push(match);
  }
  return h('div', { class: 'rt-bracket-board' }, [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([round, matches]) => (
    h('div', { class: 'rt-bracket-round' }, [
      h('h3', {}, [roundLabel(round, rounds.size)]),
      ...matches.map((m) => renderMatch(root, tour, m)),
    ])
  )));
}

function renderMatch(root, tour, match) {
  const a = match.a_username || match.a_bot_name || 'Kutilmoqda';
  const b = match.b_username || match.b_bot_name || 'Kutilmoqda';
  const live = match.status === 'live' && match.room_code;
  return h('div', { class: `rt-match ${match.status || ''}` }, [
    playerLine(a, match.winner_entry_id === match.entry_a_id),
    playerLine(b, match.winner_entry_id === match.entry_b_id),
    live ? h('button', {
      onclick: () => navigate('game', { code: match.room_code, spectate: '1', tournamentId: tour.id, matchId: match.id }),
    }, ['Tomosha']) : null,
  ].filter(Boolean));
}

function playerLine(name, winner) {
  return h('div', { class: winner ? 'winner' : '' }, [h('span', {}, [avatarLetter(name)]), h('b', {}, [name]), h('em', {}, [winner ? '2' : '0'])]);
}

function renderPreviewBracket(tour, entries = [], overview = {}) {
  const threshold = Number(overview.broadcastThreshold || BRACKET_THRESHOLD);
  const joined = Number(tour?.entries || entries.length || 0);
  const remaining = Number(tour?.remaining || joined || 0);
  const realEntries = (entries || [])
    .filter((entry) => entry.user_id && (entry.username || entry.nickname))
    .slice(0, 8);

  return h('div', { class: 'rt-bracket-board preview locked' }, [
    h('div', { class: 'rt-bracket-round' }, [
      h('h3', {}, ['Saralash']),
      realEntries.length
        ? h('div', { class: 'rt-preview-entry-list' }, realEntries.map((entry) => previewEntry(entry)))
        : h('div', { class: 'rt-final-box' }, [
            h('b', {}, ['Hali real ishtirokchi yo‘q']),
            h('span', {}, ['Turnirga ro‘yxatdan o‘tgan o‘yinchilar shu yerda ko‘rinadi.']),
          ]),
    ]),
    h('div', { class: 'rt-bracket-round' }, [
      h('h3', {}, ['Bracket']),
      h('div', { class: 'rt-final-box' }, [
        h('b', {}, [`${threshold} qolganda ochiladi`]),
        h('span', {}, [
          joined
            ? `Hozir ro‘yxatda ${fmt(joined)} ta o‘yinchi bor${remaining ? `, ${fmt(remaining)} ta faol` : ''}.`
            : 'Bracket faqat real ishtirokchilar bilan tuziladi.',
        ]),
      ]),
    ]),
    h('div', { class: 'rt-bracket-round' }, [
      h('h3', {}, ['Jonli tomosha']),
      h('div', { class: 'rt-final-box' }, [
        h('b', {}, ['Demo matchlar ko‘rsatilmaydi']),
        h('span', {}, ['Live room va sovg‘alar faqat backend bracket yaratgandan keyin ochiladi.']),
      ]),
    ]),
  ]);
}

function previewEntry(entry) {
  const name = entry.nickname || entry.username || 'Ishtirokchi';
  return h('div', { class: 'rt-match preview-entry' }, [
    h('div', {}, [h('span', {}, [avatarLetter(name)]), h('b', {}, [name]), h('em', {}, ['real'])]),
  ]);
}

function renderGiftPanel(root, tour, entries) {
  const select = h('select', {}, entries.filter((e) => e.user_id).slice(0, 32).map((e) => h('option', { value: e.id }, [e.username || 'Ishtirokchi'])));
  return h('div', { class: 'rt-gift-panel' }, [
    h('strong', {}, ['Tomoshabin sovg‘asi']),
    select,
    h('button', { onclick: () => sendGift(root, tour, select, 'emoji', 'classic:smile', 2) }, ['Emoji x2']),
    h('button', { onclick: () => sendGift(root, tour, select, 'sticker_pack', 'pack_panda', 1) }, ['Sticker']),
  ]);
}

async function sendGift(root, tour, select, itemType, itemId, quantity) {
  if (!select.value) return toast('Ishtirokchini tanlang', 'error');
  try {
    await api.tournamentGift(tour.id, { recipientEntryId: select.value, itemType, itemId, quantity });
    toast('Sovg‘a yuborildi', 'success');
    renderTournaments(root);
  } catch (e) {
    toast(e.message || 'Sovg‘a yuborilmadi', 'error');
  }
}

function renderInfoCard(tour, overview) {
  const entry = Number(tour?.entry_gold_coins || overview.entry?.goldCoins || 35);
  return h('section', { class: 'rt-info-card' }, [
    h('h2', {}, ['Turnir ma’lumoti']),
    info('Tur nomi', tour?.name || 'Grand Cup'),
    info('Format', 'KO (Knockout)'),
    info('O‘yinchilar', `${fmt(tour?.entries || 0)} / ${fmt(tour?.max_players || 64)}`),
    info('Kiritish uchun', `${fmt(entry)} GC yoki chipta`),
    info('Boshlanish vaqti', formatDate(tour?.starts_at)),
    info('Tur vaqti', '~ 2 soat'),
    info('Karta tartibi', '36 karta'),
    h('button', { onclick: () => navigate('donations') }, ['Qo‘llab-quvvatlash']),
  ]);
}

function renderTopPlayers(players) {
  const rows = (players || []).slice(0, 5);
  return h('section', { class: 'rt-top-card' }, [
    h('h2', {}, ['Top o‘yinchilar']),
    ...rows.map((p, idx) => h('div', { class: 'rt-top-row' }, [
      h('b', {}, [String(idx + 1)]),
      h('span', { class: `avatar sm color-${avatarColorFor(p.id || p.username)}` }, [p.avatar_url ? h('img', { src: p.avatar_url, alt: p.username }) : avatarLetter(p.nickname || p.username)]),
      h('strong', {}, [`${flagEmoji(p.country_code) || ''} ${p.nickname || p.username || 'Player'}`.trim()]),
      h('em', {}, [`${fmt(p.games_won || p.score || 0)} win`]),
      h('i', {}, [`${fmt(p.gold_coins || p.coins || 0)}`]),
    ])),
    !rows.length ? h('div', { class: 'rt-muted' }, ['Hali reyting yo‘q']) : null,
  ].filter(Boolean));
}

function renderPrizeCard(tour, overview) {
  const prizes = (overview.prizes || []).length ? overview.prizes : [
    { place: '1', goldCoins: Number(tour?.prize_first_gold_coins || 150), dollars: 150 },
    { place: '2', goldCoins: Number(tour?.prize_second_gold_coins || 75), dollars: 75 },
    { place: '3', goldCoins: Number(tour?.prize_third_gold_coins || 25), dollars: 25 },
  ];
  return h('section', { class: 'rt-prizes-card' }, [
    h('h2', {}, ['Sovrinlar']),
    ...prizes.map((p) => h('div', { class: 'rt-prize-row' }, [
      h('b', {}, [p.place]),
      h('strong', {}, [`${fmt(p.goldCoins)} GC`]),
      h('span', {}, [`$${fmt(p.dollars || Math.round(Number(p.goldCoins || 0) / 1000))}`]),
    ])),
    h('button', { onclick: () => toast('Sovrinlar turnir yakunida avtomatik Gold Coin hisobiga tushadi.', 'info') }, ['Barcha sovrinlar']),
  ]);
}

function renderTournamentList(body, root, tournaments) {
  body.appendChild(h('section', { class: 'rt-list-panel' }, [
    h('div', { class: 'rt-section-head' }, [h('div', {}, [h('h2', {}, ['Kelayotgan turnirlar']), h('p', {}, ['Ro‘yxatdan o‘tish ochiq turnirlar.'])])]),
    ...(tournaments || []).map((t) => tournamentRow(root, t)),
    !(tournaments || []).length ? h('div', { class: 'royal-tournament-empty' }, ['Hozircha ochiq turnir yo‘q']) : null,
  ].filter(Boolean)));
}

function tournamentRow(root, tour) {
  return h('button', { class: 'rt-tour-row', onclick: () => { VIEW = 'live'; renderTournaments(root); } }, [
    h('span', {}, ['🏆']),
    h('strong', {}, [tour.name]),
    h('small', {}, [`${fmt(tour.entries || 0)}/${fmt(tour.max_players || 64)} o‘yinchi · ${fmt(tour.entry_gold_coins || 35)} GC`]),
    h('b', {}, [tour.status === 'running' ? 'Jonli' : 'Ro‘yxat']),
  ]);
}

async function renderMine(body, root, overview) {
  renderTournamentList(body, root, overview.tournaments || []);
}

function renderHistory(body, hall) {
  body.appendChild(h('section', { class: 'rt-list-panel' }, [
    h('div', { class: 'rt-section-head' }, [h('div', {}, [h('h2', {}, ['Turnir tarixi']), h('p', {}, ['Oxirgi g‘oliblar va sovrinlar.'])])]),
    ...(hall || []).map((row) => h('div', { class: 'rt-history-row' }, [
      h('b', {}, [placeIcon(row.placement)]),
      h('strong', {}, [`${flagEmoji(row.country_code) || ''} ${row.nickname || row.username || 'Player'}`.trim()]),
      h('span', {}, [row.tournament_name || 'Turnir']),
      h('em', {}, [`${fmt(row.gold_coins || 0)} GC`]),
    ])),
    !(hall || []).length ? h('div', { class: 'royal-tournament-empty' }, ['Hali g‘oliblar yo‘q']) : null,
  ].filter(Boolean)));
}

function renderRules(body, overview) {
  body.appendChild(h('section', { class: 'rt-list-panel rt-rules' }, [
    h('h2', {}, ['Qoidalar']),
    h('p', {}, [`Kirish: ${fmt(overview.entry?.goldCoins || 35)} GC yoki 1 ta turnir chiptasi.`]),
    h('p', {}, ['Saralashda bracket ko‘rinmaydi. 32 ishtirokchi qolgandan keyin bracket va tomosha ochiladi.']),
    h('p', {}, ['Sovrinlar Gold Coin hisobiga avtomatik yoziladi.']),
    h('p', {}, ['Tomoshabinlar ortiqcha emoji, sticker va kartalarni sovg‘a qilishi mumkin.']),
  ]));
}

function renderRanking(body, players) {
  body.appendChild(renderTopPlayers(players));
}

function renderBottomNav() {
  const items = [
    ['Do‘stlar', () => navigate('friends')],
    ['Xabarlar', () => { toast('Yozma chat o‘yindan tashqarida, xabarlar bosh sahifada ochiladi', 'info'); navigate('home'); }],
    ['Bosh sahifa', () => navigate('home')],
    ['Turnir', () => {}],
    ['Profil', () => navigate('profile')],
  ];
  return h('nav', { class: 'rt-bottom-nav' }, items.map(([label, onClick]) => h('button', { class: label === 'Turnir' ? 'active' : '', onclick: onClick }, [h('span', {}, [navIcon(label)]), h('b', {}, [label])])));
}

function navIcon(label) {
  return label === 'Do‘stlar' ? '👥' : label === 'Xabarlar' ? '✉' : label === 'Bosh sahifa' ? '⌂' : label === 'Profil' ? '◉' : '🏆';
}

function loading() {
  return h('div', { class: 'royal-tournament-empty' }, ['Yuklanmoqda...']);
}

function info(label, value) {
  return h('div', { class: 'rt-info-row' }, [h('span', {}, [label]), h('b', {}, [value || '-'])]);
}

function prizeFund(tour, overview) {
  if (!tour) return 0;
  return Number(tour.prize_first_gold_coins || 0) + Number(tour.prize_second_gold_coins || 0) + Number(tour.prize_third_gold_coins || 0)
    || (overview.prizes || []).reduce((sum, p) => sum + Number(p.goldCoins || 0), 0);
}

function roundLabel(round, total) {
  if (round >= total) return 'Final';
  if (round === total - 1) return '1/2 Final';
  if (round === total - 2) return '1/4 Final';
  return `1/${2 ** Math.max(1, total - round + 1)} Final`;
}

function placeIcon(place) {
  if (Number(place) === 1) return '🥇';
  if (Number(place) === 2) return '🥈';
  if (Number(place) === 3) return '🥉';
  return String(place || '-');
}

function scrollToSelector(selector) {
  document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatDate(value) {
  if (!value) return 'Belgilanmagan';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Belgilanmagan';
  return d.toLocaleString();
}

function timeUntil(value) {
  if (!value) return '00 : 00 : 00';
  const ms = Math.max(0, new Date(value).getTime() - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)} : ${pad(m)} : ${pad(s)}`;
}

function liveTimeUntil(value, cleanups = []) {
  const node = h('b', { class: 'rt-live-countdown', 'aria-live': 'polite' }, ['00 : 00 : 00']);
  const targetMs = value ? new Date(value).getTime() : 0;
  const update = () => {
    node.textContent = timeUntil(value);
  };
  update();
  if (targetMs > Date.now()) {
    const interval = setInterval(update, 1000);
    cleanups.push(() => clearInterval(interval));
  }
  return node;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmt(n) {
  return Number(n || 0).toLocaleString();
}
