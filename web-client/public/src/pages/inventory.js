import { api } from '../api.js';
import { h } from '../ui.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { sfx } from '../sfx.js?v=164-i18n-audio';
import { cardSkinClass } from '../cards.js?v=160-curated-card-skins';
import { setPref } from '../preferences.js?v=164-i18n-audio';

const RARITY = {
  common: { label: 'ODDIY', color: '#4aa3ff', glow: '74,163,255' },
  rare: { label: 'NOYOB', color: '#34d399', glow: '52,211,153' },
  epic: { label: 'EPIC', color: '#a78bfa', glow: '167,139,250' },
  legendary: { label: 'LEGENDARY', color: '#f5c842', glow: '245,200,66' },
  mythic: { label: 'MYTHIC', color: '#ff4545', glow: '255,69,69' },
};

const FILTERS = [
  ['all', 'HAMMASI'],
  ['common', 'ODDIY'],
  ['rare', 'NOYOB'],
  ['epic', 'EPIC'],
  ['legendary', 'LEGENDARY'],
  ['mythic', 'MYTHIC'],
];

const NAV_ITEMS = [
  ['home', '🏠', 'BOSH SAHIFA', ''],
  ['inventory', '🃏', 'KARTALAR', 'Koleksiyangiz'],
  ['decks', '📋', 'DECKLAR', 'Decklaringiz'],
  ['chests', '📦', 'CHESTLAR', 'Ochish'],
  ['gifts', '🎁', "SOVG'ALAR", 'Yuborish va qabul qilish'],
  ['shop', '💰', 'GOLD COIN', "Sovg'a qilish"],
  ['tournaments', '🏆', 'TURNIRLAR', ''],
  ['friends', '👥', "DO'STLAR", ''],
  ['clan', '🛡️', 'KLAN', ''],
  ['settings', '⚙️', 'SOZLAMALAR', ''],
];

const DEFAULT_MESSAGE = "Senga omad va g'alabalar tilayman! 💪🔥";
const SYMBOLS = ['♠', '♥', '♦', '♣'];

export async function renderInventory(root) {
  root.innerHTML = '';
  try { state.user = await api.me(); } catch (_) {}

  root.appendChild(h('div', { class: 'screen card-collection-screen inv87-screen inv87-loading' }, [
    h('div', { class: 'inv87-loader' }, [
      h('span', {}, ['🃏']),
      h('b', {}, ['Kartalar yuklanmoqda...']),
    ]),
  ]));

  try {
    const canLoadFriends = Number(state.user?.games_played || 0) >= 5;
    const [data, friends] = await Promise.all([
      api.cardCollection(),
      canLoadFriends ? api.friends().catch(() => []) : Promise.resolve([]),
    ]);
    const skins = normalizeSkins(data);
    const selected = skins.find((skin) => skin.selected) || skins.find((skin) => skin.owned) || skins[0];
    const ui = {
      filter: 'all',
      selectedSkin: selected,
      giftSkin: selected,
      quantity: 1,
      friendSearch: '',
      message: DEFAULT_MESSAGE,
      openingBox: '',
      lastDrop: null,
    };
    const rerender = () => {
      root.innerHTML = '';
      root.appendChild(renderShell(root, data, friends, skins, ui, rerender));
    };
    rerender();
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'screen card-collection-screen inv87-screen inv87-loading' }, [
      h('div', { class: 'inv87-loader inv87-error' }, [
        h('span', {}, ['!']),
        h('b', {}, [e.message || 'Kartalar yuklanmadi']),
        h('button', { class: 'inv87-gold-btn', onclick: () => renderInventory(root) }, ['QAYTA URINISH']),
      ]),
    ]));
  }
}

function renderShell(root, data, friends, skins, ui, rerender) {
  return h('div', { class: 'screen card-collection-screen inv87-screen' }, [
    renderSidebar(),
    renderTopHeader(data),
    renderCenterPanel(root, data, friends, skins, ui, rerender),
    renderRightPanel(root, ui, rerender),
    ui.lastDrop ? renderDropOverlay(ui, rerender) : null,
  ]);
}

