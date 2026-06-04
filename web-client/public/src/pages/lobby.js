// Lobby — Stollar (rasm 3 va 4 ga aniq mos)
// Yangi: "Tez o'yin" (Quick Match), Yopiq stol kod ulashish.
import { h } from '../ui.js';
import { api } from '../api.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { connectSocket, emitWithAck } from '../socket.js';
import { t } from '../i18n.js';
import { sfx } from '../sfx.js?v=111-encoding-fix';

// TOR §4.1 bet tiers — backend config.js bilan bir xil
const DEFAULT_BET_TIERS = (() => {
  const head = [100, 200, 250, 500, 1000, 2500, 3000];
  const ramp = [];
  for (let v = 5000; v <= 1000000; v += 5000) ramp.push(v);
  return [...head, ...ramp];
})();

function getTiers() {
  return [
    { id: 'novice',  key: 'lobby.novice',  label: 'Yangi boshlovchi', maxStake: 1000 },
    { id: 'amateur', key: 'lobby.amateur', label: 'Havaskor',          maxStake: 10000 },
    { id: 'pro',     key: 'lobby.pro',     label: 'Professional',      maxStake: Infinity },
  ];
}

function tSafe(key, fallback) {
  const value = t(key);
  return value && value !== key ? value : fallback;
}

