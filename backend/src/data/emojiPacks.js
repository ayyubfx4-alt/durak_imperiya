// Emoji collection packs. Premium packs are bought with Gold Coin; every pack
// exposes a visible preview so players can see what they are buying.
const CURATED = [
  ['Vampir', 'legendary', 75, ['🧛‍♂️','😂','😱','😈','👍','😍','😎','🌹'], ['exclusive', 'animated']],
  ['Legend Queen', 'legendary', 99, ['👸','👑','😍','😘','🙋‍♀️','💅','💖','✨'], ['exclusive']],
  ['Samurai', 'epic', 89, ['🥷','😡','😴','👍','❤️','⚔️','😤','🔥'], ['exclusive']],
  ['Ninja', 'epic', 79, ['🥷','👀','🤫','👍','😳','🌙','💨','⚡'], ['animated']],
  ['Panda', 'rare', 69, ['🐼','😂','😭','😡','😎','❤️','👍','🥹'], ['new']],
  ['Koala', 'rare', 69, ['🐨','😂','😭','😴','😍','👍','😳','💤'], ['new']],
  ['Blink Girl', 'rare', 59, ['👩‍🎤','😉','😂','😍','😘','🙋‍♀️','💜','✨'], ['animated']],
  ['Cool Boy', 'rare', 59, ['😎','😁','😂','😍','👍','🤝','🔥','💙'], ['sound']],
  ['Pirate', 'epic', 79, ['🏴‍☠️','😈','😂','👑','👍','💰','⚓','🦜'], ['exclusive']],
  ['Clown', 'rare', 69, ['🤡','😂','😭','😱','👍','❤️','🎈','🎪'], ['animated']],
  ['Dragon', 'mythic', 119, ['🐲','🐉','🔥','😡','💚','💜','⚡','👑'], ['exclusive', 'sound']],
  ['Wolf', 'rare', 69, ['🐺','😂','😡','😭','❤️','👍','🌕','⚡'], ['new']],
  ['Lion', 'rare', 69, ['🦁','😡','😭','😍','👑','👍','🔥','💛'], ['exclusive']],
  ['Skull', 'rare', 59, ['💀','😂','😭','😍','😡','😴','🖤','⚡'], ['animated']],
  ['Alien', 'epic', 79, ['👽','😂','😍','😭','😎','👍','🛸','💚'], ['sound']],
  ['Devil', 'rare', 69, ['😈','👿','😂','😍','😡','👍','🔥','❤️'], ['animated']],
  ['Angel', 'rare', 59, ['😇','👼','😍','😭','🙋‍♀️','✨','🤍','👍'], ['new']],
  ['Pumpkin', 'rare', 59, ['🎃','😂','😭','😱','😍','😵','🔥','🌙'], ['animated']],
  ['Robot', 'rare', 69, ['🤖','😂','😍','😭','😴','👍','⚙️','💙'], ['sound']],
  ['Ghost', 'rare', 59, ['👻','😂','😭','😍','😱','😴','🐾','❔'], ['animated']],
  ['Bunny', 'rare', 59, ['🐰','😂','😭','😍','😴','👍','🌸','🤍'], ['new']],
  ['Cat', 'rare', 59, ['🐱','😺','😻','😂','😭','👍','🐾','💛'], ['new']],
  ['Emoji Classic', 'common', 39, ['😀','😂','😍','😮','😊','😉','😎','😭'], ['free']],
  ['Sport', 'rare', 59, ['⚽','🏀','🏈','🎱','😭','😡','👍','🏆'], ['new']],
  ['Money', 'rare', 59, ['💰','🤑','💵','🤫','😭','😍','👍','💸'], ['sound']],
];

const EXTRA = [
  'Knight Order', 'Robot Army', 'Forest Spirits', 'Mermaid Tales', 'Mythic Beasts',
  'Cyber Punks', 'Old West', 'Galaxy Guards', 'Crystal Mages', 'Demon Hunters',
  'Fox Friends', 'Tiger Clan', 'Sky Pirates', 'Steam Engineers', 'Magic School',
  'Fire Phoenix', 'Ice Wizards', 'Sand Warriors', 'Sea Monsters', 'Cloud Riders',
  'Volcano Lords', 'Shadow Realm', 'Light Knights', 'Forest Rangers', 'City Slickers',
];

function makePack(theme, i) {
  if (Array.isArray(theme)) {
    const [name, rarity, priceGold, preview, features] = theme;
    return {
      id: `pack_${String(i + 1).padStart(2, '0')}`,
      name,
      rarity,
      premium: false,
      priceGold,
      preview,
      features,
      emoji: Array.from({ length: 30 }, (_, j) => ({
        id: `${i + 1}_${j + 1}`,
        name: `${name} #${j + 1}`,
        glyph: preview[j % preview.length],
        img: `/emoji/pack_${String(i + 1).padStart(2, '0')}/${j + 1}.png`,
      })),
    };
  }
  const rarity = i < 35 ? 'uncommon' : i < 45 ? 'rare' : 'legendary';
  const preview = ['😀','😂','😍','😎','😭','👍','🔥','✨'];
  return {
    id: `pack_${String(i + 1).padStart(2, '0')}`,
    name: theme,
    rarity,
    premium: i >= 45,
    priceGold: rarity === 'legendary' ? 119 : rarity === 'rare' ? 79 : 59,
    preview,
    features: ['new'],
    emoji: Array.from({ length: 30 }, (_, j) => ({
      id: `${i + 1}_${j + 1}`,
      name: `${theme} #${j + 1}`,
      glyph: preview[j % preview.length],
      img: `/emoji/pack_${String(i + 1).padStart(2, '0')}/${j + 1}.png`,
    })),
  };
}

export const EMOJI_PACKS = [...CURATED, ...EXTRA].map(makePack);
export const PACK_BY_ID = Object.fromEntries(EMOJI_PACKS.map((p) => [p.id, p]));

export function rarityWeight(rarity) {
  switch (rarity) {
    case 'common': return 60;
    case 'uncommon': return 25;
    case 'rare': return 12;
    case 'epic': return 8;
    case 'legendary': return 3;
    case 'mythic': return 1;
    default: return 0;
  }
}

export function rollRandomEmoji() {
  const weights = EMOJI_PACKS.map((p) => (p.premium ? 0 : rarityWeight(p.rarity)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let pickedIdx = 0;
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) { pickedIdx = i; break; }
    r -= weights[i];
  }
  const pack = EMOJI_PACKS[pickedIdx];
  const emoji = pack.emoji[Math.floor(Math.random() * pack.emoji.length)];
  return { packId: pack.id, emojiId: emoji.id, name: emoji.name, rarity: pack.rarity };
}