function renderSidebar() {
  const me = state.user || {};
  const name = displayName(me);
  const level = levelNumber(me);
  const xp = xpValue(me);
  const xpMax = xpMaxValue(me);
  return h('aside', { class: 'inv87-sidebar' }, [
    h('section', { class: 'inv87-side-profile' }, [
      avatar(me, 'inv87-avatar-lg'),
      h('div', { class: 'inv87-side-profile-meta' }, [
        h('div', { class: 'inv87-name-row' }, [
          h('strong', {}, [name]),
          h('span', { class: 'inv87-online-dot' }, []),
        ]),
        h('span', { class: 'inv87-rank-pill' }, ['♛ LEGEND']),
      ]),
      h('div', { class: 'inv87-level-badge' }, [String(level)]),
      progressBar(xp, xpMax, 'gold'),
      h('small', { class: 'inv87-xp-label' }, [`${fmt(xp)} / ${fmt(xpMax)} XP`]),
    ]),
    h('nav', { class: 'inv87-nav' }, NAV_ITEMS.map(([key, icon, title, subtitle]) => {
      const active = key === 'inventory';
      return h('button', {
        class: `inv87-nav-item ${active ? 'active' : ''}`,
        onclick: () => navTo(key),
      }, [
        h('span', { class: 'inv87-nav-icon' }, [icon]),
        h('span', { class: 'inv87-nav-text' }, [
          h('b', {}, [title]),
          subtitle ? h('small', {}, [subtitle]) : null,
        ]),
      ]);
    })),
    h('section', { class: 'inv87-pass' }, [
      h('div', { class: 'inv87-pass-head' }, [
        h('span', {}, ['♛']),
        h('strong', {}, ['IMPERIA PASS']),
      ]),
      h('div', { class: 'inv87-pass-row' }, [
        h('b', {}, [String(level)]),
        progressBar(xp, xpMax, 'purple'),
      ]),
      h('small', {}, [`${fmt(xp)} / ${fmt(xpMax)} XP`]),
    ]),
  ]);
}

function renderTopHeader(data) {
  const me = state.user || {};
  const xp = xpValue(me);
  const xpMax = xpMaxValue(me);
  return h('header', { class: 'inv87-header' }, [
    h('section', { class: 'inv87-header-user' }, [
      avatar(me, 'inv87-avatar-sm'),
      h('div', {}, [
        h('b', {}, [displayName(me)]),
        h('span', {}, ['LEGEND']),
      ]),
    ]),
    h('section', { class: 'inv87-header-xp' }, [
      h('div', { class: 'inv87-level-badge small' }, [String(levelNumber(me))]),
      h('div', { class: 'inv87-xp-stack' }, [
        progressBar(xp, xpMax, 'gold'),
        h('small', {}, [`${fmt(xp)} / ${fmt(xpMax)} XP`]),
      ]),
    ]),
    h('section', { class: 'inv87-wallets' }, [
      wallet('💵', fmt(me.coins || 0), () => navigate('shop')),
      wallet('GC', fmt(data.goldCoins ?? me.gold_coins ?? 0), () => navigate('shop')),
      wallet('💎', fmt(me.gems || 0), () => navigate('shop'), 'purple'),
    ]),
    h('section', { class: 'inv87-header-actions' }, [
      headerAction('🎁', "SOVG'ALAR", () => navigate('friends'), 3),
      headerAction('✉️', 'XABARLAR', () => navigate('friends'), 2),
      headerAction('👥', "DO'STLAR", () => navigate('friends')),
      headerAction('⚙️', 'SOZLAMALAR', () => navigate('settings')),
    ]),
  ]);
}

function renderCenterPanel(root, data, friends, skins, ui, rerender) {
  const visible = ui.filter === 'all' ? skins : skins.filter((skin) => skin.rarity === ui.filter);
  const totalOwned = skins.filter((skin) => skin.owned).length;
  return h('main', { class: 'inv87-center' }, [
    h('section', { class: 'inv87-title-row' }, [
      h('div', {}, [
        h('h1', {}, ['KARTALAR ', h('span', {}, ['🃏']), h('em', {}, ['i'])]),
        h('p', {}, [`TOPLAM: ${totalOwned} / ${skins.length}`]),
      ]),
      h('button', { class: 'inv87-sort-btn', onclick: () => toast('Saralash paneli tayyor', 'info') }, ['🔽 SIROVKA']),
    ]),
    h('section', { class: 'inv87-tabs' }, FILTERS.map(([key, label]) => h('button', {
      class: `inv87-tab ${ui.filter === key ? 'active' : ''}`,
      onclick: () => { ui.filter = key; rerender(); },
    }, [label]))),
    h('section', { class: 'inv87-card-grid' }, visible.map((skin) => renderSkinCard(root, data, skin, ui, rerender))),
    renderChestPanel(root, data, skins, ui, rerender),
    renderGiftSection(root, friends, ui, rerender),
  ]);
}

