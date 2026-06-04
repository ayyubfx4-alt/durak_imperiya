export const PROFILE_FRAMES = [
  { id: 'green_leafs', name: 'Green leafs', rarity: 'common', priceGold: 29, icon: '🌿' },
  { id: 'halo', name: 'Halo', rarity: 'common', priceGold: 29, icon: '💫' },
  { id: 'stars', name: 'Stars', rarity: 'common', priceGold: 29, icon: '⭐' },
  { id: 'butterflies', name: 'Butterflies', rarity: 'common', priceGold: 29, icon: '🦋' },
  { id: 'feather', name: 'Feather', rarity: 'common', priceGold: 29, icon: '🪶' },
  { id: 'hearts', name: 'Hearts', rarity: 'common', priceGold: 29, icon: '💖' },
  { id: 'golden_chain', name: 'Golden chain', rarity: 'rare', priceGold: 59, icon: '⛓' },
  { id: 'flowers', name: 'Flowers', rarity: 'rare', priceGold: 59, icon: '🌹' },
  { id: 'imperial_crown', name: 'Imperial Crown', rarity: 'legendary', priceGold: 199, icon: 'C', barabanOnly: true },
];

export const PROFILE_FRAME_BY_ID = Object.fromEntries(PROFILE_FRAMES.map((f) => [f.id, f]));
