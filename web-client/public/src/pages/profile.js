import { h } from '../ui.js';
import { api, clearToken } from '../api.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { avatarColorFor, avatarLetter, flagEmoji } from '../cards.js';
import { sfx } from '../sfx.js?v=164-i18n-audio';
import { t } from '../i18n.js';

let TAB = 'showcase';
let PROFILE_DATA = null;
let PROFILE_ROOT = null;
let ACTIVE_STICKER_PACK_ID = null;
let ACTIVE_EMOJI_PACK_ID = null;

const STICKER_FACE = {
  pack_basic: '😊',
  pack_uzbek: '🔥',
  pack_emotion: '😎',
  pack_animals: '🐻',
  pack_funny: '🐰',
  pack_meme: '🦁',
  pack_gangster: '🃏',
  pack_royal: '👑',
  pack_neon: '🧛',
  pack_dragon: '🐉',
  pack_celestial: '✨',
  pack_elon: '🚀',
};

const RARITY_LABEL = {
  common: 'Oddiy',
  uncommon: 'Noyob',
  rare: 'Rare',
  epic: 'Premium',
  legendary: 'Legend',
};

function tSafe(key, fallback) {
  const value = t(key);
  return value && value !== key ? value : fallback;
}

function packTotal(pack) {
  return Number(pack.total || pack.size || (pack.stickers || []).length || 0);
}

function packPreviewImage(pack) {
  const first = (Array.isArray(pack.preview) && pack.preview[0])
    || (Array.isArray(pack.stickers) && pack.stickers[0])
    || null;
  return first?.img || '';
}

function stickerVisual(src, label, className = '') {
  if (!src) return h('span', { class: className }, [label || '🎭']);
  return h('img', {
    class: className,
    src,
    alt: label || 'Sticker',
    loading: 'lazy',
    onerror: (e) => {
      e.currentTarget.style.display = 'none';
      const parent = e.currentTarget.parentElement;
      if (parent && !parent.querySelector('.sticker-visual-fallback')) {
        parent.appendChild(h('span', { class: 'sticker-visual-fallback' }, [label || '🎭']));
      }
    },
  });
}

export async function renderProfile(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'screen bg-lobby profile-premium-screen' });
  root.appendChild(wrap);

  wrap.appendChild(h('div', { class: 'lobby-topbar profile-topbar' }, [
    h('button', { class: 'btn-icon', onclick: () => { sfx.play('click'); navigate('home'); } }, ['◀']),
    h('div', { class: 'title' }, [tSafe('profile.title', 'Profil')]),
    h('button', { class: 'btn-icon', onclick: () => openPaymentModal(root, 'gold') }, ['＋']),
  ]));
  const shell = h('div', { class: 'profile-premium-scroll scroll' }, [
    h('div', { class: 'profile-loading-card' }, [tSafe('profile.loading', 'Profil yuklanmoqda...')]),
  ]);
  wrap.appendChild(shell);

  let data = null;
  try {
    data = await api.profileShowcase();
    PROFILE_DATA = data;
    PROFILE_ROOT = root;
    state.user = data.user;
  } catch (err) {
    shell.innerHTML = '';
    shell.appendChild(h('div', { class: 'section-card' }, [err.message || tSafe('profile.load_failed', 'Profil yuklanmadi')]));
    return;
  }

  draw(shell, root, data);
}

function draw(shell, root, data) {
  const me = data.user || {};
  shell.innerHTML = '';
  shell.appendChild(heroCard(root, me, data));
  shell.appendChild(tabs());

  const body = h('div', { class: 'profile-premium-body' });
  renderActiveTab(body, root, data);
  shell.appendChild(body);
}

function renderActiveTab(body, root, data) {
  body.innerHTML = '';
  if (TAB === 'showcase') renderShowcase(body, root, data);
  if (TAB === 'stickers') renderStickerWall(body, root, data);
  if (TAB === 'emoji') renderEmojiWall(body, root, data);
  if (TAB === 'shop') renderProfileShop(body, root, data);
}

function switchProfileTab(key) {
  TAB = key;
  const root = PROFILE_ROOT || document.getElementById('app');
  const body = document.querySelector('.profile-premium-body');
  if (!root || !PROFILE_DATA || !body) return renderProfile(root || document.getElementById('app'));
  document.querySelectorAll('.premium-profile-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === TAB);
  });
  renderActiveTab(body, root, PROFILE_DATA);
  body.scrollIntoView({ block: 'nearest' });
}

function heroCard(root, me, data) {
  const name = `${flagEmoji(me.country_code) || ''} ${me.nickname ? `@${me.nickname}` : me.username}`.trim();
  const premium = me.premium_until && new Date(me.premium_until) > new Date();
  const season = Math.max(0, Number(me.games_won || 0));
  const total = Math.max(0, Number(me.games_played || 0));
  const stickerCount = (data.stickers || []).reduce((sum, p) => sum + Number(p.owned || 0), 0);
  const emojiCount = (data.emojiPacks || []).reduce((sum, p) => sum + Number(p.owned || 0), 0);

  return h('section', { class: 'premium-profile-card' }, [
    h('div', { class: 'profile-identity' }, [
      h('div', { class: `premium-avatar color-${avatarColorFor(me.id || me.username)} ${me.selected_avatar_frame ? `profile-frame frame-${me.selected_avatar_frame}` : ''}` }, [
        me.avatar_url ? h('img', { src: me.avatar_url, alt: name }) : avatarLetter(me.username || name),
        h('span', { class: 'avatar-level' }, [String(me.rank_lines || me.rank_wins || 0)]),
      ]),
      h('div', { class: 'profile-name-block' }, [
        h('div', { class: 'profile-name' }, [name || 'Player']),
        h('div', { class: 'profile-rank-line' }, [
          rankBadge(me),
          premium ? h('span', { class: 'mini-pro' }, ['PRO']) : h('span', { class: 'mini-muted' }, [tSafe('profile.free', 'Free')]),
        ]),
      ]),
    ]),
    h('div', { class: 'profile-wallet-panel' }, [
      walletRow('👑', 'Gold Coin', me.gold_coins || 0, () => openPaymentModal(root, 'gold')),
      walletRow('💵', tSafe('profile.dollar', 'Dollar'), me.coins || 0, () => openPaymentModal(root, 'dollar')),
      walletRow('🏆', tSafe('profile.victories', 'Yutuqlar'), `${season}/${total}`, () => switchProfileTab('showcase')),
    ]),
    h('div', { class: 'profile-season-grid' }, [
      seasonCell('⭐', tSafe('profile.victory_short', 'G‘alaba'), me.games_won || 0),
      seasonCell('💵', tSafe('profile.dollar', 'Dollar'), compact(me.coins || 0)),
      seasonCell('🏆', tSafe('profile.stickers', 'Sticker'), stickerCount),
      seasonCell('😀', tSafe('profile.emoji', 'Emoji'), emojiCount),
    ]),
  ]);
}