function renderSkinCard(root, data, skin, ui, rerender) {
  const rarity = rarityInfo(skin.rarity);
  const max = maxForLevel(skin);
  const progress = Math.min(Number(skin.quantity || 0), max);
  const isSelected = ui.selectedSkin?.id === skin.id;
  const canBuy = !skin.owned && Number(skin.priceGold || 0) > 0 && (skin.collectionType === 'paid' || skin.paid);
  return h('button', {
    class: `inv87-card rarity-${skin.rarity} ${skin.owned ? 'owned' : 'locked'} ${isSelected ? 'selected' : ''}`,
    style: { '--rarity': rarity.color, '--rarity-rgb': rarity.glow, '--skin-bg': skin.palette?.bg || '#111827', '--skin-accent': skin.palette?.accent || rarity.color },
    onclick: async () => {
      sfx.play('click');
      ui.selectedSkin = skin;
      if (skin.owned) {
        ui.giftSkin = skin;
        ui.quantity = clampQuantity(ui.quantity, maxGiftQty(skin));
        return rerender();
      }
      if (canBuy) {
        rerender();
        if (window.confirm(`${skin.name} kartasini ${fmt(skin.priceGold)} Gold Coin evaziga sotib olasizmi?`)) await buySkin(root, skin);
        return;
      }
      rerender();
      toast('Bu karta qutilardan tasodifiy tushadi', 'info');
    },
  }, [
    (skin.rarity === 'legendary' || skin.rarity === 'mythic') ? h('span', { class: 'inv87-card-crown' }, ['♛']) : null,
    h('span', { class: 'inv87-card-count' }, [`x${Math.max(0, skin.quantity || 0)}`]),
    cardArtwork(skin, false),
    h('div', { class: 'inv87-card-meta' }, [
      h('strong', {}, [skin.name.toUpperCase()]),
      h('small', { style: { color: rarity.color } }, [rarity.label]),
    ]),
    h('div', { class: 'inv87-card-progress' }, [
      h('span', {}, ['+']),
      h('i', {}, [h('b', { style: { width: `${Math.min(100, (progress / max) * 100)}%`, background: rarity.color } }, [])]),
      h('em', {}, [`${progress}/${max}`]),
      h('span', {}, ['+']),
    ]),
  ]);
}

function renderGiftSection(root, friends, ui, rerender) {
  const skin = ui.giftSkin || ui.selectedSkin;
  const maxGift = maxGiftQty(skin);
  ui.quantity = clampQuantity(ui.quantity, maxGift);
  return h('section', { class: 'inv87-gift-section', id: 'inventory-gift-section' }, [
    h('div', { class: 'inv87-gift-card' }, [
      h('h2', {}, ["YUBORILADIGAN KARTA"]),
      h('div', { class: 'inv87-selected-gift' }, [
        h('div', { class: 'inv87-gift-thumb' }, [cardArtwork(skin, false)]),
        h('div', {}, [
          h('strong', {}, [skin.name.toUpperCase()]),
          h('span', { style: { color: rarityInfo(skin.rarity).color } }, [rarityInfo(skin.rarity).label]),
          h('small', {}, [`Ortiqcha: ${Math.max(0, maxGift)} dona`]),
        ]),
      ]),
      h('label', { class: 'inv87-qty-label' }, [`Yuboriladigan: ${ui.quantity} dona`]),
      h('div', { class: 'inv87-qty' }, [
        h('button', { disabled: maxGift < 1 || ui.quantity <= 1, onclick: () => { ui.quantity = Math.max(1, ui.quantity - 1); rerender(); } }, ['−']),
        h('b', {}, [String(ui.quantity)]),
        h('button', { disabled: maxGift < 1 || ui.quantity >= maxGift, onclick: () => { ui.quantity = Math.min(maxGift, ui.quantity + 1); rerender(); } }, ['+']),
      ]),
    ]),
    renderFriendPicker(root, friends, ui),
    renderGiftMessage(ui),
  ]);
}

function renderChestPanel(root, data, skins, ui, rerender) {
  const chests = Array.isArray(data.chests) && data.chests.length ? data.chests : [
    { id: 'bronze', name: 'Bronze quti', priceGold: 0 },
    { id: 'silver', name: 'Silver quti', priceGold: 100 },
    { id: 'gold', name: 'Gold quti', priceGold: 300 },
    { id: 'diamond', name: 'Diamond quti', priceGold: 590 },
  ];
  return h('section', { class: 'inv87-chest-section', id: 'inventory-chests-section' }, [
    h('div', { class: 'inv87-chest-head' }, [
      h('div', {}, [
        h('h2', {}, ['TASODIFIY KARTA QUTILARI']),
        h('p', {}, ["Quti ochilganda karta kolleksiyangizga tushadi va o'yinda ishlatish uchun tayyor bo'ladi."]),
      ]),
      ui.lastDrop ? h('button', { class: 'inv87-outline-btn', onclick: () => { ui.lastDrop = null; rerender(); } }, ['YOPISH']) : null,
    ]),
    h('div', { class: 'inv87-chest-grid' }, chests.map((chest) => renderChestBox(root, data, skins, ui, rerender, chest))),
    h('div', { class: `inv87-last-drop ${ui.lastDrop ? 'has-drop' : ''}` }, ui.lastDrop ? [
      h('span', {}, ['OXIRGI TUSHGAN KARTA']),
      h('strong', {}, [ui.lastDrop.name]),
      h('em', { style: { color: rarityInfo(ui.lastDrop.rarity).color } }, [rarityInfo(ui.lastDrop.rarity).label]),
    ] : [
      h('span', {}, ['TASODIFIY TUSHISH']),
      h('strong', {}, ['2x yoki 4x nusxa ham tushishi mumkin']),
      h('em', {}, ['Legendary karta ehtimoli qutiga qarab oshadi']),
    ]),
  ]);
}

