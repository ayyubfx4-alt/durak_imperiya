const paid = [
  ['classic_gold', 'Classic Gold', 'legendary', 0, '#050506', '#eee7cf', 'premium', null],
  ['royal_queen', 'Royal Queen', 'legendary', 129000, '#24123d', '#d99bff', 'premium', '/images/kartalar/royal-queen-premium.jfif'],
  ['black_diamond', 'Black Diamond', 'epic', 129000, '#09090b', '#d9dee8', 'premium', '/images/kartalar/black-diamond-premium.jfif'],
  ['mafia_style', 'Mafia Style', 'rare', 129000, '#111111', '#f2ede2', 'premium', '/images/kartalar/mafia-noir-premium.jfif'],
  ['winter_ice', 'Winter Ice', 'rare', 119000, '#061827', '#8feaff', 'premium', '/images/kartalar/winter-ice-premium.jfif'],
  ['imperial_spade', 'Imperial Mask', 'legendary', 159000, '#100b05', '#e8b44e', 'premium', '/images/kartalar/imperial-mask-premium.jfif'],
  ['golden_sun', 'Golden Serpent', 'legendary', 149000, '#311c06', '#ffcf55', 'premium', '/images/kartalar/golden-serpent-premium.jfif'],
  ['pirate_king', 'Pirate King', 'rare', 129000, '#1d1207', '#d9a047', 'premium', '/images/kartalar/pirate-king-premium.jfif'],
  ['cyber_neon', 'Cyber Neon', 'epic', 149000, '#07142b', '#3cc8ff', 'premium', '/images/kartalar/cyber-neon-premium.jfif'],
];

const random = [];

export const CARD_SKINS = [
  { id: 'default', name: 'Oddiy', rarity: 'common', priority: 0, premium: false, priceCoins: 0, tier: 1, collectionType: 'default', palette: { bg: '#f4ead9', accent: '#111111' } },
  ...paid.map(([id, name, rarity, priceCoins, bg, accent, tag, image], index) => ({
    id, name, rarity, priority: 100 + index, premium: false, priceCoins, tier: index + 1,
    collectionType: 'paid', tag, ...(image ? { image } : {}), palette: { bg, accent },
  })),
  ...random.map(([id, name, rarity, priceCoins, bg, accent, image], index) => ({
    id, name, rarity, priority: (image ? 220 : 20) + index, premium: false, priceCoins, tier: index + 1,
    collectionType: 'random', tag: 'free', image, palette: { bg, accent },
  })),
];

export const SKIN_BY_ID = Object.fromEntries(CARD_SKINS.map((s) => [s.id, s]));

export function chooseTableSkin(skinIds) {
  let best = SKIN_BY_ID.default;
  for (const id of skinIds) {
    const s = SKIN_BY_ID[id];
    if (s && s.priority > best.priority) best = s;
  }
  return best;
}