function walletRow(icon, label, value, onPlus) {
  return h('div', { class: 'wallet-row' }, [
    h('span', { class: 'wallet-icon' }, [icon]),
    h('span', { class: 'wallet-label' }, [label]),
    h('strong', {}, [typeof value === 'number' ? compact(value) : value]),
    h('button', { class: 'wallet-plus', onclick: (e) => { e.stopPropagation(); sfx.play('click'); onPlus(); } }, ['+']),
  ]);
}

function seasonCell(icon, label, value) {
  return h('div', { class: 'season-cell' }, [
    h('span', {}, [icon]),
    h('strong', {}, [String(value)]),
    h('small', {}, [label]),
  ]);
}

function tabs() {
  return h('div', { class: 'premium-profile-tabs' }, [
    tab('showcase', `🏅 ${tSafe('profile.achievements', 'Yutuqlar')}`),
    tab('stickers', `🎭 ${tSafe('profile.stickers', 'Stikerlar')}`),
    tab('emoji', `😀 ${tSafe('profile.emoji', 'Emoji')}`),
    tab('shop', `🛒 ${tSafe('profile.buy_items', 'Sotib olish')}`),
  ]);
}

function tab(key, label) {
  return h('button', {
    'data-tab': key,
    class: `premium-profile-tab ${TAB === key ? 'active' : ''}`,
    onclick: () => { sfx.play('click'); switchProfileTab(key); },
  }, [label]);
}

function renderShowcase(body, root, data) {
  const rewards = data.rewards || [];
  const coreRewards = rewards.filter((r) => !['games_draw', 'bluffs_caught'].includes(r.metric));
  const drawRewards = rewards.filter((r) => r.metric === 'games_draw');
  const sheriffRewards = rewards.filter((r) => r.metric === 'bluffs_caught');

  body.appendChild(buildRewardCollection(coreRewards, 'main'));

  if (drawRewards.length) {
    body.appendChild(h('div', { class: 'premium-panel-title compact-title' }, [
      h('h2', {}, ['Durang sovrinlari']),
      h('p', {}, ['Durang o\'yinlar soni oshgani sari yangi medallar ochiladi.']),
    ]));
    body.appendChild(buildRewardCollection(drawRewards, 'draws'));
  }

  if (sheriffRewards.length) {
    body.appendChild(h('div', { class: 'premium-panel-title compact-title' }, [
      h('h2', {}, ['Sherif medallari']),
      h('p', {}, ['Aldagan raqibni topsangiz, Sherif nishoni uchun progress oshadi.']),
    ]));
    body.appendChild(buildRewardCollection(sheriffRewards, 'sheriff'));
  }

  body.appendChild(h('div', { class: 'premium-panel-title' }, [
    h('h2', {}, ["Sovrinlar yo'li"]),
    h('p', {}, ["G'alaba, durang va Sherif medallari ochilganda mukofot avtomatik beriladi."]),
  ]));

  for (const reward of rewards) {
    body.appendChild(rewardBadge(reward));
  }
}

function buildRewardCollection(rewards, lane = 'main') {
  const collection = h('div', { class: 'reward-collection-strip' }, [
    h('div', { class: 'reward-collection-line' }, []),
  ]);
  collection.classList.add(`reward-collection-${lane}`);

  for (const reward of rewards) {
    const ic = rewardIcon(reward);
    const icon = typeof ic === 'string' ? { main: ic, sub: '' } : ic;
    const key = reward.key || '';
    const status = key.includes('special') ? 'special' : reward.claimed ? 'owned' : reward.unlocked ? 'hot' : 'locked';
    const title = String(reward.title || 'Sovrin');
    const parts = title.split(' ');
    const label = parts.length > 1 ? `${parts[0]}\n${parts.slice(1).join(' ')}` : title;
    const current = Number(reward.current || 0);
    const target = Number(reward.target || 0);
    const progress = Number.isFinite(Number(reward.progress))
      ? Math.max(0, Math.min(100, Number(reward.progress)))
      : target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0;

    collection.appendChild(h('div', {
      role: 'button',
      tabindex: '0',
      class: `reward-collection-node ${status}`,
      title,
      style: `--reward-progress:${progress}%`,
      onclick: () => {
        sfx.play('click');
        if (reward.claimed) toast('Sovrin olingan', 'success');
        else if (reward.unlocked) toast('Sovrin avtomatik hisobingizga tushadi', 'success');
        else toast('Hali ochilmagan', 'info');
      },
    }, [
      h('span', { class: 'reward-collection-orb' }, [
        h('span', { class: 'reward-collection-shine' }, []),
        h('b', {}, [icon.main]),
        h('small', {}, [icon.sub]),
        h('em', {}, [String(reward.target)]),
      ]),
      h('i', { class: 'reward-collection-base' }, []),
      h('strong', {}, [label]),
      h('span', { class: 'reward-collection-meta' }, [`${current}/${target}`]),
    ]));
  }

  return collection;
}

function rewardBadge(reward) {
  const ic = rewardIcon(reward);
  const icon = typeof ic === 'string' ? ic : ic.main;
  const state = reward.claimed ? 'claimed' : reward.unlocked ? 'unlocked' : '';

  return h('div', { class: `reward-row ${state}` }, [
    h('div', { class: 'reward-medal' }, [icon]),
    h('div', { class: 'reward-copy' }, [
      h('strong', {}, [reward.title]),
      h('span', {}, [`${reward.current}/${reward.target} · +${compact(reward.rewardCoins)}$`]),
      h('div', { class: 'reward-progress' }, [
        h('i', { style: `width:${reward.progress}%` }, []),
      ]),
    ]),
    h('button', {
      class: 'reward-action',
      onclick: () => {
        sfx.play('click');
        if (reward.claimed) toast('Sovrin olingan', 'success');
        else if (reward.unlocked) toast('Sovrin avtomatik hisobingizga tushadi', 'success');
        else toast('Hali ochilmagan', 'info');
      },
    }, [reward.claimed ? 'OLINDI' : reward.unlocked ? 'OCHIQ' : 'LOCK']),
  ]);
}

function rewardIcon(reward) {
  const k = reward.key || '';
  if (k.includes('sheriff')) return { main: '\u{1F396}\uFE0F', sub: '\u{1F6E1}\uFE0F' };
  if (k.includes('draws')) return { main: '\u{1F91D}', sub: '\u{1F3C5}' };
  if (k.includes('first')) return { main: '💵', sub: '⭐' };
  if (k.includes('wins_3') || (k.includes('3') && k.includes('win'))) return { main: '🥇', sub: '🌟' };
  if (k.includes('wins_5') || (k.includes('5') && k.includes('win'))) return { main: '👑', sub: '💎' };
  if (k.includes('wins_10') || (k.includes('10') && k.includes('win'))) return { main: '🏆', sub: '🔥' };
  if (k.includes('wins_20') || (k.includes('20') && k.includes('win'))) return { main: '🌟', sub: '🦁' };
  if (k.includes('wins_50') || (k.includes('50') && k.includes('win'))) return { main: '🐷', sub: '💰' };
  if (k.includes('100')) return { main: '🏆', sub: '👸' };
  if (k.includes('special')) return { main: '🎭', sub: '🃏' };
  return { main: '🏅', sub: '🌙' };
}

