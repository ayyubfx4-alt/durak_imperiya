import { h } from './ui.js';

const AVATAR_COLORS = ['green', 'purple', 'blue', 'orange', 'gray', 'red'];

const BOT_TABLE_TEMPLATES = [
  { code: 'BOT-NOV-01', title: 'Olga Movchan', stake: 100, maxPlayers: 4, names: ['Olga Movchan', 'Milos Kane'], deckSize: 36, turnSeconds: 30, transferEnabled: true, throwInMode: 'neighbor', botLevel: 'easy' },
  { code: 'BOT-NOV-02', title: 'Rabd', stake: 250, maxPlayers: 3, names: ['Rabd'], deckSize: 24, turnSeconds: 30, transferEnabled: false, throwInMode: 'neighbor', botLevel: 'medium' },
  { code: 'BOT-NOV-03', title: 'YourNightmare', stake: 500, maxPlayers: 3, names: ['YourNightmare'], deckSize: 36, turnSeconds: 15, transferEnabled: true, throwInMode: 'all', botLevel: 'medium' },
  { code: 'BOT-NOV-04', title: 'Benjamin Barr', stake: 750, maxPlayers: 4, names: ['Benjamin Barr', 'Lena Cross'], deckSize: 36, turnSeconds: 30, transferEnabled: true, throwInMode: 'neighbor', bluffEnabled: true, botLevel: 'medium' },
  { code: 'BOT-NOV-05', title: 'Elena Stone', stake: 1000, maxPlayers: 3, names: ['Elena Stone'], deckSize: 36, turnSeconds: 30, transferEnabled: false, throwInMode: 'neighbor', botLevel: 'hard' },
  { code: 'BOT-NOV-06', title: 'Diego Frost', stake: 1000, maxPlayers: 2, names: ['Diego Frost'], deckSize: 24, turnSeconds: 15, transferEnabled: true, throwInMode: 'all', bluffEnabled: true, botLevel: 'hard' },

  { code: 'BOT-AMA-01', title: 'Alexander DLG', stake: 2500, maxPlayers: 3, names: ['Alexander DLG', 'Mira Noel'], deckSize: 36, turnSeconds: 30, transferEnabled: true, throwInMode: 'neighbor', botLevel: 'medium' },
  { code: 'BOT-AMA-02', title: 'Alina Storm', stake: 2500, maxPlayers: 4, names: ['Alina Storm'], deckSize: 36, turnSeconds: 30, transferEnabled: true, throwInMode: 'all', bluffEnabled: true, botLevel: 'medium' },
  { code: 'BOT-AMA-03', title: 'Vladimir Zaulin', stake: 3000, maxPlayers: 4, names: ['Vladimir Zaulin'], deckSize: 24, turnSeconds: 30, transferEnabled: false, throwInMode: 'neighbor', botLevel: 'hard' },
  { code: 'BOT-AMA-04', title: 'Eugene Frost', stake: 5000, maxPlayers: 3, names: ['Eugene Frost'], deckSize: 36, turnSeconds: 15, transferEnabled: true, throwInMode: 'neighbor', botLevel: 'hard' },
  { code: 'BOT-AMA-05', title: 'Leon Hart', stake: 5000, maxPlayers: 4, names: ['Leon Hart', 'Sofia King'], deckSize: 36, turnSeconds: 30, transferEnabled: true, throwInMode: 'all', bluffEnabled: true, botLevel: 'hard' },
  { code: 'BOT-AMA-06', title: 'Mira Noel', stake: 10000, maxPlayers: 3, names: ['Mira Noel'], deckSize: 24, turnSeconds: 30, transferEnabled: false, throwInMode: 'neighbor', botLevel: 'hard' },

  { code: 'BOT-PRO-01', title: 'Victor Vale', stake: 15000, maxPlayers: 3, names: ['Victor Vale'], deckSize: 36, turnSeconds: 15, transferEnabled: true, throwInMode: 'all', bluffEnabled: true, botLevel: 'hard' },
  { code: 'BOT-PRO-02', title: 'Diana Cruz', stake: 20000, maxPlayers: 4, names: ['Diana Cruz', 'Marcus Reed'], deckSize: 36, turnSeconds: 30, transferEnabled: true, throwInMode: 'neighbor', botLevel: 'hard' },
  { code: 'BOT-PRO-03', title: 'Marcus Reed', stake: 50000, maxPlayers: 4, names: ['Marcus Reed'], deckSize: 24, turnSeconds: 30, transferEnabled: false, throwInMode: 'neighbor', botLevel: 'hard' },
  { code: 'BOT-PRO-04', title: 'Sofia King', stake: 100000, maxPlayers: 4, names: ['Sofia King', 'Roman West'], deckSize: 36, turnSeconds: 15, transferEnabled: true, throwInMode: 'all', bluffEnabled: true, botLevel: 'hard' },
  { code: 'BOT-PRO-05', title: 'Roman West', stake: 250000, maxPlayers: 3, names: ['Roman West'], deckSize: 36, turnSeconds: 30, transferEnabled: true, throwInMode: 'neighbor', botLevel: 'hard' },
  { code: 'BOT-PRO-06', title: 'Olivia Gray', stake: 500000, maxPlayers: 4, names: ['Olivia Gray'], deckSize: 24, turnSeconds: 30, transferEnabled: true, throwInMode: 'all', bluffEnabled: true, botLevel: 'hard' },
];