function renderChestBox(root, data, skins, ui, rerender, chest) {
  const id = String(chest.id || 'bronze');
  const opening = ui.openingBox === id;
  const price = Number(chest.priceGold || 0);
  const meta = chestMeta(id);
  return h('button', {
    class: `inv87-chest-box ${id} ${opening ? 'opening' : ''}`,
    disabled: !!ui.openingBox,
    onclick: () => openBox(root, id, data, skins, ui, rerender),
  }, [
    h('span', { class: 'inv87-chest-icon' }, [meta.icon]),
    h('strong', {}, [String(chest.name || `${id} quti`).toUpperCase()]),
    h('em', { class: 'inv87-chest-desc' }, [meta.desc]),
    h('small', {}, [price > 0 ? `${fmt(price)} Gold` : 'BEPUL']),
  ]);
}

function renderDropOverlay(ui, rerender) {
  const skin = ui.lastDrop;
  const rarity = rarityInfo(skin.rarity);
  return h('div', { class: 'inv87-drop-overlay', onclick: (e) => {
    if (e.target === e.currentTarget) {
      ui.lastDrop = null;
      rerender();
    }
  } }, [
    h('section', { class: 'inv87-drop-modal', style: { '--rarity': rarity.color, '--rarity-rgb': rarity.glow, '--skin-bg': skin.palette?.bg || '#111827', '--skin-accent': skin.palette?.accent || rarity.color } }, [
      h('small', {}, ['TASODIFIY KARTA TUSHDI']),
      h('div', { class: `inv87-drop-copies copies-${Math.min(3, Number(skin.dropQuantity || 1))}` },
        Array.from({ length: Math.min(3, Number(skin.dropQuantity || 1)) }, (_, i) =>
          h('div', { class: 'inv87-drop-copy', style: { '--copy-i': i } }, [cardArtwork(skin, true)])
        )
      ),
      Number(skin.dropQuantity || 1) > 1 ? h('strong', { class: 'inv87-drop-multiplier' }, [`${skin.dropQuantity}x NUSXA`]) : null,
      h('h2', {}, [skin.name.toUpperCase()]),
      h('b', { style: { color: rarity.color } }, [rarity.label]),
      h('p', {}, ["Karta kolleksiyangizga qo'shildi. Ortiqcha nusxalarni do'stlarga sovg'a qilish mumkin."]),
      h('button', { class: 'inv87-gold-btn wide', onclick: () => { ui.lastDrop = null; rerender(); } }, ['DAVOM ETISH']),
    ]),
  ]);
}

function renderFriendPicker(root, friends, ui) {
  const source = Array.isArray(friends) ? friends : [];
  const list = h('div', { class: 'inv87-friends-list' });
  const renderRows = () => {
    const q = ui.friendSearch.trim().toLowerCase();
    const rows = source.filter((friend) => friendName(friend).toLowerCase().includes(q)).slice(0, 8);
    list.replaceChildren(...rows.map((friend) => friendRow(root, friend, ui)));
    if (!rows.length) {
      list.appendChild(h('p', { class: 'inv87-empty-row' }, [source.length ? "Do'st topilmadi" : "Hali do'st yo'q"]));
    }
  };
  const input = h('input', {
    value: ui.friendSearch,
    placeholder: "Qidirish...",
    oninput: (e) => { ui.friendSearch = e.target.value; renderRows(); },
  });
  renderRows();
  return h('div', { class: 'inv87-gift-card' }, [
    h('h2', {}, ['QABUL QILUVCHINI TANLANG']),
    h('label', { class: 'inv87-search' }, ['⌕', input]),
    list,
  ]);
}

function friendRow(root, friend, ui) {
  const online = !!friend.online;
  return h('div', { class: 'inv87-friend-row' }, [
    avatar(friend, 'inv87-friend-avatar'),
    h('div', { class: 'inv87-friend-meta' }, [
      h('b', {}, [friendName(friend)]),
      h('small', { class: online ? 'online' : 'offline' }, [online ? 'ONLINE' : 'OFFLINE 1 soat oldin']),
    ]),
    h('button', { class: 'inv87-mini-gold', onclick: () => sendSkinGift(root, friend, ui) }, ['YUBORISH']),
  ]);
}

function renderGiftMessage(ui) {
  const counter = h('small', { class: 'inv87-counter' }, [`${String(ui.message || '').length}/100`]);
  return h('div', { class: 'inv87-gift-card' }, [
    h('h2', {}, ["SOVG'A XABARI ", h('small', {}, ['(ixtiyoriy)'])]),
    h('div', { class: 'inv87-textarea-wrap' }, [
      h('textarea', {
        maxlength: 100,
        value: ui.message,
        oninput: (e) => {
          ui.message = e.target.value;
          counter.textContent = `${String(ui.message || '').length}/100`;
        },
      }),
      counter,
    ]),
    h('h2', { class: 'inv87-appearance-title' }, ["SOVG'A KO'RINISHI"]),
    h('div', { class: 'inv87-gift-visual', html: giftSvg() }),
  ]);
}