function renderStickerWall(body, root, data) {
  body.appendChild(h('div', { class: 'premium-panel-title' }, [
    h('h2', {}, ['3D Sticker kolleksiya']),
    h('p', {}, ['Pack ustiga bosing: kolleksiya shu ro‘yxatning pastida ochiladi, sahifadan chiqib ketmaydi.']),
  ]));

  const packs = data.stickers || [];
  const list = h('div', { class: 'inline-pack-list' });
  for (let i = 0; i < packs.length; i += 2) {
    const rowPacks = packs.slice(i, i + 2);
    list.appendChild(h('div', { class: 'sticker-pack-grid pack-row-grid' },
      rowPacks.map((pack) => stickerPackCard(root, pack))
    ));
    const selected = rowPacks.find((pack) => pack.id === ACTIVE_STICKER_PACK_ID);
    if (selected) list.appendChild(stickerCollectionPanel(root, selected));
  }
  body.appendChild(list);
}

function stickerPackCard(root, pack) {
  const owned = Number(pack.owned || 0);
  const locked = owned <= 0 && pack.priceGold > 0;
  const total = packTotal(pack);
  const cover = packPreviewImage(pack);
  return h('button', {
    class: `sticker-pack-card rarity-${pack.rarity} ${locked ? 'locked' : 'owned'} ${ACTIVE_STICKER_PACK_ID === pack.id ? 'selected' : ''}`,
    onclick: () => {
      sfx.play('click');
      ACTIVE_STICKER_PACK_ID = ACTIVE_STICKER_PACK_ID === pack.id ? null : pack.id;
      switchProfileTab('stickers');
    },
  }, [
    h('div', { class: 'sticker-coin sticker-coin-img' }, [stickerVisual(cover, STICKER_FACE[pack.id] || pack.name || 'Sticker')]),
    h('strong', {}, [pack.name]),
    h('span', {}, [`${RARITY_LABEL[pack.rarity] || pack.rarity} · ${owned}/${total}`]),
    locked ? h('em', {}, [`${pack.priceGold} GC`]) : h('em', {}, ['OCHILGAN']),
  ]);
}

function stickerCollectionPanel(root, pack) {
  const owned = Number(pack.owned || 0);
  const open = owned > 0 || pack.priceGold === 0;
  const total = packTotal(pack);
  const cover = packPreviewImage(pack);
  return h('div', { class: 'inline-pack-panel sticker-inline-panel' }, [
    h('div', { class: 'inline-pack-head' }, [
      h('div', { class: 'sheet-big-icon sheet-big-img' }, [stickerVisual(cover, STICKER_FACE[pack.id] || pack.name || 'Sticker')]),
      h('div', {}, [
        h('h3', {}, [pack.name]),
        h('p', {}, [`${owned}/${total} ochilgan · ${RARITY_LABEL[pack.rarity] || pack.rarity}`]),
      ]),
    ]),
    h('div', { class: 'inline-pack-grid' },
      (pack.stickers || []).map((s, idx) => h('button', {
        class: `sticker-face ${open ? 'open' : 'ghost'}`,
        title: s.name,
        onclick: () => open ? toast(`${s.name} tanlandi`, 'success') : toast('Avval packni oching', 'info'),
      }, [
        stickerVisual(s.img, s.name || pack.name || 'Sticker'),
        h('small', {}, [String((idx % 16) + 1)]),
      ]))
    ),
    h('div', { class: 'sheet-actions inline-actions' }, [
      pack.priceGold > 0 ? h('button', {
        class: 'btn-big green',
        onclick: async () => {
          try {
            const r = await api.stickerBuy(pack.id);
            if (state.user) state.user.gold_coins = r.goldCoins;
            toast('Sticker pack ochildi', 'success');
            PROFILE_DATA = null;
            renderProfile(root);
          } catch (err) { toast(err.message, 'error'); }
        },
      }, [`${pack.priceGold} GC ga olish`]) : null,
      h('button', {
        class: 'btn-secondary',
        onclick: () => {
          if (owned <= 0) return toast('Avval packni oching', 'info');
          openGiftStickerModal(root, pack);
        },
      }, ['Do‘stga yuborish']),
    ].filter(Boolean)),
  ]);
}

function openStickerPack(root, pack) {
  const owned = Number(pack.owned || 0);
  const total = packTotal(pack);
  const cover = packPreviewImage(pack);
  const bg = h('div', { class: 'profile-modal-bg' });
  const modal = h('div', { class: 'sticker-sheet-modal' }, [
    h('button', { class: 'profile-modal-close', onclick: () => bg.remove() }, ['×']),
    h('div', { class: 'sticker-sheet-head' }, [
      h('div', { class: 'sheet-big-icon sheet-big-img' }, [stickerVisual(cover, STICKER_FACE[pack.id] || pack.name || 'Sticker')]),
      h('div', {}, [
        h('h2', {}, [pack.name]),
        h('p', {}, [`${owned}/${total} ochilgan · ${RARITY_LABEL[pack.rarity] || pack.rarity}`]),
      ]),
    ]),
    h('div', { class: 'sticker-sheet-grid' },
      pack.stickers.map((s, idx) => {
        const open = owned > 0 || pack.priceGold === 0;
        return h('button', {
          class: `sticker-face ${open ? 'open' : 'ghost'}`,
          title: s.name,
          onclick: () => open ? toast(`${s.name} tanlandi`, 'success') : toast('Avval packni oching', 'info'),
        }, [
          stickerVisual(s.img, s.name || pack.name || 'Sticker'),
          h('small', {}, [String((idx % 16) + 1)]),
        ]);
      })
    ),
    h('div', { class: 'sheet-actions' }, [
      pack.priceGold > 0 ? h('button', {
        class: 'btn-big green',
        onclick: async () => {
          try {
            const r = await api.stickerBuy(pack.id);
            if (state.user) state.user.gold_coins = r.goldCoins;
            toast('Sticker pack ochildi', 'success');
            bg.remove();
            PROFILE_DATA = null;
            renderProfile(root);
          } catch (err) { toast(err.message, 'error'); }
        },
      }, [`${pack.priceGold} GC ga olish`]) : null,
      h('button', {
        class: 'btn-secondary',
        onclick: () => {
          if (owned <= 0) return toast('Avval packni oching', 'info');
          openGiftStickerModal(root, pack, bg);
        },
      }, ['Do‘stga yuborish']),
    ].filter(Boolean)),
  ]);
  bg.appendChild(modal);
  root.appendChild(bg);
}

