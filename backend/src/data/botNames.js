/**
 * Global bot pool — TOR §3.
 *
 * We keep a fixed list of 100 realistic-looking usernames covering Uzbek
 * names, transliterations, and Western gamer-tags so individual bots cannot
 * be distinguished from real players. The `BOT_NAMES` array is the union of
 * those names and is used:
 *
 *   1. By the `db.bot_pool` seeder so the DB has exactly 100 deterministic
 *      bots (each with a rank tier + avatar metadata).
 *   2. As a fall-back name picker if the DB is unavailable (e.g. in unit
 *      tests that run without a Postgres instance).
 */
export const BOT_NAMES = [
  // Original v3 cohort.
  'Aybek_07', 'Sherzod', 'Diyora', 'Malika22', "Ulug'bek", 'Nodira',
  'Botir_K', 'Sevinch', 'Otabek', 'Madina_M', 'Jasur', 'KamillA',
  'Rustam99', 'Lobar', 'Doniyor', 'Gulnoza', 'Sardor', 'Dilfuza',
  'Akmal', 'Zarina', 'Behzod', 'Nigora', 'Tohir', 'Ozodbek',
  'Iskandar', 'Feruza', 'Bobur', 'Mahliyo', 'Anvar', 'Saodat',
  'NightWolf', 'CardKing', 'TrumpQueen', 'AceShark', 'KozirBoss',
  'Durak_Master', 'PixelHero', 'ShadowFox', 'IronDeck', 'GoldRush',
  'Firdavs', 'Komron', 'Asilbek', 'Shaxzoda', 'Mirzo', 'Xayrullo',
  'Madinabonu', 'Munisa', 'Shahriyor', 'Baxtiyor',
  // Expanded v4 cohort — brings the pool to exactly 100 names.
  'Rixsi', 'Sanjar', 'Aziz_K', 'Bekzod', 'Eldor', 'Farrux',
  'Gulshan', 'Hasan_A', 'Ilhom', 'Jamshid', 'Kamol', 'Laziza',
  'Mansur', 'Nazifa', 'Oybek', 'Parviz', 'Qudrat', 'Ravshan',
  'Sevara_M', 'Temur', 'Umida_R', 'Vali', 'Wahid', 'Xushnud',
  'Yusuf_K', 'Zafar', 'CrimsonAce', 'DustyKing', 'FrostJack',
  'GhostPlayer', 'IceWolf', 'JadeRook', 'KryptKing', 'LunaShark',
  'MidnightRogue', 'NeonNomad', 'OnyxBlade', 'PhantomQueen',
  'QuickdrawZ', 'RogueAce', 'SilverPawn', 'TopcardX', 'UltraSpade',
  'VoidWalker', 'WildHand', 'XenoBet', 'YellowSnake', 'ZenithFox',
  'CardSavant', 'BluffMaster',
];

export const BOT_POOL_SIZE = BOT_NAMES.length;

/**
 * Deterministically build the 100-row bot pool description used by the DB
 * seeder. Rank colour / lines / pluses follow the TOR avatar scheme:
 *
 *   • 1–399 wins   → white lines (1 line every 100 wins, capped at 3)
 *   • 400–1199     → gray with white "+" symbols (one per 100 wins beyond 400)
 *   • 1200–2399    → gold tier
 *   • 2400–3599    → red tier
 *   • 3600+        → black tier
 *
 * The seeder uses `rank_wins` to spread bots across every tier so the lobby
 * shows a believable distribution of skill bands.
 */
import { computeRankFromWins, WINS_PER_COLOR, RANK_COLORS } from '../services/rank.js';

export function buildBotPoolSpec() {
  // 5 of the 6 Uraven colours are reachable for bots; "ink" is reserved for
  // human grinders. Skill level scales with the rank colour so the lobby's
  // visible badge roughly predicts opponent strength.
  const colors = RANK_COLORS.slice(0, 5);
  const levelByColor = { white: 'easy', gold: 'easy', red: 'medium', blue: 'medium', pink: 'hard' };
  return BOT_NAMES.map((name, i) => {
    const colorIdx = i % colors.length;
    // Spread wins evenly inside the colour band using a coprime stride so we
    // don't bunch up on round numbers.
    const offset = ((i * 7919) % WINS_PER_COLOR);
    const wins = colorIdx * WINS_PER_COLOR + offset;
    const r = computeRankFromWins(wins);
    return {
      id: `bot-${String(i + 1).padStart(3, '0')}`,
      username: name,
      rankWins: wins,
      avatarColor: r.color,
      avatarLines: r.lines,
      avatarPluses: r.pluses,
      botLevel: levelByColor[r.color] || 'medium',
    };
  });
}

/**
 * Fallback name picker used when there's no DB-backed pool to draw from
 * (e.g. unit tests or migration not yet run). Picks any name not already in
 * `taken`. Returns a stand-in `PlayerN` if the pool is exhausted.
 */
export function pickBotName(taken = new Set()) {
  const free = BOT_NAMES.filter((n) => !taken.has(n));
  if (free.length === 0) {
    return `Player${Math.floor(Math.random() * 9999)}`;
  }
  return free[Math.floor(Math.random() * free.length)];
}
