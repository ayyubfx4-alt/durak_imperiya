import { query } from '../db.js';
import { computeRankFromWins } from './rank.js';

export function calculateGameStats(rows, userId) {
  let gamesPlayed = 0;
  let gamesWon = 0;
  let gamesLost = 0;
  let gamesDraw = 0;
  let winStreak = 0;
  let lossStreak = 0;

  for (const game of rows) {
    gamesPlayed += 1;
    const isDraw = !!game.is_draw;
    const isLoss = String(game.loser_id || '') === String(userId);
    const isWin = !isDraw && !isLoss;

    if (isDraw) {
      gamesDraw += 1;
      winStreak = 0;
      lossStreak = 0;
    } else if (isLoss) {
      gamesLost += 1;
      winStreak = 0;
      lossStreak += 1;
    } else if (isWin) {
      gamesWon += 1;
      winStreak += 1;
      lossStreak = 0;
    }
  }

  return {
    gamesPlayed,
    gamesWon,
    gamesLost,
    gamesDraw,
    winStreak,
    lossStreak,
    rankWins: gamesWon,
  };
}

export async function syncUserGameStats(userId) {
  const [games, bonusR] = await Promise.all([
    query(
    `SELECT loser_id, is_draw
       FROM games
      WHERE ended_at IS NOT NULL
        AND $1::uuid = ANY(player_ids)
      ORDER BY ended_at ASC, started_at ASC`,
    [userId]
    ),
    query('SELECT COALESCE(bonus_rank_points, 0)::int AS bonus_rank_points FROM users WHERE id = $1', [userId])
      .catch(() => ({ rows: [{ bonus_rank_points: 0 }] })),
  ]);
  const stats = calculateGameStats(games.rows, userId);
  const bonusRankPoints = Number(bonusR.rows[0]?.bonus_rank_points || 0);
  const rankWins = stats.rankWins + bonusRankPoints;
  const rank = computeRankFromWins(rankWins);

  await query(
    `UPDATE users SET
        games_played = $2,
        games_won    = $3,
        games_lost   = $4,
        games_draw   = $5,
        rank_wins    = $6,
        win_streak   = $7,
        loss_streak  = $8,
        rank_color   = $9,
        rank_lines   = $10,
        rank_pluses  = $11,
        rank_progress = $12
      WHERE id = $1`,
    [
      userId,
      stats.gamesPlayed,
      stats.gamesWon,
      stats.gamesLost,
      stats.gamesDraw,
      rankWins,
      stats.winStreak,
      stats.lossStreak,
      rank.color,
      rank.lines,
      rank.pluses,
      rank.progress,
    ]
  );

  return stats;
}

export async function syncManyUserGameStats(userIds) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(String))];
  for (const id of uniqueIds) {
    await syncUserGameStats(id);
  }
}