async function openGiftStickerModal(root, pack, parentModal) {
  const bg = h('div', { class: 'profile-modal-bg' });
  const box = h('div', { class: 'payment-sheet' }, [
    h('button', { class: 'profile-modal-close', onclick: () => bg.remove() }, ['×']),
    h('h2', {}, ['Do‘stga yuborish']),
    h('p', {}, [`${pack.name} packini yuborish uchun do‘st tanlang.`]),
    h('div', { class: 'payment-options' }, ['Do‘stlar yuklanmoqda...']),
  ]);
  bg.appendChild(box);
  root.appendChild(bg);
  const list = box.querySelector('.payment-options');
  try {
    const friends = (await api.friends()).filter((f) => f.status === 'accepted');
    list.innerHTML = '';
    if (!friends.length) {
      list.appendChild(h('div', { class: 'muted', style: 'padding:14px;text-align:center' }, ['Hali do‘stlar yo‘q']));
      return;
    }
    for (const friend of friends) {
      list.appendChild(h('button', {
        class: 'payment-option',
        onclick: async () => {
          try {
            await api.giftSticker(friend.id, pack.id, `${pack.name} sovg‘a`);
            toast('Sticker sovg‘a yuborildi', 'success');
            bg.remove();
            parentModal?.remove?.();
            PROFILE_DATA = null;
            renderProfile(root);
          } catch (err) { toast(err.message, 'error'); }
        },
      }, [
        h('strong', {}, [friend.username]),
        h('span', {}, ['Yuborish']),
      ]));
    }
  } catch (err) {
    list.textContent = err.message || 'Do‘stlar yuklanmadi';
  }
}

function renderEmojiWall(body, root, data) {
  body.appendChild(h('div', { class: 'premium-panel-title' }, [
    h('h2', {}, ['Premium Emoji']),
    h('p', {}, ['Emoji packni bosing: ichidagi chiroyli kolleksiya pastidan ochiladi va scroll bilan davom etadi.']),
  ]));
  const list = h('div', { class: 'emoji-pack-list' });
  for (const pack of data.emojiPacks || []) {
    list.appendChild(h('button', {
      class: `emoji-pack-row rarity-${pack.rarity} ${ACTIVE_EMOJI_PACK_ID === pack.id ? 'selected' : ''}`,
      onclick: () => {
        sfx.play('click');
        ACTIVE_EMOJI_PACK_ID = ACTIVE_EMOJI_PACK_ID === pack.id ? null : pack.id;
        switchProfileTab('emoji');
      },
    }, [
      h('span', { class: 'emoji-pack-avatar' }, [emojiFallback(pack)]),
      h('strong', {}, [pack.name]),
      h('small', {}, [`${pack.owned}/${pack.total}`]),
      h('b', {}, [pack.premium ? 'PRO' : RARITY_LABEL[pack.rarity] || pack.rarity]),
    ]));
    if (ACTIVE_EMOJI_PACK_ID === pack.id) list.appendChild(emojiCollectionPanel(pack));
  }
  body.appendChild(list);
}

function emojiCollectionPanel(pack) {
  return h('div', { class: 'inline-pack-panel emoji-inline-panel' }, [
    h('div', { class: 'inline-pack-head' }, [
      h('span', { class: 'emoji-pack-avatar xl' }, [emojiFallback(pack)]),
      h('div', {}, [
        h('h3', {}, [pack.name]),
        h('p', {}, [`${pack.owned}/${pack.total} emoji ochilgan`]),
      ]),
    ]),
    h('div', { class: 'inline-pack-grid emoji-collection-grid' },
      (pack.emoji || []).map((e, idx) => h('button', {
        class: `sticker-face ${e.qty ? 'open' : 'ghost'}`,
      }, [
        h('span', {}, [emojiByIndex(idx)]),
        h('small', {}, [e.qty ? String(e.qty) : '']),
      ]))
    ),
  ]);
}

function renderProfileShop(body, root, data) {
  body.appendChild(h('div', { class: 'premium-panel-title' }, [
    h('h2', {}, ['Premium do‘kon']),
    h('p', {}, ['Gold Coin, Dollar va Premium olish uchun tezkor checkout.']),
  ]));
  body.appendChild(h('div', { class: 'profile-shop-grid' }, [
    shopTile('👑', 'Gold Coin', 'Sticker va premium uchun', () => openPaymentModal(root, 'gold')),
    shopTile('💵', 'Dollar', 'Stol va o‘yin balansingiz', () => openPaymentModal(root, 'dollar')),
    shopTile('💎', 'Premium', 'Premium emoji/stickerlar', () => openPaymentModal(root, 'premium')),
    shopTile('🛒', 'To‘liq do‘kon', 'Barcha mahsulotlar', () => navigate('shop')),
  ]));
}

function shopTile(icon, title, sub, action) {
  return h('button', { class: 'profile-shop-tile', onclick: () => { sfx.play('click'); action(); } }, [
    h('span', {}, [icon]),
    h('strong', {}, [title]),
    h('small', {}, [sub]),
  ]);
}

