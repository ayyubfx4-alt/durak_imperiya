// Bot "typing..." simulation. Bots should feel paced like real players while
// the server keeps every move authoritative.

const BOT_CHAT_LINES = [
  'salom',
  'omad',
  '🔥',
  'boplading',
];

const THINK_RANGES_MS = {
  easy: [600, 1400],
  medium: [900, 2200],
  hard: [1200, 3500],
};

const BOT_EMOJI_REACTIONS = {
  win: ['🎉', '🔥', '😎', '💪', '👑'],
  lose: ['😅', '😭', '🤦', '😤', '🤷'],
  take: ['😬', '😩', '🥺'],
};

export function pickThinkDelay(level = 'medium') {
  const [lo, hi] = THINK_RANGES_MS[level] || THINK_RANGES_MS.medium;
  return Math.floor(lo + Math.random() * (hi - lo));
}

export function maybeBotChat() {
  if (Math.random() > 0.012) return null;
  return BOT_CHAT_LINES[Math.floor(Math.random() * BOT_CHAT_LINES.length)];
}

export function botEmojiFor(kind) {
  const pool = BOT_EMOJI_REACTIONS[kind];
  if (!pool || Math.random() > 0.35) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
