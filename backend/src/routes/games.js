import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { query } from '../db.js';
import { listAchievementProgress } from '../services/achievements.js';
import { syncUserGameStats } from '../services/gameStats.js';

export const gamesRouter = Router();

gamesRouter.get('/me/recent', authRequired, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT id, room_code, mode, stake, started_at, ended_at, winner_id, loser_id, is_draw, player_ids
         FROM games WHERE $1 = ANY(player_ids) ORDER BY started_at DESC LIMIT 25`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

gamesRouter.get('/me/achievements', authRequired, async (req, res, next) => {
  try {
    await syncUserGameStats(req.user.id);
    res.json(await listAchievementProgress(req.user.id));
  } catch (err) { next(err); }
});