async function openPaymentModal(root, tab = 'gold') {
  const bg = h('div', { class: 'profile-modal-bg' });
  const paymentTitle = tab === 'dollar' ? 'Dollar paketlari' : tab === 'premium' ? 'Premium paketlari' : 'Gold Coin paketlari';
  const paymentIcon = tab === 'dollar' ? '$' : tab === 'premium' ? '★' : '⚡';
  let box;
  box = h('div', { class: `payment-sheet payment-${tab}` }, [
    h('button', { class: 'profile-modal-close', onclick: () => bg.remove() }, ['×']),
    h('div', { class: 'payment-sheet-head' }, [
      h('span', { class: 'payment-brand-mark' }, [paymentIcon]),
      h('div', {}, [
        h('h2', {}, [paymentTitle]),
        h('p', {}, ['Visa / Mastercard orqali xavfsiz checkout.']),
      ]),
    ]),
    h('button', {
      type: 'button',
      class: 'payment-method-card',
      onclick: () => {
        const firstOption = box.querySelector('.payment-option:not(.disabled):not([disabled])');
        if (firstOption) firstOption.click();
        else toast('Paketlar yuklanishini kuting yoki Stripe sozlamasini tekshiring', 'info', 3200);
      },
    }, [
      h('span', {}, ['VISA']),
      h('div', {}, [
        h('strong', {}, ['Visa karta']),
        h('small', {}, ['Karta ma’lumotlari checkout oynasida kiritiladi.']),
      ]),
      h('b', {}, ['›']),
    ]),
    h('div', { class: 'payment-google-row' }, ['Paketlar']),
    h('div', { class: 'payment-options' }, ['Yuklanmoqda...']),
    h('div', { class: 'payment-sheet-note' }, ['Xaridni yakunlash uchun paketni tanlang.']),
  ]);
  bg.appendChild(box);
  root.appendChild(bg);

  const list = box.querySelector('.payment-options');
  const note = box.querySelector('.payment-sheet-note');
  const methodCard = box.querySelector('.payment-method-card');
  const payConfig = await api.paymentConfig().catch(() => ({ stripeConfigured: false, cardEnabled: false, configReachable: false }));
  if (!payConfig.cardEnabled && tab !== 'dollar') {
    methodCard?.classList.add('disabled');
    note.classList.add('error');
    note.textContent = payConfig.configReachable === false
      ? 'To‘lov konfiguratsiyasi yuklanmadi. Backend /api/payments/config routeini tekshiring.'
      : 'Visa / Mastercard hozir serverda ulanmagan. STRIPE_SECRET_KEY sozlangandan keyin checkout ochiladi.';
  }
  try {
    let items = [];
    if (tab === 'gold') {
      items = (await api.goldBundles()).map((b) => ({ id: b.id, title: `${b.goldCoins} Gold Coin`, price: `$${money(b.priceUsd)}`, type: 'gold_bundle' }));
    } else if (tab === 'dollar') {
      items = (await api.dollarBundles()).map((b) => ({ id: b.id, title: `${compact(b.dollars)} Dollar`, price: `${compact(b.costGoldCoins || 0)} GC`, type: 'dollar_bundle' }));
    } else {
      items = (await api.premiumTiers()).map((p) => ({
        id: p.id,
        title: p.label || p.name || `${p.days} kun Premium`,
        price: Number(p.priceGoldCoins || p.priceGold || 0) > 0
          ? `${Number(p.priceGoldCoins || p.priceGold)} GC`
          : (p.priceUsd ? `$${money(p.priceUsd)}` : 'Narx keyin belgilanadi'),
        type: 'premium',
      }));
    }
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(h('div', { class: 'payment-empty' }, ['Paketlar topilmadi. Do‘kon konfiguratsiyasini tekshiring.']));
      return;
    }
    for (const item of items) {
      const needsCard = item.type === 'gold_bundle' || (item.type === 'premium' && !item.price.endsWith('GC'));
      const disabled = needsCard && !payConfig.cardEnabled;
      list.appendChild(h('button', {
        class: `payment-option ${item.type} ${disabled ? 'disabled' : ''}`,
        disabled,
        onclick: async () => {
          if (disabled) {
            toast('Visa / Mastercard uchun Stripe kalitlari serverda sozlanmagan', 'info', 3600);
            return;
          }
          try {
            if (item.type === 'dollar_bundle') {
              const r = await api.buyDollarBundle(item.id);
              if (state.user) {
                state.user.coins = r.coins;
                state.user.gold_coins = r.goldCoins;
              }
              toast(`+${compact(r.awarded)} Dollar qo‘shildi`, 'success');
              bg.remove();
              PROFILE_DATA = null;
              renderProfileV80(root);
              return;
            }
            if (item.type === 'premium' && item.price.endsWith('GC')) {
              await api.buyPremium(item.id, true);
              toast('Premium yoqildi', 'success');
              bg.remove();
              PROFILE_DATA = null;
              renderProfileV80(root);
              return;
            }
            const r = await api.stripeCheckout(item.type, item.id, {
              successPath: '/#/profile?checkout=success',
              cancelPath: '/#/profile?checkout=cancel',
            });
            if (r?.url) location.href = r.url;
            else toast('Stripe sozlanmagan. Serverda kalit kerak.', 'info');
          } catch (err) { toast(paymentErrorMessage(err), 'error'); }
        },
      }, [
        h('i', { class: 'payment-pack-icon' }, [item.type === 'dollar_bundle' ? '$' : item.type === 'premium' ? 'P' : 'GC']),
        h('strong', {}, [item.title]),
        h('span', {}, [item.price]),
      ]));
    }
  } catch (err) {
    list.textContent = err.message || 'Paketlar yuklanmadi';
  }
}

function paymentErrorMessage(err) {
  if (err?.status === 503) return 'Visa / Mastercard tolovlari serverda sozlanmagan.';
  if (err?.status === 409) return 'Bu paket narxi hali tasdiqlanmagan.';
  return err?.message || 'To‘lov hozircha ishlamayapti';
}

function rankBadge(me) {
  const color = me.rank_color || 'white';
  const progress = Number(me.rank_progress || 0);
  const marks = '|'.repeat(Number(me.rank_lines || 0)) + '+'.repeat(Number(me.rank_pluses || 0));
  return `${color.toUpperCase()} ${marks} · ${progress}/100`;
}

function emojiFallback(pack) {
  if (pack.premium) return '💎';
  if (pack.rarity === 'legendary') return '👑';
  if (pack.rarity === 'rare') return '🦁';
  return '😊';
}

function emojiByIndex(idx) {
  const pool = ['😀','😃','😄','😁','😆','😅','😂','🙂','😉','😍','😘','😎','🤩','😏','😮','😢','😡','😈','🤠','🥳','🤯','😭','😤','🙈','👏','👍','👎','🔥','💎','👑'];
  return pool[idx % pool.length];
}

function compact(n) {
  const num = Number(n || 0);
  if (num >= 1000000) return `${Math.round(num / 100000) / 10}M`;
  if (num >= 1000) return `${Math.round(num / 100) / 10}K`;
  return num.toLocaleString();
}

function money(n) {
  return Number(n || 0).toFixed(Number(n) % 1 === 0 ? 0 : 2);
}

export async function renderProfileV80(root, params = {}) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'screen rp-v80-screen' }, [
    h('div', { class: 'rp-v80-loading' }, ['Profil yuklanmoqda...']),
  ]);
  root.appendChild(wrap);

  let data = null;
  try {
    const profileId = String(params?.id || '').trim();
    const isPublicProfile = !!profileId && profileId !== state.user?.id;
    if (isPublicProfile) {
      const publicUser = await api.profile(profileId);
      data = {
        user: publicUser,
        rankInfo: { rank: publicUser.global_rank || 0 },
        publicProfile: true,
      };
    } else {
      const [showcase, rankInfo] = await Promise.all([
        api.profileShowcase(),
        api.leaderboardMe('season').catch(() => null),
      ]);
      data = { ...showcase, rankInfo, publicProfile: false };
      state.user = data.user;
    }
    PROFILE_DATA = data;
    PROFILE_ROOT = root;
  } catch (err) {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'rp-v80-error' }, [
      h('b', {}, ['Profil yuklanmadi']),
      h('span', {}, [err.message || 'Server bilan aloqa yoq']),
      h('button', { onclick: () => renderProfileV80(root, params) }, ['Qayta urinish']),
    ]));
    return;
  }

  drawProfileV80(wrap, root, data);
}

