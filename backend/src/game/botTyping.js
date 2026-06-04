// Bot "typing..." simulation — TOR §3: bots must be indistinguishable from real humans.
//
// Strategy:
//   1. Before any bot action, emit `player:typing` (just like a human pressing buttons).
//   2. Variable delay: 800ms (easy/fast) to 4500ms (hard, "thinking" hard moves).
//   3. Occasional misclick simulation — bot "starts" typing then cancels (rare, 5%).
//   4. Chat-like messages — bots randomly chat (1% per turn) from a curated pool.

const BOT_CHAT_LINES = [
  'salom 😀', 'salom hammaga', 'qanaqasiz', 'omad', 'kim yutadi?',
  "qiziq o'yin", 'koziri yaxshi', 'hmm...', 'fikrlayapman', 'tugadi shekilli',
  '😅', '😂', '👍', '🔥', 'rahmat', "yana o'ynaymizmi?",
  "boplading", "shu yetar", "ehtiyot bo'l", 'qattiq', 'a-ha',
  'ohho', 'voy', 'zo\'r', 'koziringni saqla', 'oxirgi karta',
];

/** Pick a random "human-like" thinking delay based on bot difficulty. */
export function pickThinkDelay(level = 'medium', actionKind = 'attack') {
  const base = {
    easy:   [1000, 2200],
    medium: [1500, 3400],
    hard:   [2200, 5200],
  }[level] || [1500, 3400];
  // Defense + take are slower (more thinking)
  const mul = actionKind === 'defense' ? 1.25 : actionKind === 'take' ? 1.15 : 1.0;
  const [lo, hi] = base;
  return Math.floor((lo + Math.random() * (hi - lo)) * mul);
}

/** Should this bot send a chat message this turn? */
export function maybeBotChat() {
  // ~1.2% chance per turn → a 20-turn game gives ~22% probability of at least one chat
  if (Math.random() > 0.012) return null;
  return BOT_CHAT_LINES[Math.floor(Math.random() * BOT_CHAT_LINES.length)];
}

/** Random pool of emoji reactions bots send after big events (win/lose/take). */
const BOT_EMOJI_REACTIONS = {
  win:  ['🎉', '🔥', '😎', '💪', '👑'],
  lose: ['😅', '😭', '🤦', '😤', '🤷'],
  take: ['😬', '😩', '🥺'],
};
export function botEmojiFor(kind) {
  const pool = BOT_EMOJI_REACTIONS[kind];
  if (!pool || Math.random() > 0.35) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