function makeSeat(name, templateIndex, seatIndex) {
  return {
    id: `demo-${templateIndex}-${seatIndex}`,
    username: name,
    nickname: name,
    ready: seatIndex % 2 === 0,
    isBot: true,
    country_code: null,
    avatarColor: AVATAR_COLORS[(templateIndex + seatIndex) % AVATAR_COLORS.length],
    avatarLines: (templateIndex + seatIndex) % 4,
    avatarPluses: (templateIndex + seatIndex + 1) % 3,
    rankWins: 12 + (templateIndex * 7) + seatIndex,
  };
}

function makeSyntheticRoom(template, index) {
  const seats = Array.from({ length: template.maxPlayers }, (_, seatIndex) => {
    const name = template.names[seatIndex];
    return name ? makeSeat(name, index, seatIndex) : null;
  });
  return {
    ...template,
    seats,
    taken: seats.filter(Boolean).length,
    realCount: 0,
    syntheticBotTable: true,
    host: template.title,
    isPrivate: false,
    hasPassword: false,
    allowDraw: true,
    mode: 'classic',
    state: { phase: 'lobby' },
  };
}

const DEMO_BOT_TABLES = BOT_TABLE_TEMPLATES.map(makeSyntheticRoom);

function cloneRoom(room) {
  return {
    ...room,
    state: room.state ? { ...room.state } : undefined,
    seats: Array.isArray(room.seats)
      ? room.seats.map((seat) => (seat ? { ...seat } : null))
      : [],
  };
}

export function tableTaken(room = {}) {
  if (Number.isFinite(Number(room.taken))) return Number(room.taken);
  return Array.isArray(room.seats) ? room.seats.filter(Boolean).length : 0;
}

export function tableNameList(room = {}) {
  const seats = Array.isArray(room.seats) ? room.seats : [];
  return seats
    .filter(Boolean)
    .map((seat) => seat.nickname || seat.username || seat.name)
    .filter(Boolean);
}

export function tableDisplayName(room = {}, fallback = 'Open table') {
  if (room.title) return room.title;
  const names = tableNameList(room);
  if (names.length) return names.join(', ');
  return room.host || fallback;
}