function drawProfileV80(wrap, root, data) {
  const me = data.user || {};
  const publicProfile = !!data.publicProfile;
  const name = me.nickname || me.username || 'Player';
  const profileName = `${flagEmoji(me.country_code) || ''} ${name}`.trim();
  const handle = `@${String(name).replace(/^@/, '').toLowerCase()}`;
  const gold = Number(me.gold_coins || 0);
  const diamonds = Number(me.elon_stickers || 0);
  const dollars = Number(me.coins || 0);
  const games = Number(me.games_played || 0);
  const wins = Number(me.games_won || 0);
  const winrate = games > 0 ? Math.round((wins / games) * 1000) / 10 : 0;
  const streak = Number(me.win_streak || 0);
  const level = Math.max(0, Number(me.rank_lines ?? me.rank_wins ?? 0));
  const xpPct = Math.max(0, Math.min(100, Number(me.rank_progress ?? 0)));
  const xpCurrent = Math.max(0, Math.round((xpPct / 100) * 45000));
  const rank = Number(data.rankInfo?.rank ?? me.global_rank ?? 0);
  const premiumUntil = me.premium_until ? new Date(me.premium_until) : null;
  const hasPremium = premiumUntil && premiumUntil > new Date();
  const premiumText = hasPremium ? rpDate(premiumUntil) : 'Do‘kondan yoqish mumkin';
  const topPercent = rank > 0 ? Math.max(1, Math.min(99, Math.ceil((rank / 4500) * 100))) : 0;

  wrap.innerHTML = '';
  wrap.appendChild(rpTopbar(root, gold, diamonds, { publicProfile }));
  wrap.appendChild(h('main', { class: 'rp-v80-scroll scroll' }, [
    h('div', { class: 'rp-v80-shell' }, [
      h('section', { class: 'rp-v80-hero' }, [
        h('div', { class: 'rp-avatar-wrap' }, [
          h('div', { class: 'rp-avatar-crown' }, ['♛']),
          h('div', { class: `rp-avatar-core color-${avatarColorFor(me.id || name)} ${me.selected_avatar_frame ? `profile-frame frame-${me.selected_avatar_frame}` : ''}` }, [
            me.avatar_url
              ? h('img', { src: me.avatar_url, alt: name, loading: 'lazy' })
              : h('span', { class: 'rp-avatar-lion' }, ['🦁']),
          ]),
          h('div', { class: 'rp-avatar-level' }, [String(level)]),
        ]),
        h('div', { class: 'rp-identity' }, [
          hasPremium ? h('span', { class: 'rp-premium-badge' }, ['♛ PREMIUM']) : h('span', { class: 'rp-premium-badge muted' }, ['ODDIY']),
          h('h1', {}, [profileName, hasPremium ? h('i', { class: 'rp-verified' }, ['✓']) : null].filter(Boolean)),
          h('p', {}, [handle]),
          h('div', { class: 'rp-xp-row' }, [
            h('div', { class: 'rp-level-shield' }, [String(level)]),
            h('div', { class: 'rp-xp-copy' }, [
              h('b', {}, ['LEGEND']),
              h('div', { class: 'rp-xp-track' }, [h('span', { style: { width: `${xpPct}%` } }, [])]),
              h('small', {}, [`${rpNumber(xpCurrent)} / 45 000 XP`]),
            ]),
          ]),
        ]),
        h('aside', { class: 'rp-rank-card' }, [
          h('div', { class: 'rp-rank-emblem' }, ['♠']),
          h('small', {}, ['GLOBAL RANK']),
          h('strong', {}, [rank ? `#${rank}` : '#-']),
          h('button', { onclick: () => { sfx.play('click'); publicProfile ? navigate('leaderboard') : navigate('achievements'); } }, [
            publicProfile ? 'REYTING' : 'NISHON',
            h('span', {}, ['›']),
          ]),
        ]),
      ]),
      h('section', { class: 'rp-metrics' }, [
        rpMetric('🏆', "G'ALABALAR", rpNumber(wins)),
        rpMetric('♛', 'WINRATE', `${winrate}%`),
        rpMetric('🔥', 'ENG UZUN STREAK', String(streak)),
        rpMetric('▮', "O'YINLAR", rpNumber(games)),
      ]),
      h('section', { class: 'rp-showcase-grid' }, [
        h('article', { class: 'rp-panel rp-top-win' }, [
          h('h3', {}, ['ENG YUQORI YUTUQ']),
          h('div', { class: 'rp-big-medal' }, ['✦']),
          h('b', {}, ['GRAND MASTER']),
          h('span', {}, [`TOP ${topPercent}%`]),
        ]),
        h('article', { class: 'rp-panel rp-medals' }, [
          h('h3', {}, ["SO'NGGI MEDALLAR"]),
          h('div', { class: 'rp-medal-row' }, [
            rpMedal('✦', "QAT'IY G'ALABA", '100 marta', 'gold'),
            rpMedal('♠', 'USTA DURAK', '500 marta', 'silver'),
            rpMedal('✶', 'SERIYA USTASI', `${streak} streak`, 'purple'),
          ]),
        ]),
        h('article', { class: 'rp-panel rp-favorites' }, [
          h('h3', {}, ['SEVIMLI EMOJI']),
          h('div', { class: 'rp-favorite-main' }, ['😎']),
          h('div', { class: 'rp-favorite-row' }, ['😂', '🔥', '👍'].map((x) => h('span', {}, [x]))),
        ]),
      ]),
      h('section', { class: 'rp-lower-grid' }, [
        h('div', { class: 'rp-menu-panel' }, [
          ...(publicProfile ? [
            rpMenuRow('✚', "DO'ST QO'SHISH", () => rpRequestFriend(me.id)),
            rpMenuRow('▮', 'STATISTIKALAR', () => rpOpenStatsModal(root, me, { rank, winrate, topPercent })),
            rpMenuRow('✪', 'REYTING', () => navigate('leaderboard')),
            rpMenuRow('⌂', 'BOSH SAHIFA', () => navigate('home')),
          ] : [
            rpMenuRow('▣', 'INVENTAR', () => navigate('inventory')),
            rpMenuRow('✪', 'YUTUQLAR', () => navigate('achievements')),
            rpMenuRow('⌬', 'REFERAL DARAXTI', () => rpOpenReferralModal(root)),
            rpMenuRow('▮', 'STATISTIKALAR', () => rpOpenStatsModal(root, me, { rank, winrate, topPercent })),
            rpMenuRow('✎', 'EDIT PROFIL', () => rpOpenEditProfileModal(root)),
            rpMenuRow('⚙', 'SOZLAMALAR', () => navigate('settings')),
          ]),
        ]),
        h('div', { class: 'rp-side-panels' }, [
          h('article', { class: 'rp-panel rp-vip' }, [
            h('span', {}, ['♛']),
            h('div', {}, [
              h('small', {}, ['VIP STATUS']),
              h('strong', {}, [hasPremium ? 'PREMIUM' : 'ODDIY']),
              h('em', {}, [`TUGASH SANASI: ${premiumText}`]),
            ]),
          ]),
          h('button', { class: 'rp-founder', onclick: () => navigate('shop') }, [
            h('span', {}, ['DURAK IMPERIA']),
            h('b', {}, ['FOUNDERS']),
            h('i', {}, ['♠']),
            h('em', {}, ['›']),
          ]),
          h('article', { class: 'rp-balance-card' }, [
            h('div', {}, [
              h('small', {}, [publicProfile ? 'PUBLIC PROFIL' : 'GOLD COIN BALANSI']),
              h('strong', {}, [publicProfile ? (me.nickname || me.username || 'Player') : `GC ${rpNumber(gold)}`]),
            ]),
            h('button', { onclick: () => publicProfile ? navigate('leaderboard') : openPaymentModal(root, 'gold') }, [publicProfile ? '›' : '+']),
          ]),
          h('article', { class: 'rp-balance-card rp-income' }, [
            h('div', {}, [
              h('small', {}, ['DAROMAD']),
              h('strong', {}, [`$ ${money(Number(me.total_donated_cents || 0) / 100)}`]),
            ]),
            h('button', { onclick: () => navigate(publicProfile ? 'leaderboard' : 'donations') }, ['›']),
          ]),
        ]),
      ]),
    ]),
  ]));
  wrap.appendChild(rpBottomNav());
}