function formatStake(n) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n/100)/10}K`;
  return String(n);
}

export async function renderLobby(root, params = {}) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'screen bg-lobby' });
  root.appendChild(wrap);

  let activeTier = 0;
  let sizeFilter = { 2: true, 3: true, 4: true, 6: true };
  let allRooms = [];
  let activeFilters = { cards: true, throwIn: false, bluff: false, private: true, speed: true, fast: false, coin: true };
  let openedPrivateFromRoute = false;
  let privateRoomsBg = null;
  const TIERS = getTiers();

  // ── Top bar ──────────────────────────────────────────────────────────
  wrap.appendChild(h('div', { class: 'lobby-topbar' }, [
    h('button', { class: 'btn-icon', onclick: () => { sfx.play('click'); navigate('home'); } }, ['◀']),
    h('div', { class: 'title' }, ['Stollar']),
    h('div', { class: 'coins' }, [`$${(state.user?.coins || 0).toLocaleString()}`]),
  ]));

  // ── Tier Tabs (lobby.novice / amateur / pro) ────────────────────────
  const tierTabsEl = h('div', { class: 'tier-tabs' });
  TIERS.forEach((tier, i) => {
    const tab = h('div', {
      class: `tier-tab${i === activeTier ? ' active' : ''}`,
      onclick: () => { sfx.play('click'); activeTier = i; renderTabs(); renderList(); },
    }, [tSafe(tier.key, tier.label)]);
    tierTabsEl.appendChild(tab);
  });
  wrap.appendChild(tierTabsEl);

  function renderTabs() {
    Array.from(tierTabsEl.children).forEach((el, i) => {
      el.className = `tier-tab${i === activeTier ? ' active' : ''}`;
    });
  }

  // ── Filter Bar (rasm 3 dagi filter ikonkalar) ────────────────────────
  const filtersBar = h('div', { class: 'filters-bar' });
  filtersBar.appendChild(h('div', { class: 'header' }, ['Filtr sozlamalari']));
  const icons = h('div', { class: 'icons' }, [
    h('div', { class: 'ic-grp' }, [
      filterIc('🃏', 'cards', 'Klassik'),
      filterIc('↻', 'throwIn', 'Tashlash'),
      filterIc('🎭', 'bluff', 'Aldash'),
      filterIc('🔒', 'private', 'Yopiq'),
    ]),
    h('div', { class: 'ic-grp' }, [
      filterIc('▶', 'speed', 'O\'rta tezlik'),
      filterIc('▶▶', 'fast', 'Tez'),
      h('div', { style: 'font-size:11px;color:var(--rc-text-muted);margin:0 4px' }, ['100-1K']),
      h('div', { class: 'ic active' }, ['💰']),
    ]),
    h('div', { class: 'ic-grp' }, [
      h('div', { class: 'ic active', style: 'font-size:11px' }, ['36']),
    ]),
  ]);
  filtersBar.appendChild(icons);
  wrap.appendChild(filtersBar);

  function filterIc(emoji, key, title) {
    const el = h('div', {
      class: `ic${activeFilters[key] ? ' active' : ''}`,
      title,
      onclick: () => { activeFilters[key] = !activeFilters[key]; el.className = `ic${activeFilters[key] ? ' active' : ''}`; sfx.play('click'); renderList(); },
    }, [emoji]);
    return el;
  }

  // ── Quick Play button (mijoz so'ragan "Tez o'yin") ──────────────────
  wrap.appendChild(h('div', { style: 'padding:8px 12px' }, [
    h('button', {
      class: 'btn-big green',
      style: 'min-height:48px;font-size:16px',
      onclick: () => quickMatch(),
    }, ['⚡  TEZ O\'YIN — avtomatik stol topish']),
  ]));

  // ── Room List ────────────────────────────────────────────────────────
  const list = h('div', { class: 'scroll' });
  wrap.appendChild(list);

  // ── Size Filters + New Table button ─────────────────────────────────
  const sizeBar = h('div', { class: 'size-filters' });
  [2, 3, 4, 6].forEach(n => {
    const id = `chk-${n}`;
    const cb = h('input', { type: 'checkbox', id, checked: true });
    cb.checked = true;
    cb.addEventListener('change', () => { sizeFilter[n] = cb.checked; renderList(); });
    const label = document.createElement('label');
    label.htmlFor = id;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(`${n} kishi`));
    sizeBar.appendChild(label);
  });
  sizeBar.appendChild(h('button', { class: 'btn-new', onclick: () => { sfx.play('click'); promptCreate(); } }, ['YANGI STOL']));
  wrap.appendChild(sizeBar);

  // ── Bottom Navigation (rasm 3 da pastdagi tugmalar) ──────────────────
  wrap.appendChild(h('div', { class: 'bottom-tabs' }, [
    h('div', { class: 'tab', onclick: () => { sfx.play('click'); navigate('profile'); } }, [
      h('span', { class: 'ic' }, ['♣']),
      h('div', {}, ['Profil']),
    ]),
    h('div', { class: 'tab active' }, [
      h('span', { class: 'ic' }, ['♥']),
      h('div', {}, ['Stollar']),
    ]),
    h('div', { class: 'tab', onclick: () => { sfx.play('click'); openPrivateRoomsList(); } }, [
      h('span', { class: 'ic' }, ['🔒']),
      h('div', {}, ['Yopiq']),
    ]),
    h('div', { class: 'tab', onclick: () => { sfx.play('click'); promptCreate(); } }, [
      h('span', { class: 'ic' }, ['➕']),
      h('div', {}, ['Yaratish']),
    ]),
  ]));

  // ── Render rooms list ────────────────────────────────────────────────
  function renderList() {
    list.innerHTML = '';
    const tier = TIERS[activeTier];
    const prevTierMax = activeTier > 0 ? TIERS[activeTier - 1].maxStake : 0;

    let filtered = allRooms.filter(r => {
      if (!sizeFilter[r.maxPlayers]) return false;
      if (r.stake <= prevTierMax) return false;
      if (r.stake > tier.maxStake) return false;
      if (activeFilters.bluff && !r.bluffEnabled) return false;
      if (!activeFilters.private && r.isPrivate) return false;
      return true;
    });

    if (!filtered.length) {
      list.appendChild(h('div', { class: 'p-16 text-c muted', style: 'padding:40px 16px;font-size:14px' }, [
        h('div', { style: 'font-size:42px;margin-bottom:10px;opacity:.5' }, ['🎴']),
          h('div', {}, [tSafe('lobby.no_rooms', 'Ochiq stollar yo‘q. Yarating!')]),
      ]));
      return;
    }

    for (const r of filtered) {
      const taken = r.seats.filter(Boolean).length;
      const names = r.seats.filter(Boolean).map(s => s.username).join(', ') || '—';

      const row = h('div', { class: `room-row${r.isPrivate ? ' private-room-row' : ''}`, onclick: () => joinRoom(r.code, '', r) }, [
        h('div', { class: 'left' }, [
          h('div', { class: 'names' }, [names]),
          h('div', { class: 'meta' }, [
            h('span', { class: 'stake' }, [`💰 $${formatStake(r.stake)}`]),
            r.isPrivate ? h('span', { class: 'private-badge' }, ['🔒 Yopiq']) : null,
            Number.isFinite(Number(r.realCount)) ? h('span', {}, [`Real ${r.realCount}/${r.maxPlayers}`]) : null,
            h('span', {}, [`👤 ${taken}/${r.maxPlayers}`]),
            h('span', {}, [`🃏 ${r.deckSize || 36}`]),
            h('span', {}, [`⏱ ${r.turnSeconds || 30}s`]),
          ].filter(Boolean)),
        ]),
        h('div', { class: 'right' }, [
          h('div', { class: 'mode-icons' }, [
            h('div', { class: 'ic' }, ['36']),
            r.bluffEnabled ? h('div', { class: 'ic' }, ['🎭']) : null,
            r.isPrivate ? h('div', { class: 'ic' }, ['🔒']) : null,
          ].filter(Boolean)),
          h('div', { class: 'arrow' }, ['›']),
        ]),
      ]);
      list.appendChild(row);
    }
  }

  // ── Socket Listeners ─────────────────────────────────────────────────
  let socket = null;
  try {
    socket = connectSocket();
    socket.emit('rooms:list');
    socket.on('rooms:list', (rooms) => {
      allRooms = rooms || [];
      renderList();
      if (privateRoomsBg?.isConnected) setTimeout(openPrivateRoomsList, 0);
      if ((params.private === '1' || params.private === 'true') && !openedPrivateFromRoute) {
        openedPrivateFromRoute = true;
        setTimeout(openPrivateRoomsList, 60);
      }
    });
  } catch (err) {
    list.innerHTML = '';
    list.appendChild(h('div', { class: 'game-flow-error-card lobby-error-card' }, [
      h('div', { class: 'game-flow-error-icon' }, ['!']),
      h('h2', {}, ['Server bilan aloqa yo\'q']),
      h('p', {}, [err.message || 'Stollar ro\'yxati yuklanmadi.']),
      h('button', { class: 'btn-big green mt-16', onclick: () => renderLobby(root) }, ['Qayta urinish']),
    ]));
  }

  // ── Actions ──────────────────────────────────────────────────────────
  async function joinRoom(code, password = '', roomInfo = null) {
    sfx.play('click');
    if (roomInfo?.isPrivate && !password) {
      return promptPasswordForRoom(roomInfo);
    }
    const resp = await emitWithAck('room:join', { code, password }, 5000).catch(e => ({ ok: false, error: e.message }));
    if (!resp?.ok && resp?.error === 'wrong password') {
      return promptPasswordForRoom({ code });
    }
    if (!resp?.ok) return toast(resp?.error || 'Qo\'shilib bo\'lmadi', 'error');
    navigate('room', { code });
  }

  function promptPasswordForRoom(room) {
    const taken = Array.isArray(room.seats) ? room.seats.filter(Boolean).length : 0;
    const card = h('div', { class: 'modal private-password-modal' }, [
      h('h2', {}, ['🔒 Yopiq stol']),
      h('div', { class: 'private-room-code' }, ['Parol kerak']),
      h('div', { class: 'private-room-safe-meta' }, [
        h('span', {}, [`$${formatStake(room.stake || 0)}`]),
        h('span', {}, [`${taken}/${room.maxPlayers || '?'}`]),
        h('span', {}, [`${room.deckSize || 36} karta`]),
        h('span', {}, [`${room.turnSeconds || 30}s`]),
      ]),
      h('p', {}, ['Bu stol yopiq. Kirish uchun parolni kiriting.']),
      h('input', { id: '_room_pass', type: 'password', placeholder: 'Parol', maxlength: '24', autocomplete: 'off' }),
      h('div', { class: 'row mt-16 gap-12' }, [
        h('button', { class: 'btn-secondary grow', onclick: () => bg.remove() }, ['Bekor']),
        h('button', { class: 'btn-big green grow', style: 'width:auto;min-height:auto;padding:13px', onclick: async () => {
          const password = (card.querySelector('#_room_pass').value || '').trim();
          if (!password) return toast('Parol kiriting', 'error');
          bg.remove();
          await joinRoom(room.code, password);
        }}, ['Kirish']),
      ]),
    ]);
    const bg = h('div', { class: 'modal-bg' }, [card]);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    root.appendChild(bg);
    setTimeout(() => card.querySelector('#_room_pass')?.focus(), 50);
  }

  function openPrivateRoomsList() {
    if (privateRoomsBg?.isConnected) privateRoomsBg.remove();
    const privateRooms = allRooms
      .filter((r) => r.isPrivate && r.state?.phase !== 'playing')
      .sort((a, b) => (b.taken || 0) - (a.taken || 0) || (a.stake || 0) - (b.stake || 0));

    const rows = privateRooms.map((r) => {
      const taken = Array.isArray(r.seats) ? r.seats.filter(Boolean).length : Number(r.taken || 0);
      const names = Array.isArray(r.seats)
        ? r.seats.filter(Boolean).map((s) => s.username).join(', ')
        : '';
      return h('button', {
        class: 'private-room-list-item',
        type: 'button',
        onclick: () => {
          privateRoomsBg = null;
          bg.remove();
          promptPasswordForRoom(r);
        },
      }, [
        h('div', { class: 'private-room-list-top' }, [
          h('strong', {}, [names || r.host || 'Yopiq stol']),
          h('span', {}, ['Yopiq']),
        ]),
        h('div', { class: 'private-room-list-meta' }, [
          h('span', {}, [`💰 $${formatStake(r.stake || 0)}`]),
          h('span', {}, [`👤 ${taken}/${r.maxPlayers}`]),
          h('span', {}, [`🃏 ${r.deckSize || 36}`]),
          h('span', {}, [`⏱ ${r.turnSeconds || 30}s`]),
          r.bluffEnabled ? h('span', {}, ['🎭 Aldash']) : null,
        ].filter(Boolean)),
        h('small', {}, ['Parol yashirilgan. Kirish uchun ustiga bosing.']),
      ]);
    });

    const card = h('div', { class: 'modal private-rooms-modal' }, [
      h('div', { class: 'private-rooms-head' }, [
        h('div', {}, [
          h('h2', {}, ['🔒 Yopiq stollar']),
          h('p', {}, ['Parollar ko‘rsatilmaydi. Stolni tanlang, keyin parol kiriting.']),
        ]),
        h('button', { class: 'btn-icon', onclick: () => { privateRoomsBg = null; bg.remove(); } }, ['X']),
      ]),
      privateRooms.length
        ? h('div', { class: 'private-room-list' }, rows)
        : h('div', { class: 'private-room-empty' }, [
            h('b', {}, ['Hozircha yopiq stol yo‘q']),
            h('span', {}, ['Do‘stingiz yuborgan kod bo‘lsa, kod orqali qo‘shiling.']),
          ]),
      h('div', { class: 'row mt-16 gap-12' }, [
        h('button', { class: 'btn-secondary grow', onclick: () => { privateRoomsBg = null; bg.remove(); } }, ['Yopish']),
      ]),
    ]);
    const bg = h('div', { class: 'modal-bg private-rooms-bg' }, [card]);
    bg.addEventListener('click', e => {
      if (e.target === bg) {
        privateRoomsBg = null;
        bg.remove();
      }
    });
    privateRoomsBg = bg;
    root.appendChild(bg);
  }

  async function quickMatch() {
    sfx.play('click');
    if (!socket) return toast('Server bilan aloqa yo\'q', 'error');
    socket.emit('rooms:list');
    await new Promise(r => setTimeout(r, 400));

    const me = state.user || {};
    const liveCoins = me.coins || 0;

    // 1. Odam kutayotgan ochiq stolni topishga harakat.
    const candidates = allRooms
      .filter(r => !r.isPrivate && r.taken < r.maxPlayers && r.stake <= liveCoins)
      .sort((a, b) => (b.taken || 0) - (a.taken || 0));

    if (candidates.length) {
      const target = candidates[0];
      const resp = await emitWithAck('room:join', { code: target.code }, 4000).catch(() => ({ ok: false }));
      if (resp?.ok) return navigate('room', { code: target.code });
    }
    // 2. Topilmasa — yangi 2-kishilik tez stol yaratish
    const stake = Math.min(100, liveCoins);
    if (liveCoins < 100) {
      toast('100$ minimum tikish uchun yetarli mablag\' yo\'q', 'error');
      return;
    }
    const resp = await emitWithAck('room:create', {
      maxPlayers: 2, stake: 100, bluffEnabled: false, isPrivate: false, botLevel: 'medium',
    }, 4000).catch(e => ({ ok: false, error: e.message }));
    if (!resp?.ok) return toast(resp?.error || 'Stol yaratib bo\'lmadi', 'error');
    navigate('room', { code: resp.code });
  }

  function promptJoinPrivate() {
    openPrivateRoomsList();
  }

  function promptCreate() {
    let betIndex = Math.max(0, DEFAULT_BET_TIERS.indexOf(1000));
    const updateBet = () => {
      const value = DEFAULT_BET_TIERS[betIndex] || 1000;
      const out = card.querySelector('[data-bet-value]');
      const range = card.querySelector('[data-key=betRange]');
      if (out) out.textContent = value.toLocaleString('ru-RU');
      if (range) range.value = String(betIndex);
    };
    const card = h('div', { class: 'modal create-room-modal create-room-3d' }, [
      h('div', { class: 'create-bet-top' }, [
        h('span', {}, ['Tikish miqdori']),
        h('strong', { 'data-bet-value': '1' }, ['1 000']),
        h('i', {}, ['$']),
      ]),
      h('div', { class: 'create-slider-wrap' }, [
        (() => {
          const range = h('input', {
            type: 'range',
            min: '0',
            max: String(DEFAULT_BET_TIERS.length - 1),
            value: String(betIndex),
            'data-key': 'betRange',
            class: 'bet-slider pro-slider',
          });
          range.addEventListener('input', () => { betIndex = Number(range.value); updateBet(); });
          return range;
        })(),
        h('div', { class: 'slider-marks' }, [
          h('span', {}, ['100']), h('span', {}, ['1K']), h('span', {}, ['10K']), h('span', {}, ['100K']), h('span', {}, ['1M']),
        ]),
      ]),
      h('div', { class: 'create-section-title' }, ['O\'yinchilar']),
      segmented('players players-segment', [['2','2'],['3','3'],['4','4'],['6','6']], '2'),
      h('div', { class: 'create-two-cols' }, [
        h('div', {}, [h('div', { class: 'create-section-title small' }, ['Karta soni']), segmented('deckSize', [['24','24'],['36','36'],['52','52']], '36')]),
        h('div', {}, [h('div', { class: 'create-section-title small' }, ['Yurish vaqti']), segmented('turnSeconds', [['30','30s'],['15','15s']], '30')]),
      ]),
      h('div', { class: 'create-section-title' }, ['Qoidalar']),
      h('div', { class: 'mode-tile-grid' }, [
        modeTile('transfer', 'Tashlash', '↪', true, 'throwStyle'),
        modeTile('neighbors', 'Yonlar', '⇄', true, 'throwScope'),
        modeTile('bluff', 'Aldash', '🎩', false, 'tricks'),
        modeTile('classic', 'Oddiy', '♣', true),
        modeTile('passing', 'O\'tkazish', '↻', false, 'throwStyle'),
        modeTile('allThrow', 'Hamma', '×', false, 'throwScope'),
        modeTile('fairPlay', 'Halol', '✓', true, 'tricks'),
        modeTile('drawMode', 'Durrang', '□', true),
      ]),
      h('div', { class: 'private-create-row' }, [
        switchRow('priv', 'Yopiq xona'),
        h('input', { 'data-key': 'password', placeholder: 'Parol, masalan 1111', maxlength: '24' }),
        h('button', { class: 'create-play-button', onclick: async () => submitCreate(card, bg, betIndex) }, [
          h('span', {}, ['Stol ochish']), h('b', {}, ['▶']),
        ]),
      ]),
    ]);
    updateBet();
    const privateToggle = card.querySelector('[data-key=priv]');
    const passwordInput = card.querySelector('[data-key=password]');
    const syncPrivatePassword = () => {
      if (!passwordInput || !privateToggle) return;
      passwordInput.style.display = privateToggle.checked ? 'block' : 'none';
      passwordInput.disabled = !privateToggle.checked;
      if (!privateToggle.checked) passwordInput.value = '';
    };
    privateToggle?.addEventListener('change', syncPrivatePassword);
    syncPrivatePassword();
    const bg = h('div', { class: 'modal-bg room-create-bg' }, [card]);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    root.appendChild(bg);
  }

  async function submitCreate(card, bg, betIndex) {
    const players = Number(card.querySelector('[data-key="players players-segment"]')?.dataset.value || card.querySelector('[data-key=players]')?.dataset.value || 2);
    const bet = DEFAULT_BET_TIERS[betIndex] || 1000;
    const deckSize = Number(card.querySelector('[data-key=deckSize]')?.dataset.value || 36);
    const turnSeconds = Number(card.querySelector('[data-key=turnSeconds]')?.dataset.value || 30);
    const bluff = card.querySelector('[data-key=bluff]')?.checked || false;
    const priv = card.querySelector('[data-key=priv]')?.checked || false;
    const password = (card.querySelector('[data-key=password]')?.value || '').trim();
    const passingEnabled = card.querySelector('[data-key=passing]')?.checked || false;
    const throwInEnabled = card.querySelector('[data-key=transfer]')?.checked || false;
    const throwInMode = card.querySelector('[data-key=allThrow]')?.checked ? 'all' : 'neighbor';
    const allowDraw = card.querySelector('[data-key=drawMode]')?.checked !== false;
    if (priv && !password) return toast('Yopiq xona uchun parol kiriting', 'error');
    if (!throwInEnabled && !passingEnabled) return toast('Throw-in yoki passingdan bittasini tanlang', 'error');
    bg.remove();
    await create({
      maxPlayers: players,
      stake: bet,
      deckSize,
      turnSeconds,
      transferEnabled: passingEnabled,
      throwInMode,
      bluffEnabled: bluff,
      allowDraw,
      isPrivate: priv,
      password,
      mode: card.querySelector('[data-key=classic]')?.checked ? 'classic' : (passingEnabled ? 'passing' : 'throw-in'),
      botLevel: 'medium',
    });
  }

  async function create(opts) {
    sfx.play('click');
    const resp = await emitWithAck('room:create', opts, 5000).catch(e => ({ ok: false, error: e.message }));
    if (!resp?.ok) return toast(resp?.error || 'Xatolik', 'error');
    navigate('room', { code: resp.code });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────
function labeled(text, child) {
  return h('div', { class: 'col', style: 'gap:5px' }, [
    h('div', { style: 'font-size:12px;color:var(--rc-text-muted);font-weight:700;letter-spacing:.06em' }, [text]),
    child,
  ]);
}

function selectField(key, opts, def, prefix) {
  const sel = document.createElement('select');
  sel.dataset.key = key;
  for (const o of opts) {
    const op = document.createElement('option');
    if (Array.isArray(o)) {
      op.value = o[0]; op.textContent = o[1];
      if (o[0] === def) op.selected = true;
    } else {
      op.value = o;
      op.textContent = prefix ? `${prefix} ${Number(o).toLocaleString()}` : o;
      if (o === def) op.selected = true;
    }
    sel.appendChild(op);
  }
  return sel;
}

function segmented(key, opts, def) {
  const parts = String(key).split(/\s+/);
  const dataKey = parts.shift();
  const wrap = h('div', { class: `segmented-choice ${parts.join(' ')}`, 'data-key': dataKey });
  wrap.dataset.value = def;
  for (const [value, label] of opts) {
    const btn = h('button', {
      type: 'button',
      class: value === def ? 'active' : '',
      onclick: () => {
        wrap.dataset.value = value;
        Array.from(wrap.children).forEach((child) => child.classList.toggle('active', child === btn));
      },
    }, [label]);
    wrap.appendChild(btn);
  }
  return wrap;
}

function modeTile(key, label, icon, checked = false, group = '') {
  const cb = h('input', { type: 'checkbox', 'data-key': key, 'data-mode-group': group });
  cb.checked = checked;
  const tile = h('button', {
    type: 'button',
    class: `mode-tile ${checked ? 'active' : ''}`,
    'data-mode-group': group,
    onclick: () => {
      const next = !cb.checked;
      if (next && group) {
        const grid = tile.closest('.mode-tile-grid');
        grid?.querySelectorAll(`input[data-mode-group="${group}"]`).forEach((other) => {
          if (other === cb) return;
          other.checked = false;
          other.closest('.mode-tile')?.classList.remove('active');
        });
      }
      cb.checked = next;
      tile.classList.toggle('active', cb.checked);
      sfx.play('click');
    },
  }, [
    cb,
    h('span', { class: 'mode-check' }, ['✓']),
    h('b', {}, [icon]),
    h('small', {}, [label]),
  ]);
  return tile;
}

function switchRow(key, label) {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.key = key;
  cb.style.width = 'auto';
  cb.style.accentColor = 'var(--rc-gold)';
  cb.style.transform = 'scale(1.3)';
  const lab = document.createElement('label');
  lab.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;font-weight:600;color:var(--rc-text-bright);padding:6px 0';
  lab.appendChild(cb);
  lab.appendChild(document.createTextNode(label));
  return lab;
}

