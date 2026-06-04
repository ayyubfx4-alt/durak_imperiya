// Stickers page - premium neon pack store fed by backend catalog assets.
import { h } from '../ui.js';
import { api } from '../api.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { sfx } from '../sfx.js?v=111-encoding-fix';

const FALLBACK_THEME = {
  color: '#e1b14c',
  glow: 'rgba(225,177,76,.35)',
  panel: 'rgba(17,12,26,.64)',
};

function fmt(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function ensureStyles() {
  if (document.getElementById('stickers-neon-styles')) return;
  document.head.appendChild(h('style', { id: 'stickers-neon-styles' }, [`
    .stickers-neon-screen {
      min-height: 100%;
      color: #fff7d6;
      background:
        radial-gradient(circle at 12% 8%, hsla(278, 90%, 52%, .16), transparent 28%),
        radial-gradient(circle at 88% 10%, hsla(43, 94%, 55%, .15), transparent 30%),
        radial-gradient(circle at 50% 115%, hsla(196, 95%, 45%, .10), transparent 34%),
        linear-gradient(145deg, #070814 0%, #0d0f1a 42%, #12091d 100%);
    }
    .stickers-neon-screen::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px),
        linear-gradient(180deg, rgba(255,255,255,.025) 1px, transparent 1px);
      background-size: 42px 42px;
      mask-image: radial-gradient(circle at center, black, transparent 76%);
      opacity: .42;
    }
    .stickers-neon-topbar {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 14px;
      padding: max(14px, env(safe-area-inset-top)) 20px 14px;
      border-bottom: 1px solid rgba(255, 211, 106, .16);
      background: linear-gradient(180deg, rgba(10,12,22,.96), rgba(10,12,22,.72));
      box-shadow: 0 14px 34px rgba(0,0,0,.26);
      backdrop-filter: blur(14px);
    }
    .stickers-back {
      width: 52px;
      height: 52px;
      border: 1px solid rgba(255, 211, 106, .30);
      border-radius: 15px;
      color: #ffe8a3;
      background: linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.02));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.10), 0 0 18px rgba(225,177,76,.10);
      font-size: 22px;
      font-weight: 900;
    }
    .stickers-title {
      display: grid;
      min-width: 0;
      gap: 4px;
      text-transform: uppercase;
      letter-spacing: .08em;
      line-height: 1;
    }
    .stickers-title b {
      color: #fff2bf;
      font-family: Orbitron, Inter, system-ui, sans-serif;
      font-size: clamp(24px, 4.8vw, 42px);
      text-shadow: 0 0 18px rgba(255,211,106,.30);
    }
    .stickers-title small {
      color: rgba(255, 232, 163, .68);
      font-size: 11px;
      letter-spacing: .18em;
    }
    .stickers-balance {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 44px;
      padding: 0 16px;
      border: 1px solid rgba(255, 211, 106, .32);
      border-radius: 999px;
      color: #fff0b8;
      background: linear-gradient(180deg, rgba(34,25,10,.88), rgba(12,10,16,.88));
      box-shadow: 0 0 24px rgba(225,177,76,.14), inset 0 1px 0 rgba(255,255,255,.10);
      font-weight: 950;
      white-space: nowrap;
    }
    .stickers-neon-scroll {
      position: relative;
      z-index: 1;
      flex: 1;
      overflow: auto;
      padding: 18px 18px calc(84px + env(safe-area-inset-bottom));
    }
    .stickers-pack-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(278px, 1fr));
      gap: 14px;
      max-width: 1580px;
      margin: 0 auto;
    }
    .sticker-pack-card {
      --pack-color: #e1b14c;
      --pack-glow: rgba(225,177,76,.35);
      --pack-panel: rgba(17, 12, 26, .64);
      position: relative;
      min-height: 236px;
      padding: 12px 14px 12px;
      overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--pack-color) 72%, transparent);
      border-radius: 8px;
      background:
        radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--pack-color) 18%, transparent), transparent 52%),
        linear-gradient(145deg, var(--pack-panel), rgba(4,5,12,.86));
      box-shadow:
        0 0 0 1px rgba(255,255,255,.025) inset,
        0 0 18px var(--pack-glow),
        0 18px 38px rgba(0,0,0,.34);
      transform: translateZ(0);
      transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease, filter .22s ease;
    }
    .sticker-pack-card::after {
      content: "";
      position: absolute;
      inset: -50% -35% auto;
      height: 94px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.12), transparent);
      transform: rotate(-9deg) translateY(-45px);
      opacity: .52;
      pointer-events: none;
    }
    .sticker-pack-card:hover,
    .sticker-pack-card:focus-within {
      transform: scale(1.025) translateY(-2px);
      border-color: color-mix(in srgb, var(--pack-color) 92%, white 8%);
      box-shadow:
        0 0 0 1px rgba(255,255,255,.045) inset,
        0 0 30px var(--pack-glow),
        0 24px 48px rgba(0,0,0,.44);
      filter: saturate(1.08);
    }
    .sticker-pack-head {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 8px;
      margin-bottom: 7px;
    }
    .sticker-pack-name {
      min-width: 0;
      color: #fff2c7;
      font-family: Orbitron, Inter, system-ui, sans-serif;
      font-size: 16px;
      font-weight: 950;
      text-align: center;
      text-transform: uppercase;
      text-shadow: 0 1px 0 #000, 0 0 12px var(--pack-glow);
    }
    .sticker-pack-tag {
      overflow: hidden;
      color: color-mix(in srgb, var(--pack-color) 78%, #fff 22%);
      font-size: 10px;
      font-weight: 950;
      letter-spacing: .04em;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .sticker-pack-tag:last-child { text-align: right; }
    .sticker-face-grid {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      grid-template-rows: repeat(2, 72px);
      align-items: center;
      justify-items: center;
      gap: 7px 11px;
      padding: 3px 8px 12px;
    }
    .sticker-face {
      width: 72px;
      height: 72px;
      display: grid;
      place-items: center;
      border-radius: 22px;
      filter: drop-shadow(0 10px 13px rgba(0,0,0,.48));
      transform: rotate(var(--tilt, 0deg));
    }
    .sticker-face img {
      width: 118%;
      height: 118%;
      object-fit: contain;
      display: block;
    }
    .sticker-buy-row {
      position: relative;
      z-index: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 38px;
    }
    .sticker-buy-pill {
      min-width: 132px;
      height: 36px;
      border: 1px solid rgba(255,238,177,.58);
      border-radius: 8px;
      color: #fff8cf;
      background:
        linear-gradient(180deg, rgba(255,255,255,.24), transparent 38%),
        linear-gradient(90deg, #7a4308 0%, #c98a1a 33%, #f7d36d 50%, #b8740b 72%, #6a3906 100%);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.36),
        inset 0 -8px 14px rgba(64,30,0,.38),
        0 0 18px rgba(247,201,90,.34);
      font-size: 18px;
      font-weight: 950;
      letter-spacing: .02em;
      cursor: pointer;
      transition: transform .16s ease, box-shadow .16s ease, filter .16s ease;
    }
    .sticker-buy-pill:hover {
      transform: scale(1.045);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.42),
        inset 0 -8px 14px rgba(64,30,0,.34),
        0 0 24px rgba(247,201,90,.46);
      filter: brightness(1.08);
    }
    .sticker-buy-pill.owned {
      min-width: 132px;
      color: #fff7ca;
      background:
        linear-gradient(180deg, rgba(255,255,255,.16), transparent 42%),
        linear-gradient(90deg, #2f2b16, #8f701d, #d6b95d, #836116);
    }
    .stickers-legend-bar {
      position: fixed;
      left: max(72px, env(safe-area-inset-left));
      right: max(72px, env(safe-area-inset-right));
      bottom: max(10px, env(safe-area-inset-bottom));
      z-index: 6;
      display: grid;
      grid-template-columns: repeat(4, minmax(110px, 1fr)) auto;
      align-items: center;
      gap: 8px;
      max-width: 1780px;
      margin: 0 auto;
      padding: 9px 14px;
      border: 1px solid rgba(255, 211, 106, .22);
      border-radius: 8px;
      background: linear-gradient(180deg, rgba(8,11,20,.92), rgba(5,7,14,.96));
      box-shadow: 0 0 24px rgba(0,0,0,.56), inset 0 1px 0 rgba(255,255,255,.06);
      backdrop-filter: blur(16px);
    }
    .legend-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 31px;
      color: #f8e4a0;
      font-size: 14px;
      font-weight: 950;
      letter-spacing: .03em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .legend-purple { color: #d8b4fe; }
    .legend-blue { color: #7dd3fc; }
    .legend-green { color: #86efac; }
    .legend-rate {
      justify-self: end;
      padding-left: 12px;
      border-left: 1px solid rgba(255,255,255,.10);
      color: #fff3c1;
      font-size: 14px;
      font-weight: 950;
      white-space: nowrap;
    }
    .stickers-empty,
    .stickers-error {
      max-width: 520px;
      margin: 58px auto;
      padding: 18px;
      border: 1px solid rgba(255,211,106,.28);
      border-radius: 18px;
      color: #fff0bb;
      background: rgba(8,11,20,.72);
      text-align: center;
      box-shadow: 0 0 24px rgba(225,177,76,.14);
    }
    @media (min-width: 1320px) {
      .stickers-pack-grid { grid-template-columns: repeat(5, minmax(260px, 1fr)); }
    }
    @media (max-width: 760px) {
      .stickers-neon-topbar { padding-inline: 10px; gap: 8px; }
      .stickers-back { width: 42px; height: 42px; font-size: 18px; }
      .stickers-title b { font-size: 22px; }
      .stickers-title small { font-size: 9px; letter-spacing: .08em; }
      .stickers-balance { height: 36px; padding-inline: 10px; font-size: 13px; }
      .stickers-neon-scroll { padding: 10px 9px calc(112px + env(safe-area-inset-bottom)); }
      .stickers-pack-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
      .sticker-pack-card { min-height: 174px; padding: 9px 8px; border-radius: 8px; }
      .sticker-pack-head { display: block; margin-bottom: 4px; }
      .sticker-pack-name { font-size: 12px; line-height: 1.15; }
      .sticker-pack-tag { display: none; }
      .sticker-face-grid { grid-template-rows: repeat(2, 46px); gap: 4px; padding: 4px 2px 8px; }
      .sticker-face { width: 46px; height: 46px; border-radius: 8px; }
      .sticker-buy-pill { min-width: 96px; height: 30px; font-size: 15px; }
      .stickers-legend-bar {
        left: 8px;
        right: 8px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 7px 8px;
        gap: 2px 8px;
      }
      .legend-badge { justify-content: flex-start; font-size: 10px; min-height: 24px; }
      .legend-rate { grid-column: 1 / -1; justify-self: center; border-left: 0; padding-left: 0; font-size: 12px; }
    }
  `]));
}

function packTheme(pack) {
  return {
    color: pack.themeColor || FALLBACK_THEME.color,
    glow: pack.themeGlow || FALLBACK_THEME.glow,
    panel: pack.panelColor || FALLBACK_THEME.panel,
  };
}

function renderFace(sticker, index) {
  const img = typeof sticker === 'string' ? sticker : sticker?.img;
  return h('div', { class: 'sticker-face', style: `--tilt:${index % 2 ? '4deg' : '-3deg'}` }, [
    h('img', { src: img, alt: sticker?.name || '' }),
  ]);
}

function renderPackCard(root, pack) {
  const theme = packTheme(pack);
  const owned = Number(pack.owned || 0) > 0;
  const faces = (pack.preview || pack.stickers || []).slice(0, 8);
  return h('article', {
    class: 'sticker-pack-card',
    style: `--pack-color:${theme.color};--pack-glow:${theme.glow};--pack-panel:${theme.panel}`,
  }, [
    h('div', { class: 'sticker-pack-head' }, [
      h('span', { class: 'sticker-pack-tag' }, [owned ? 'OLINGAN' : (pack.tag || 'PACK')]),
      h('div', { class: 'sticker-pack-name' }, [String(pack.name || '').toUpperCase()]),
      h('span', { class: 'sticker-pack-tag' }, [pack.rarity ? pack.rarity.toUpperCase() : 'PACK']),
    ]),
    h('div', { class: 'sticker-face-grid' }, faces.map(renderFace)),
    h('div', { class: 'sticker-buy-row' }, [
      h('button', {
        class: `sticker-buy-pill${owned ? ' owned' : ''}`,
        type: 'button',
        onclick: async () => {
          sfx.play('click');
          if (owned) {
            toast(`${pack.name} sizda bor`, 'info');
            return;
          }
          if (!pack.priceGold) {
            toast(`${pack.name} maxsus yutuqlardan ochiladi`, 'info');
            return;
          }
          if (!confirm(`${pack.name} paketini 🪙 ${pack.priceGold} ga sotib olasizmi?`)) return;
          try {
            const result = await api.stickerBuy(pack.id);
            if (result?.goldCoins !== undefined && state.user) state.user.gold_coins = result.goldCoins;
            sfx.play('coin');
            toast(`✓ ${pack.name} sotib olindi`, 'success');
            renderStickers(root);
          } catch (e) {
            toast(e.message || 'Xatolik', 'error');
          }
        },
      }, [owned ? "O'YINDA BOR" : `🪙 ${pack.priceGold || 'FREE'}`]),
    ]),
  ]);
}

function renderLegendBar() {
  return h('div', { class: 'stickers-legend-bar' }, [
    h('div', { class: 'legend-badge' }, ['★', 'EKSKLYUZIV']),
    h('div', { class: 'legend-badge legend-purple' }, ['✦', 'ANIMATSIYALI']),
    h('div', { class: 'legend-badge legend-blue' }, ['⚡', 'OVOZ EFFEKTLLI']),
    h('div', { class: 'legend-badge legend-green' }, ['🎁', 'DOIM YANGILANADI']),
    h('div', { class: 'legend-rate' }, ['55 🪙 = 1 USD']),
  ]);
}

async function loadPacks() {
  try {
    return await api.stickerInventory();
  } catch (_) {
    return api.stickerPacks();
  }
}

export async function renderStickers(root) {
  ensureStyles();
  root.innerHTML = '';

  try { state.user = await api.me(); } catch (_) {}
  const gold = state.user?.gold_coins || 0;

  const wrap = h('div', { class: 'screen stickers-neon-screen' });
  wrap.appendChild(h('div', { class: 'stickers-neon-topbar' }, [
    h('button', {
      class: 'stickers-back',
      type: 'button',
      onclick: () => { sfx.play('click'); navigate('home'); },
      title: 'Ortga',
    }, ['◀']),
    h('div', { class: 'stickers-title' }, [
      h('b', {}, ['🎴 Stikerlar']),
      h('small', {}, ['Durak Imperia Neon Packs']),
    ]),
    h('div', { class: 'stickers-balance' }, ['🪙', fmt(gold)]),
  ]));

  const scroll = h('div', { class: 'stickers-neon-scroll' }, [
    h('div', { class: 'stickers-empty' }, ['Yuklanmoqda...']),
  ]);
  wrap.appendChild(scroll);
  wrap.appendChild(renderLegendBar());
  root.appendChild(wrap);

  let packs = [];
  try {
    packs = await loadPacks();
  } catch (e) {
    scroll.innerHTML = '';
    scroll.appendChild(h('div', { class: 'stickers-error' }, [e.message || "Stikerlar yuklanmadi"]));
    return;
  }

  scroll.innerHTML = '';
  if (!packs.length) {
    scroll.appendChild(h('div', { class: 'stickers-empty' }, ["Hozircha stiker to'plamlari mavjud emas"]));
    return;
  }

  const grid = h('div', { class: 'stickers-pack-grid' });
  packs.forEach((pack) => grid.appendChild(renderPackCard(root, pack)));
  scroll.appendChild(grid);
}