function rpTopbar(root, gold, diamonds, options = {}) {
  if (options.publicProfile) {
    return h('header', { class: 'rp-v80-topbar' }, [
      h('button', { class: 'rp-back-btn', onclick: () => { sfx.play('click'); navigate('leaderboard'); } }, ['‹']),
      h('div', { class: 'rp-title' }, ['PUBLIC PROFIL']),
      h('div', { class: 'rp-wallets' }, [
        h('button', { class: 'rp-wallet', onclick: () => navigate('home') }, [
          h('span', {}, ['H']),
          h('b', {}, ['HOME']),
          h('i', {}, ['›']),
        ]),
      ]),
    ]);
  }
  return h('header', { class: 'rp-v80-topbar' }, [
    h('button', { class: 'rp-back-btn', onclick: () => { sfx.play('click'); navigate('home'); } }, ['‹']),
    h('div', { class: 'rp-title' }, ['PROFIL']),
    h('div', { class: 'rp-wallets' }, [
      rpWallet('GC', gold, () => openPaymentModal(root, 'gold')),
      rpWallet('💎', diamonds, () => navigate('shop')),
    ]),
  ]);
}

function rpWallet(icon, value, action) {
  return h('button', { class: 'rp-wallet', onclick: () => { sfx.play('click'); action(); } }, [
    h('span', {}, [icon]),
    h('b', {}, [rpNumber(value)]),
    h('i', {}, ['+']),
  ]);
}

function rpMetric(icon, label, value) {
  return h('article', { class: 'rp-metric' }, [
    h('span', {}, [icon]),
    h('div', {}, [
      h('small', {}, [label]),
      h('strong', {}, [value]),
    ]),
  ]);
}

function rpMedal(icon, title, sub, tone) {
  return h('div', { class: `rp-medal rp-medal-${tone}` }, [
    h('span', {}, [icon]),
    h('b', {}, [title]),
    h('small', {}, [sub]),
  ]);
}

function rpMenuRow(icon, label, action) {
  return h('button', { class: 'rp-menu-row', onclick: () => { sfx.play('click'); action(); } }, [
    h('span', {}, [icon]),
    h('b', {}, [label]),
    h('i', {}, ['›']),
  ]);
}

function rpBottomNav() {
  const items = [
    ['👥', "DO'STLAR", () => navigate('friends')],
    ['💬', 'CHAT', () => navigate('friends')],
    ['⌂', 'BOSH SAHIFA', () => navigate('home')],
    ['🏆', 'TURNIR', () => navigate('tournaments')],
    ['●', 'PROFIL', () => navigate('profile')],
  ];
  return h('nav', { class: 'rp-bottom-nav' }, items.map(([icon, label, action]) => h('button', {
    class: label === 'PROFIL' ? 'active' : '',
    onclick: () => { sfx.play('click'); action(); },
  }, [h('span', {}, [icon]), h('b', {}, [label])])));
}

async function rpRequestFriend(userId) {
  if (!userId) return toast('Foydalanuvchi topilmadi', 'error');
  try {
    await api.friendRequest(userId);
    toast("Do'stlik so'rovi yuborildi", 'success');
  } catch (err) {
    if (err?.data?.error === 'FEATURE_LOCKED') {
      const required = Number(err.data.required || 0);
      const current = Number(err.data.current || 0);
      toast(`Do'stlar ${required} ta o'yindan keyin ochiladi. Hozir: ${current}/${required}`, 'info', 4200);
      return;
    }
    toast(err.message || "Do'stlik so'rovi yuborilmadi", 'error');
  }
}

function rpOpenStatsModal(root, me, extra = {}) {
  const games = Number(me.games_played || 0);
  const wins = Number(me.games_won || 0);
  const losses = Number(me.games_lost || 0);
  const draws = Number(me.games_draw || 0);
  const winrate = Number.isFinite(Number(extra.winrate)) ? extra.winrate : (games > 0 ? Math.round((wins / games) * 1000) / 10 : 0);
  const rows = [
    ['Global rank', extra.rank ? `#${extra.rank}` : '#-'],
    ["O'yinlar", rpNumber(games)],
    ["G'alabalar", rpNumber(wins)],
    ["Yutqazish", rpNumber(losses)],
    ['Durang', rpNumber(draws)],
    ['Winrate', `${winrate}%`],
    ['Streak', rpNumber(me.win_streak || 0)],
    ['Dollar', rpNumber(me.coins || 0)],
    ['Gold Coin', rpNumber(me.gold_coins || 0)],
  ];
  const bg = h('div', { class: 'profile-modal-bg' });
  bg.appendChild(h('div', { class: 'payment-sheet' }, [
    h('button', { class: 'profile-modal-close', onclick: () => bg.remove() }, ['×']),
    h('h2', {}, ['Profil statistikasi']),
    h('p', {}, ['Bu yerda faqat serverdan kelgan haqiqiy natijalar korsatiladi.']),
    h('div', { class: 'payment-options' }, rows.map(([label, value]) => h('div', { class: 'payment-option' }, [
      h('strong', {}, [label]),
      h('span', {}, [value]),
    ]))),
  ]));
  root.appendChild(bg);
}

