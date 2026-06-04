// TOR §8 — Uraven rank ladder.
//
// Each colour band has 4 lines × 100 wins and 3 "+" markers between bands.
// Filling all four lines collapses them into one "+"; a third "+" promotes
// the player to the next colour. The first colour is "white"; six bands
// in total before the ladder caps at black "ink".

export const RANK_COLORS = ['white', 'gold', 'red', 'blue', 'pink', 'ink'];
export const WINS_PER_LINE = 100;
export const LINES_PER_PLUS = 4;
export const PLUSES_PER_COLOR = 3;
export const WINS_PER_COLOR = WINS_PER_LINE * LINES_PER_PLUS * PLUSES_PER_COLOR; // 1200

/**
 * Turn a total-wins counter into the four-field rank state surfaced in the
 * profile UI. The maximum rank is "ink" with all four lines + three "+"
 * pinned at the cap.
 */
export function computeRankFromWins(totalWins) {
  const wins = Math.max(0, Math.floor(totalWins) || 0);
  const maxCarrying = WINS_PER_COLOR * (RANK_COLORS.length - 1);
  if (wins >= maxCarrying) {
    return {
      color: RANK_COLORS[RANK_COLORS.length - 1],
      lines: LINES_PER_PLUS,
      pluses: PLUSES_PER_COLOR,
      progress: WINS_PER_LINE,
    };
  }
  const colorIdx = Math.min(RANK_COLORS.length - 1, Math.floor(wins / WINS_PER_COLOR));
  const within = wins % WINS_PER_COLOR;
  const pluses = Math.floor(within / (WINS_PER_LINE * LINES_PER_PLUS));
  const linesWithinPlus = within - pluses * WINS_PER_LINE * LINES_PER_PLUS;
  const lines = Math.floor(linesWithinPlus / WINS_PER_LINE);
  const progress = linesWithinPlus % WINS_PER_LINE;
  return { color: RANK_COLORS[colorIdx], lines, pluses, progress };
}

/**
 * Inverse — turn the cached state back into a total wins value so we can
 * resync after data drift (e.g. an admin manually edits `rank_wins`).
 */
export function winsFromRank({ color, lines = 0, pluses = 0, progress = 0 }) {
  const idx = RANK_COLORS.indexOf(color);
  if (idx < 0) return 0;
  return idx * WINS_PER_COLOR
       + pluses * WINS_PER_LINE * LINES_PER_PLUS
       + lines * WINS_PER_LINE
       + Math.max(0, Math.min(WINS_PER_LINE, progress));
}