function renderRightPanel(root, ui, rerender) {
  const skin = ui.selectedSkin;
  const rarity = rarityInfo(skin.rarity);
  const max = maxForLevel(skin);
  const progress = Math.min(Number(skin.quantity || 0), max);
  return h('aside', { class: 'inv87-right' }, [
    h('section', { class: 'inv87-info-panel' }, [
      h('h2', {}, ["KARTA MA'LUMOTI"]),
      h('div', { class: 'inv87-large-preview', style: { '--rarity': rarity.color, '--rarity-rgb': rarity.glow, '--skin-bg': skin.palette?.bg || '#111827', '--skin-accent': skin.palette?.accent || rarity.color } }, [
        (skin.rarity === 'legendary' || skin.rarity === 'mythic') ? h('span', { class: 'inv87-card-crown' }, ['♛']) : null,
        h('span', { class: 'inv87-card-count' }, [`x${Math.max(0, skin.quantity || 0)}`]),
        cardArtwork(skin, true),
        h('strong', {}, [skin.name.toUpperCase()]),
        h('em', { style: { color: rarity.color } }, [rarity.label]),
      ]),
      h('dl', { class: 'inv87-stats' }, [
        h('dt', {}, ['Noyoblik:']), h('dd', { style: { color: rarity.color } }, [rarity.label]),
        h('dt', {}, ['Sahifa:']), h('dd', {}, [`${skin.page} / 24`]),
        h('dt', {}, ['Sizda:']), h('dd', { class: 'gold' }, [`x${Math.max(0, skin.quantity || 0)} (${Math.max(0, maxGiftQty(skin))} dona ortiqcha)`]),
      ]),
      h('p', { class: 'inv87-desc' }, [descriptionFor(skin)]),
      h('div', { class: 'inv87-level-line' }, [
        h('span', {}, ['LEVEL 2']),
        h('b', {}, [`${progress} / ${max}`]),
      ]),
      progressBar(progress, max, 'purple'),
      h('h3', {}, [`ORTIQCHA: ${Math.max(0, maxGiftQty(skin))} DONA`]),
      h('p', { class: 'inv87-desc' }, ['Bu kartaning ortiqcha nusxalarini yuborishingiz mumkin.']),
      renderSkinPrimaryAction(root, skin, ui, rerender),
      h('button', {
        class: 'inv87-gold-btn wide',
        onclick: () => {
          ui.giftSkin = skin;
          ui.quantity = clampQuantity(1, maxGiftQty(skin));
          rerender();
          requestAnimationFrame(() => document.getElementById('inventory-gift-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        },
      }, ["🎁 SOVG'A YUBORISH"]),
      h('button', { class: 'inv87-outline-btn wide', onclick: () => navigate('tournaments') }, ['🏆 TURNIRDA FOYDALANISH']),
    ]),
    h('section', { class: 'inv87-info-panel inv87-pack-info' }, [
      h('h2', {}, ["KARTA TO'PLAMI HAQIDA ", h('em', {}, ['i'])]),
      h('div', { class: 'inv87-pack-title' }, [
        h('strong', {}, [`${skinDeckName(skin)} Deck`]),
        h('span', {}, ['24 ta karta']),
      ]),
      h('p', {}, ["To'plamdan karta ochishda tasodifiy 2x yoki 4x nusxa tushishi mumkin!"]),
      h('div', { class: 'inv87-probability' }, [
        slot('?'), slot('?'), slot('?'), slot('24'), h('span', {}, ['→']), badge('2x', 'TASODIFIY'), h('span', {}, ['→']), badge('4x', 'TASODIFIY'),
      ]),
      h('p', { class: 'inv87-chance' }, ['🛡️ Bu to‘plamdan ', h('b', {}, ['Legendary karta']), ' tushish ehtimoli: ', h('b', {}, ['5.5%'])]),
    ]),
  ]);
}

function renderSkinPrimaryAction(root, skin, ui, rerender) {
  const canBuy = !skin.owned && Number(skin.priceGold || 0) > 0 && (skin.collectionType === 'paid' || skin.paid);
  if (skin.selected) {
    return h('button', { class: 'inv87-gold-btn wide', disabled: true }, ["O'YINDA BOR"]);
  }
  if (skin.owned) {
    return h('button', { class: 'inv87-gold-btn wide', onclick: () => selectSkin(root, skin.id, skin.name) }, ["O'YINDA QO'LLASH"]);
  }
  if (canBuy) {
    return h('button', { class: 'inv87-gold-btn wide', onclick: () => buySkin(root, skin) }, [`${fmt(skin.priceGold)} GOLDGA OLISH`]);
  }
  return h('button', {
    class: 'inv87-outline-btn wide',
    onclick: () => {
      ui.lastDrop = null;
      rerender();
      requestAnimationFrame(() => document.getElementById('inventory-chests-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    },
  }, ['QUTILARDAN TUSHADI']);
}

function cardArtwork(skin, large) {
  const rarity = rarityInfo(skin.rarity);
  const image = skinImage(skin);
  return h('div', {
    class: `inv87-card-art ${large ? 'large' : ''} ${cardSkinClass(skin.id)}`,
    style: {
      '--rarity': rarity.color,
      '--rarity-rgb': rarity.glow,
      '--skin-bg': skin.palette?.bg || '#111827',
      '--skin-accent': skin.palette?.accent || rarity.color,
    },
  }, image ? [
    h('img', {
      class: 'inv87-card-img',
      src: image,
      alt: skin.name || 'Karta',
      loading: large ? 'eager' : 'lazy',
    }),
  ] : [
    h('span', { class: 'inv87-generated-art', html: artSvg(skin) }),
  ]);
}

function skinImage(skin) {
  const image = String(skin?.image || skin?.art || skin?.artwork || '').trim();
  if (!image) return '';
  return image.startsWith('/') ? image : `/${image.replace(/^\/+/, '')}`;
}

function chestInitial(id) {
  const text = String(id || 'box').trim().toUpperCase();
  if (text.startsWith('DIAMOND')) return 'DI';
  if (text.startsWith('SILVER')) return 'SL';
  if (text.startsWith('GOLD')) return 'GO';
  return 'BR';
}

function chestMeta(id) {
  const key = String(id || 'bronze').toLowerCase();
  if (key.includes('diamond')) return { icon: '💎', desc: 'Eng noyob karta ehtimoli yuqori' };
  if (key.includes('gold')) return { icon: '🏆', desc: 'Rare va legendary imkoniyati kuchli' };
  if (key.includes('silver')) return { icon: '🥈', desc: "Ko'proq yaxshi skin olish uchun" };
  return { icon: '🎁', desc: 'Oddiy bepul boshlang‘ich quti' };
}

function artSvg(skin) {
  const accent = safeColor(skin.palette?.accent || rarityInfo(skin.rarity).color);
  const bg = safeColor(skin.palette?.bg || '#111827');
  const symbol = SYMBOLS[Math.abs(hash(skin.id)) % SYMBOLS.length];
  const beast = creatureName(skin);
  return `
    <svg class="inv87-art-svg" viewBox="0 0 240 320" role="img" aria-label="${escapeHtml(skin.name)}">
      <defs>
        <radialGradient id="g-${escapeId(skin.id)}" cx="50%" cy="28%" r="68%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.92"/>
          <stop offset="45%" stop-color="${bg}" stop-opacity="0.72"/>
          <stop offset="100%" stop-color="#05050b" stop-opacity="1"/>
        </radialGradient>
        <linearGradient id="m-${escapeId(skin.id)}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fff3b0"/>
          <stop offset="42%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="#170b02"/>
        </linearGradient>
      </defs>
      <rect width="240" height="320" rx="18" fill="url(#g-${escapeId(skin.id)})"/>
      <path d="M43 249 C54 130 88 70 120 54 C154 70 188 130 197 249 C162 226 82 226 43 249Z" fill="#03040a" opacity=".75"/>
      <path d="M72 122 C74 83 96 58 120 52 C146 58 168 83 170 122 C160 107 144 101 120 101 C96 101 82 107 72 122Z" fill="url(#m-${escapeId(skin.id)})" opacity=".86"/>
      <circle cx="92" cy="142" r="10" fill="${accent}"/>
      <circle cx="148" cy="142" r="10" fill="${accent}"/>
      <path d="M88 188 C107 206 134 206 153 188" stroke="#f5c842" stroke-width="7" stroke-linecap="round" fill="none"/>
      <text x="120" y="271" text-anchor="middle" font-size="68" font-family="Georgia, serif" fill="#fff7cf" opacity=".9">${symbol}</text>
      <text x="120" y="304" text-anchor="middle" font-size="16" font-family="Orbitron, sans-serif" fill="#fff5ca">${escapeHtml(beast)}</text>
    </svg>`;
}

function progressBar(value, max, tone = 'gold') {
  const pct = Math.max(0, Math.min(100, (Number(value || 0) / Math.max(1, Number(max || 1))) * 100));
  return h('span', { class: `inv87-progress ${tone}` }, [h('i', { style: { width: `${pct}%` } }, [])]);
}

function wallet(icon, value, onClick, tone = 'gold') {
  return h('button', { class: `inv87-wallet ${tone}`, onclick: onClick }, [
    h('span', {}, [icon]),
    h('b', {}, [value]),
    h('em', {}, ['+']),
  ]);
}

function headerAction(icon, label, onClick, badgeCount = 0) {
  return h('button', { class: 'inv87-header-action', onclick: onClick }, [
    h('span', {}, [icon]),
    badgeCount ? h('i', {}, [String(badgeCount)]) : null,
    h('small', {}, [label]),
  ]);
}

function avatar(user, className) {
  const src = user?.avatar_url || user?.avatarUrl || '';
  if (src) return h('img', { class: className, src, alt: displayName(user) });
  return h('span', { class: `${className} inv87-avatar-fallback` }, [initial(displayName(user))]);
}

function slot(text) {
  return h('span', { class: 'inv87-slot' }, [text]);
}

function badge(top, bottom) {
  return h('span', { class: 'inv87-random-badge' }, [h('b', {}, [top]), h('small', {}, [bottom])]);
}

async function sendSkinGift(root, friend, ui) {
  const skin = ui.giftSkin || ui.selectedSkin;
  const maxGift = maxGiftQty(skin);
  if (!skin || maxGift < 1) return toast('Bu kartadan sovg‘a qilish uchun ortiqcha nusxa yo‘q', 'error');
  const quantity = clampQuantity(ui.quantity, maxGift);
  try {
    sfx.play('coin');
    await api.request('POST', '/api/friends/gift/skin', {
      friendId: friend.id,
      skinId: skin.id,
      message: ui.message,
      quantity,
    });
    toast(`${friendName(friend)} ga ${quantity} dona karta yuborildi`, 'success');
    renderInventory(root);
  } catch (e) {
    toast(e.message || "Sovg'a yuborilmadi", 'error');
  }
}

async function buySkin(root, skin) {
  try {
    sfx.play('coin');
    const r = await api.buySkin(skin.id);
    if (!state.user) state.user = {};
    state.user.gold_coins = r.goldCoins;
    state.user.selected_skin = r.selectedSkin || skin.id;
    setPref('pref_card_shirt', true);
    toast(`${skin.name} sotib olindi`, 'success');
    renderInventory(root);
  } catch (e) {
    toast(e.message || 'Karta sotib olinmadi', 'error');
  }
}

async function selectSkin(root, skinId, name) {
  try {
    sfx.play('click');
    const r = await api.selectSkin(skinId);
    if (!state.user) state.user = {};
    state.user.selected_skin = r.selectedSkin || skinId;
    setPref('pref_card_shirt', true);
    toast(`${name} qo‘yildi`, 'success');
    renderInventory(root);
  } catch (e) {
    toast(e.message || 'Skin qo‘yilmadi', 'error');
  }
}

async function openBox(root, boxType, data, skins, ui, rerender) {
  try {
    sfx.play('coin');
    ui.openingBox = boxType;
    rerender();
    const r = await api.openCardBox(boxType);
    if (!state.user) state.user = {};
    state.user.gold_coins = r.goldCoins;
    state.user.selected_skin = r.selectedSkin;
    setPref('pref_card_shirt', true);
    data.goldCoins = r.goldCoins;
    const dropped = applyDroppedSkin(skins, { ...(r.skin || {}), dropQuantity: Number(r.quantity || 1) }, r.selectedSkin);
    ui.selectedSkin = dropped;
    ui.giftSkin = dropped;
    ui.quantity = clampQuantity(1, maxGiftQty(dropped));
    ui.lastDrop = dropped;
    ui.openingBox = '';
    toast(`${r.skin?.name || 'Karta'} qutidan tushdi`, 'success');
    rerender();
  } catch (e) {
    ui.openingBox = '';
    rerender();
    toast(e.message || 'Quti ochilmadi', 'error');
  }
}

function applyDroppedSkin(skins, rawSkin, selectedSkin) {
  const id = rawSkin?.id || selectedSkin || 'default';
  const addQty = Math.max(1, Number(rawSkin?.dropQuantity || rawSkin?.quantity || 1));
  skins.forEach((skin) => { skin.selected = skin.id === id; });
  const existing = skins.find((skin) => skin.id === id);
  if (existing) {
    existing.quantity = Math.max(1, Number(existing.quantity || 0) + addQty);
    existing.dropQuantity = addQty;
    existing.owned = true;
    existing.selected = true;
    return existing;
  }
  return {
    ...(rawSkin || {}),
    id,
    rarity: rawSkin?.rarity || 'common',
    quantity: addQty,
    dropQuantity: addQty,
    owned: true,
    selected: true,
    page: 1,
  };
}

function normalizeSkins(data) {
  const ownedMap = new Map((data.owned || []).map((row) => [row.item_id, Number(row.quantity || 0)]));
  return (data.skins || []).map((skin, index) => {
    const rarity = skin.rarity || 'common';
    const rawQty = Number(skin.quantity ?? ownedMap.get(skin.id) ?? (skin.owned ? 1 : 0));
    const quantity = skin.id === 'default' ? Math.max(1, rawQty || 1) : Math.max(0, rawQty);
    return {
      ...skin,
      rarity,
      page: (index % 24) + 1,
      quantity,
      owned: skin.id === 'default' || quantity > 0 || !!skin.owned,
      selected: !!skin.selected,
    };
  }).sort((a, b) => {
    const score = (skin) => (skin.owned ? 10000 : 0) + (skin.priority || 0);
    return score(b) - score(a);
  });
}

function maxForLevel(skin) {
  if (!skin) return 4;
  if (skin.rarity === 'mythic') return 2;
  if (skin.rarity === 'legendary') return 4;
  if (skin.rarity === 'epic') return 10;
  if (skin.rarity === 'rare') return 50;
  return 20;
}

function maxGiftQty(skin) {
  if (!skin) return 0;
  if (skin.giftable !== undefined) return Math.max(0, Number(skin.giftable || 0));
  if (!skin.randomOnly && skin.collectionType !== 'random') return 0;
  return Math.max(0, Number(skin.quantity || 0) - 1);
}

function clampQuantity(value, maxGift) {
  if (maxGift < 1) return 1;
  return Math.max(1, Math.min(Number(value || 1), maxGift));
}

function rarityInfo(rarity) {
  return RARITY[rarity] || RARITY.common;
}

function displayName(user) {
  return user?.nickname || user?.display_name || user?.username || 'Player';
}

function friendName(friend) {
  return friend?.nickname || friend?.username || friend?.display_name || 'Player';
}

function initial(name) {
  return String(name || 'I').replace(/^@/, '').trim().slice(0, 1).toUpperCase() || 'I';
}

function levelNumber(user) {
  return Number(user?.level ?? user?.profile_level ?? 0);
}

function xpValue(user) {
  return Number(user?.xp ?? user?.experience ?? 0);
}

function xpMaxValue(user) {
  return Number(user?.xp_next ?? user?.next_level_xp ?? 0);
}

function skinDeckName(skin) {
  const words = String(skin?.name || 'Karta').split(/\s+/);
  return words[0] || 'Karta';
}

function descriptionFor(skin) {
  const name = String(skin?.name || 'karta').toLowerCase();
  if (skin.rarity === 'legendary' || skin.rarity === 'mythic') return `Qudratli ${name}, raqiblarni hayratda qoldiradigan noyob karta dizayni.`;
  if (skin.rarity === 'epic') return `Yorqin effektli ${name}, jangovar stolga premium ko‘rinish beradi.`;
  return `Koleksiyangiz uchun chiroyli ${name} karta ko‘rinishi.`;
}

function creatureName(skin) {
  const id = String(skin?.id || '');
  if (/dragon|fire|demon|inferno/i.test(id)) return 'DRAGON';
  if (/angel|queen|goddess/i.test(id)) return 'ANGEL';
  if (/ninja|assassin|shadow/i.test(id)) return 'NINJA';
  if (/ice|winter|sky|ocean/i.test(id)) return 'FROST';
  if (/lion|pharaoh|king|emperor/i.test(id)) return 'KING';
  return 'IMPERIA';
}

function navTo(key) {
  sfx.play('click');
  if (key === 'home') return navigate('home');
  if (key === 'inventory') return navigate('inventory');
  if (key === 'shop') return navigate('shop');
  if (key === 'tournaments') return navigate('tournaments');
  if (key === 'friends') return navigate('friends');
  if (key === 'settings') return navigate('settings');
  if (key === 'chests') {
    document.getElementById('inventory-chests-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (key === 'gifts') {
    document.getElementById('inventory-gift-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  toast('Bu bo‘lim tez orada ochiladi', 'info');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function hash(value) {
  return String(value || '').split('').reduce((acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0);
}

function safeColor(value) {
  const raw = String(value || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(raw) ? raw : '#f5c842';
}

function escapeId(value) {
  return String(value || 'skin').replace(/[^a-z0-9_-]/gi, '-');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function giftSvg() {
  return `
    <svg viewBox="0 0 420 190" role="img" aria-label="Sovg'a qutisi">
      <defs>
        <radialGradient id="giftGlow" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#a855f7" stop-opacity=".75"/>
          <stop offset="100%" stop-color="#05050b" stop-opacity=".08"/>
        </radialGradient>
        <linearGradient id="giftBox" x1="0" x2="1">
          <stop offset="0%" stop-color="#251044"/>
          <stop offset="100%" stop-color="#a855f7"/>
        </linearGradient>
      </defs>
      <rect width="420" height="190" rx="18" fill="url(#giftGlow)"/>
      <g class="sparkles" fill="#f5c842">
        <circle cx="80" cy="44" r="3"/><circle cx="336" cy="48" r="4"/><circle cx="302" cy="142" r="3"/>
        <path d="M105 142 l7 15 l15 7 l-15 7 l-7 15 l-7 -15 l-15 -7 l15 -7z"/>
        <path d="M330 104 l5 10 l10 5 l-10 5 l-5 10 l-5 -10 l-10 -5 l10 -5z"/>
      </g>
      <g transform="translate(142 45)">
        <rect x="18" y="46" width="120" height="78" rx="12" fill="url(#giftBox)" stroke="#f5c842" stroke-width="3"/>
        <rect x="8" y="28" width="140" height="34" rx="10" fill="#3b1268" stroke="#f5c842" stroke-width="3"/>
        <rect x="68" y="28" width="20" height="96" fill="#f5c842"/>
        <path d="M78 28 C42 -6 26 9 46 31 C56 42 70 35 78 28Z" fill="#f5c842"/>
        <path d="M78 28 C114 -6 130 9 110 31 C100 42 86 35 78 28Z" fill="#f5c842"/>
      </g>
    </svg>`;
}