async function rpOpenReferralModal(root) {
  const bg = h('div', { class: 'profile-modal-bg' });
  const list = h('div', { class: 'payment-options' }, ['Yuklanmoqda...']);
  const code = state.user?.referral_code || state.user?.nickname || state.user?.username || '';
  bg.appendChild(h('div', { class: 'payment-sheet' }, [
    h('button', { class: 'profile-modal-close', onclick: () => bg.remove() }, ['×']),
    h('h2', {}, ['Referal daraxti']),
    h('p', {}, [code ? `Sizning kodingiz: ${code}` : 'Referal kodi topilmadi']),
    list,
    h('button', {
      class: 'payment-option featured-payment-option',
      onclick: async () => {
        try {
          await navigator.clipboard?.writeText?.(code);
          toast('Referal kod nusxalandi', 'success');
        } catch (_) {
          toast(code || 'Kod yoq', 'info');
        }
      },
    }, [h('strong', {}, ['Kodni nusxalash']), h('span', {}, [code || '-'])]),
  ]));
  root.appendChild(bg);

  try {
    const tree = await api.referralTree();
    const total = (tree.perLevel || []).reduce((sum, row) => sum + Number(row.total || 0), 0);
    const rows = [
      ['Jami referal', rpNumber(total)],
      ['Eng chuqur avlod', `${tree.depth || 0}/${tree.leaderDepth || 32}`],
      ['Mukofot holati', tree.depth >= (tree.leaderDepth || 32) ? 'Ochilgan' : 'Hali ochilmagan'],
      ...(tree.perLevel || []).slice(0, 8).map((row) => [`${row.level}-avlod`, `${row.active || 0}/${row.total || 0}`]),
    ];
    list.innerHTML = '';
    rows.forEach(([label, value]) => list.appendChild(h('div', { class: 'payment-option' }, [
      h('strong', {}, [label]),
      h('span', {}, [value]),
    ])));
  } catch (err) {
    list.textContent = err.message || 'Referal daraxti yuklanmadi';
  }
}

function rpOpenEditProfileModal(root) {
  {
    const bg = h('div', { class: 'profile-modal-bg' });
    const me = state.user || {};
    const currentName = me.nickname || me.username || '';
    const input = h('input', {
      value: currentName,
      maxlength: 24,
      placeholder: 'nickname',
      autocomplete: 'nickname',
      autocapitalize: 'none',
      spellcheck: 'false',
    });

    const saveNickname = async () => {
      const nickname = String(input.value || '').trim();
      if (!/^[A-Za-z0-9_]{3,24}$/.test(nickname)) {
        toast('Nickname 3-24 belgi bolsin', 'error');
        return;
      }
      try {
        await api.setNickname(nickname);
        state.user = { ...(state.user || {}), nickname, nickname_set: true };
        toast('Nickname yangilandi', 'success');
        bg.remove();
        renderProfileV80(root);
      } catch (err) {
        toast(err.message || 'Nickname saqlanmadi', 'error');
      }
    };

    input.addEventListener?.('keydown', (e) => {
      if (e.key === 'Enter') saveNickname();
    });

    bg.appendChild(h('div', { class: 'rp-edit-modal' }, [
      h('button', { class: 'rp-edit-close', type: 'button', onclick: () => bg.remove(), title: 'Yopish' }, ['X']),
      h('div', { class: 'rp-edit-head' }, [
        h('div', { class: 'rp-edit-avatar' }, [
          me.avatar_url
            ? h('img', { src: me.avatar_url, alt: currentName || 'avatar' })
            : h('span', {}, [avatarLetter(currentName || me.username || 'P')]),
        ]),
        h('div', {}, [
          h('h2', {}, ['Profilni tahrirlash']),
          h('p', {}, ['Nickname va profil rasmini aniq saqlang. Rasm 900 KB dan kichik bolsin.']),
        ]),
      ]),
      h('div', { class: 'rp-edit-form' }, [
        h('label', { class: 'rp-edit-field' }, [
          h('span', {}, ['Nickname']),
          input,
        ]),
        h('button', {
          class: 'rp-edit-action primary',
          type: 'button',
          onclick: saveNickname,
        }, ['Nickname saqlash']),
        h('button', {
          class: 'rp-edit-action secondary',
          type: 'button',
          onclick: () => {
            bg.remove();
            rpOpenAvatarUpload(root);
          },
        }, ['Profil rasmini yuklash']),
      ]),
    ]));
    root.appendChild(bg);
    setTimeout(() => input.focus?.(), 80);
    return;
  }
  const bg = h('div', { class: 'profile-modal-bg' });
  const input = h('input', {
    value: state.user?.nickname || state.user?.username || '',
    maxlength: 24,
    placeholder: 'nickname',
    style: { width: '100%', minHeight: '42px', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(216,179,95,.45)' },
  });
  bg.appendChild(h('div', { class: 'payment-sheet' }, [
    h('button', { class: 'profile-modal-close', onclick: () => bg.remove() }, ['×']),
    h('h2', {}, ['Edit profil']),
    h('p', {}, ['Nickname 3-24 belgi: harf, raqam yoki underscore. Rasm 900 KB dan kichik bolsin.']),
    h('div', { class: 'payment-options' }, [
      h('label', { class: 'payment-option' }, [h('strong', {}, ['Nickname']), input]),
      h('button', {
        class: 'payment-option featured-payment-option',
        onclick: async () => {
          const nickname = String(input.value || '').trim();
          if (!/^[A-Za-z0-9_]{3,24}$/.test(nickname)) {
            toast('Nickname 3-24 belgi bolsin', 'error');
            return;
          }
          try {
            await api.setNickname(nickname);
            state.user = { ...(state.user || {}), nickname, nickname_set: true };
            toast('Nickname yangilandi', 'success');
            bg.remove();
            renderProfileV80(root);
          } catch (err) {
            toast(err.message || 'Nickname saqlanmadi', 'error');
          }
        },
      }, [h('strong', {}, ['Nickname saqlash']), h('span', {}, ['OK'])]),
      h('button', {
        class: 'payment-option',
        onclick: () => {
          bg.remove();
          rpOpenAvatarUpload(root);
        },
      }, [h('strong', {}, ['Profil rasmi']), h('span', {}, ['Yuklash'])]),
    ]),
  ]));
  root.appendChild(bg);
}

function rpOpenAvatarUpload(root) {
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 900000) {
      toast('Rasm 900 KB dan kichik bolsin', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await api.updateProfile({ avatarUrl: reader.result });
        if (result?.user) state.user = { ...(state.user || {}), ...result.user };
        toast('Profil rasmi yangilandi', 'success');
        renderProfileV80(root);
      } catch (err) {
        toast(err.message || 'Rasm yuklanmadi', 'error');
      }
    };
    reader.readAsDataURL(file);
  });
  root.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 30000);
}

function rpNumber(value) {
  const n = Number(value || 0);
  return n.toLocaleString('en-US').replaceAll(',', ' ');
}

function rpDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}