export function formatDemoStake(n) {
  const value = Number(n || 0);
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 100) / 10}K`;
  return String(value);
}

export function getDemoBotTables(options = {}) {
  const minStake = Number(options.minStake ?? -Infinity);
  const maxStake = Number(options.maxStake ?? Infinity);
  const sizeFilter = options.sizeFilter || null;
  const bluffOnly = !!options.bluffOnly;
  const minRows = Number(options.minRows ?? options.min ?? 6);
  const baseRooms = DEMO_BOT_TABLES
    .filter((room) => Number(room.stake || 0) > minStake)
    .filter((room) => Number(room.stake || 0) <= maxStake)
    .filter((room) => !sizeFilter || sizeFilter[room.maxPlayers] !== false);
  let rooms = bluffOnly ? baseRooms.filter((room) => room.bluffEnabled) : baseRooms;
  if (bluffOnly && rooms.length < minRows) {
    const used = new Set(rooms.map((room) => room.code));
    rooms = [...rooms, ...baseRooms.filter((room) => !used.has(room.code))];
  }
  return rooms.map(cloneRoom);
}

export function withDemoBotTables(rooms = [], options = {}) {
  const realRooms = (Array.isArray(rooms) ? rooms : []).map(cloneRoom);
  const minRows = Number(options.minRows ?? options.min ?? 6);
  const maxRows = Number(options.maxRows ?? options.max ?? Math.max(minRows, realRooms.length + minRows));
  const existingCodes = new Set(realRooms.map((room) => String(room.code || '').toUpperCase()).filter(Boolean));
  const demoRooms = getDemoBotTables(options).filter((room) => !existingCodes.has(String(room.code || '').toUpperCase()));
  const needed = Math.max(minRows - realRooms.length, 0);
  const budget = Math.max(maxRows - realRooms.length, 0);
  const count = Math.min(budget, Math.max(needed, Number(options.alwaysAdd || 0)));
  return [...realRooms, ...demoRooms.slice(0, count)];
}

export function createDemoRoomPayload(room = {}) {
  return {
    maxPlayers: Number(room.maxPlayers || 3),
    stake: Number(room.stake || 100),
    deckSize: Number(room.deckSize || 36),
    turnSeconds: Number(room.turnSeconds || 30),
    transferEnabled: !!room.transferEnabled,
    throwInMode: room.throwInMode === 'all' ? 'all' : 'neighbor',
    bluffEnabled: !!room.bluffEnabled,
    allowDraw: room.allowDraw !== false,
    isPrivate: false,
    mode: room.mode || 'classic',
    botLevel: room.botLevel || 'medium',
  };
}

function roomIcon(label, title) {
  return h('span', { class: 'demo-room-icon', title }, [label]);
}

function roomPortrait(room = {}) {
  const name = tableDisplayName(room, 'Table');
  return h('span', { class: 'demo-room-portrait', 'aria-hidden': 'true' }, [
    h('span', {}, [room.isPrivate ? '🔒' : String(name).trim().slice(0, 1).toUpperCase()]),
  ]);
}

export function renderDemoRoomRow(room = {}, options = {}) {
  const taken = tableTaken(room);
  const maxPlayers = Number(room.maxPlayers || (Array.isArray(room.seats) ? room.seats.length : 0) || 2);
  const stake = Number(room.stake || 0);
  const formatStake = options.formatStake || formatDemoStake;
  const names = tableNameList(room);
  const title = tableDisplayName(room, 'Open table');
  const metaName = names.length > 1 ? names.slice(0, 2).join(', ') : '';
  const classes = [
    'demo-room-row',
    options.compact ? 'compact' : '',
    options.privateList ? 'private-list-row' : '',
    room.isPrivate ? 'is-private' : '',
    room.syntheticBotTable ? 'is-demo-bot' : '',
  ].filter(Boolean).join(' ');

  return h('button', {
    type: 'button',
    class: classes,
    onclick: () => options.onJoin?.(room),
  }, [
    roomPortrait(room),
    h('span', { class: 'demo-room-main' }, [
      h('span', { class: 'demo-room-name' }, [title]),
      metaName ? h('span', { class: 'demo-room-subname' }, [metaName]) : null,
      h('span', { class: 'demo-room-meta' }, [
        h('span', { class: 'demo-room-stake' }, [formatStake(stake)]),
        h('span', { class: 'demo-room-players' }, [`${taken}/${maxPlayers}`]),
      ]),
    ]),
    h('span', { class: 'demo-room-icons', 'aria-hidden': 'true' }, [
      roomIcon(String(room.deckSize || 36), 'Cards'),
      roomIcon(room.turnSeconds <= 15 ? '15' : '30', 'Turn time'),
      roomIcon(room.transferEnabled ? 'TR' : 'CL', 'Mode'),
      roomIcon(room.throwInMode === 'all' ? 'ALL' : 'NBR', 'Throw-in'),
      room.bluffEnabled ? roomIcon('BLF', 'Bluff') : roomIcon('OK', 'Classic'),
    ]),
    h('span', { class: 'demo-room-arrow', 'aria-hidden': 'true' }, ['>']),
  ]);
}

export function openDemoPasswordPad({ mount = document.body, room = {}, onSubmit, onClose } = {}) {
  let value = '';
  const slots = [0, 1, 2, 3].map(() => h('span', { class: 'demo-password-slot' }, ['']));

  const syncSlots = () => {
    slots.forEach((slot, index) => {
      slot.textContent = value[index] ? value[index] : '';
      slot.classList.toggle('filled', Boolean(value[index]));
    });
  };

  const close = () => {
    bg.remove();
    onClose?.();
  };

  const submit = async () => {
    if (value.length < 3) {
      panel.classList.remove('shake');
      void panel.offsetWidth;
      panel.classList.add('shake');
      return;
    }
    bg.remove();
    await onSubmit?.(value);
  };

  const press = (key) => {
    if (key === 'OK') return submit();
    if (key === 'x') {
      value = value.slice(0, -1);
      syncSlots();
      return null;
    }
    if (/^\d$/.test(key) && value.length < 4) {
      value += key;
      syncSlots();
      if (value.length === 4) setTimeout(submit, 90);
    }
    return null;
  };

  const panel = h('div', { class: 'demo-password-modal', role: 'dialog', 'aria-modal': 'true' }, [
    h('button', { type: 'button', class: 'demo-password-close', onclick: close, 'aria-label': 'Close' }, ['x']),
    h('div', { class: 'demo-password-title' }, ['Parol kiriting']),
    h('div', { class: 'demo-password-room' }, [tableDisplayName(room, 'Private table')]),
    h('div', { class: 'demo-password-slots' }, slots),
    h('div', { class: 'demo-keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'OK', '0', 'x'].map((key) => (
      h('button', {
        type: 'button',
        class: `demo-key${key === 'OK' ? ' ok' : ''}${key === 'x' ? ' backspace' : ''}`,
        onclick: () => press(key),
      }, [key])
    ))),
  ]);
  const bg = h('div', { class: 'modal-bg demo-password-bg' }, [panel]);
  bg.addEventListener('click', (event) => {
    if (event.target === bg) close();
  });
  mount.appendChild(bg);
  syncSlots();
  return bg;
}
