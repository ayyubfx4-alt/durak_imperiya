// Sticker packs - premium catalog used by shop, profile and game send.
// Real assets live at: /stickers/<packId>/<fileName>.

const STICKER_ASSET_FILES = {
  pack_vampir: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_legend_queen: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg'],
  pack_samurai: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_ninja: ['1.jpg', '1.png', '2.png', '3.png', '4.png', '5.png', '6.png'],
  pack_panda: ['1.png', '2.png', '3.jpg', '4.jpg', '5.png', '6.png', '7.jpg'],
  pack_koala: ['1.png', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '8.jpg', '9.jpg'],
  pack_blink_girl: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.png', '6.jpg', '7.jpg', '8.png'],
  pack_cool_boy: ['1.jpg', '2.png', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_pirate: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg', '9.jpg'],
  pack_clown: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg'],
  pack_dragon: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg'],
  pack_wolf: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_lion: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_skull: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_alien: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_angel: ['2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg', 'farishta.jpg'],
  pack_pumpkin: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_robot: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_ghost: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_bunny: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_cat: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg', '9.jpg'],
  pack_emoji_classic: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_sport: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'],
  pack_money: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg'],
};

export const STICKER_THEMES = [
  { id: 'pack_starter', name: 'STARTER', tag: 'BEPUL', rarity: 'common', priceGold: 0, forSale: false, freeDefault: true, color: '#fbbf24', panel: 'rgba(35,24,8,.68)', glow: 'rgba(251,191,36,.36)' },
  { id: 'pack_vampir', name: 'VAMPIR', tag: 'EKSKLYUZIV', rarity: 'common', priceGold: 75, color: '#b45cff', panel: 'rgba(31,8,48,.62)', glow: 'rgba(180,92,255,.42)' },
  { id: 'pack_legend_queen', name: 'LEGEND QUEEN', tag: 'PREMIUM', rarity: 'common', priceGold: 99, color: '#f7c95a', panel: 'rgba(63,41,8,.58)', glow: 'rgba(247,201,90,.46)' },
  { id: 'pack_samurai', name: 'SAMURAI', tag: 'EKSKLYUZIV', rarity: 'common', priceGold: 89, color: '#ef4444', panel: 'rgba(58,14,18,.58)', glow: 'rgba(239,68,68,.42)' },
  { id: 'pack_ninja', name: 'NINJA', tag: 'ANIMATED', rarity: 'uncommon', priceGold: 79, color: '#8b5cf6', panel: 'rgba(20,14,48,.62)', glow: 'rgba(139,92,246,.42)' },
  { id: 'pack_panda', name: 'PANDA', tag: 'NEW', rarity: 'uncommon', priceGold: 69, color: '#84cc16', panel: 'rgba(20,45,12,.60)', glow: 'rgba(132,204,22,.38)' },
  { id: 'pack_koala', name: 'KOALA', tag: 'NEW', rarity: 'rare', priceGold: 69, color: '#14b8a6', panel: 'rgba(8,42,43,.60)', glow: 'rgba(20,184,166,.34)' },
  { id: 'pack_blink_girl', name: 'BLINK GIRL', tag: 'NEW', rarity: 'rare', priceGold: 59, color: '#ec4899', panel: 'rgba(55,11,40,.60)', glow: 'rgba(236,72,153,.40)' },
  { id: 'pack_cool_boy', name: 'COOL BOY', tag: 'SOUND', rarity: 'epic', priceGold: 59, color: '#38bdf8', panel: 'rgba(7,29,54,.62)', glow: 'rgba(56,189,248,.40)' },
  { id: 'pack_pirate', name: 'PIRATE', tag: 'EKSKLYUZIV', rarity: 'epic', priceGold: 79, color: '#f59e0b', panel: 'rgba(56,35,7,.62)', glow: 'rgba(245,158,11,.42)' },
  { id: 'pack_clown', name: 'CLOWN', tag: 'ANIMATED', rarity: 'legendary', priceGold: 69, color: '#a855f7', panel: 'rgba(45,12,54,.62)', glow: 'rgba(168,85,247,.38)' },
  { id: 'pack_dragon', name: 'DRAGON', tag: 'EKSKLYUZIV + SOUND', rarity: 'legendary', priceGold: 119, color: '#dc2626', panel: 'rgba(61,13,12,.60)', glow: 'rgba(220,38,38,.44)' },
  { id: 'pack_wolf', name: 'WOLF', tag: 'NEW', rarity: 'rare', priceGold: 69, color: '#64748b', panel: 'rgba(17,24,39,.62)', glow: 'rgba(148,163,184,.36)' },
  { id: 'pack_lion', name: 'LION', tag: 'EKSKLYUZIV', rarity: 'epic', priceGold: 69, color: '#d97706', panel: 'rgba(59,35,8,.60)', glow: 'rgba(217,119,6,.40)' },
  { id: 'pack_skull', name: 'SKULL', tag: 'ANIMATED', rarity: 'rare', priceGold: 59, color: '#94a3b8', panel: 'rgba(22,22,24,.66)', glow: 'rgba(203,213,225,.32)' },
  { id: 'pack_alien', name: 'ALIEN', tag: 'SOUND', rarity: 'epic', priceGold: 79, color: '#65a30d', panel: 'rgba(18,45,10,.60)', glow: 'rgba(132,204,22,.38)' },
  { id: 'pack_angel', name: 'ANGEL', tag: 'NEW', rarity: 'rare', priceGold: 59, color: '#38bdf8', panel: 'rgba(8,39,54,.60)', glow: 'rgba(125,211,252,.38)' },
  { id: 'pack_pumpkin', name: 'PUMPKIN', tag: 'ANIMATED', rarity: 'epic', priceGold: 59, color: '#f97316', panel: 'rgba(58,29,9,.62)', glow: 'rgba(249,115,22,.40)' },
  { id: 'pack_robot', name: 'ROBOT', tag: 'SOUND', rarity: 'legendary', priceGold: 69, color: '#22d3ee', panel: 'rgba(7,34,48,.62)', glow: 'rgba(34,211,238,.38)' },
  { id: 'pack_ghost', name: 'GHOST', tag: 'ANIMATED', rarity: 'rare', priceGold: 59, color: '#818cf8', panel: 'rgba(18,24,48,.62)', glow: 'rgba(129,140,248,.36)' },
  { id: 'pack_bunny', name: 'BUNNY', tag: 'NEW', rarity: 'rare', priceGold: 59, color: '#f472b6', panel: 'rgba(59,16,43,.62)', glow: 'rgba(244,114,182,.38)' },
  { id: 'pack_cat', name: 'CAT', tag: 'NEW', rarity: 'rare', priceGold: 59, color: '#8b5cf6', panel: 'rgba(35,18,56,.62)', glow: 'rgba(139,92,246,.36)' },
  { id: 'pack_emoji_classic', name: 'EMOJI CLASSIC', tag: 'CLASSIC', rarity: 'common', priceGold: 39, color: '#fbbf24', panel: 'rgba(55,35,8,.62)', glow: 'rgba(251,191,36,.36)' },
  { id: 'pack_sport', name: 'SPORT', tag: 'NEW', rarity: 'rare', priceGold: 59, color: '#06b6d4', panel: 'rgba(6,38,45,.62)', glow: 'rgba(6,182,212,.36)' },
  { id: 'pack_money', name: 'MONEY', tag: 'SOUND', rarity: 'epic', priceGold: 59, color: '#65a30d', panel: 'rgba(20,48,8,.62)', glow: 'rgba(132,204,22,.38)' },
];

function fallbackAssetFiles(_theme) {
  return Array.from({ length: 8 }, (_, j) => `${j + 1}.svg`);
}

function stickerAssetFiles(theme) {
  return STICKER_ASSET_FILES[theme.id] || fallbackAssetFiles(theme);
}

export const STICKER_PACKS = STICKER_THEMES.map((theme) => {
  const files = stickerAssetFiles(theme);
  return {
    id: theme.id,
    name: theme.name,
    tag: theme.tag,
    rarity: theme.rarity,
    premium: false,
    priceGold: theme.priceGold,
    forSale: theme.forSale !== false,
    freeDefault: theme.freeDefault === true,
    size: files.length,
    themeColor: theme.color,
    themeGlow: theme.glow,
    panelColor: theme.panel,
    stickers: files.map((fileName, j) => ({
      id: `${theme.id}_${j + 1}`,
      name: `${theme.name} #${j + 1}`,
      img: `/stickers/${theme.id}/${fileName}`,
    })),
  };
});

export const STICKER_PACK_BY_ID = Object.fromEntries(STICKER_PACKS.map((p) => [p.id, p]));

export function getStickerPack(id) {
  return STICKER_PACK_BY_ID[id] || null;
}

export function findStickerById(stickerId) {
  for (const pack of STICKER_PACKS) {
    const sticker = pack.stickers.find((x) => x.id === stickerId);
    if (sticker) return { pack, sticker };
  }
  return null;
}

export function rollRandomSticker(packId) {
  const pack = STICKER_PACK_BY_ID[packId];
  if (!pack) return null;
  const idx = Math.floor(Math.random() * pack.size);
  return { packId, stickerId: pack.stickers[idx].id, sticker: pack.stickers[idx] };
}
