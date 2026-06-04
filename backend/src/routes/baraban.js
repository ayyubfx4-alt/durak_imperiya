// routes/baraban.js — Feature 31: Baraban Spin Wheel
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getBarabanStatus, spinBaraban, getSpinHistory } from '../services/baraban.js';
import { getIo } from '../game/socketRegistry.js';

export const barabanRouter = Router();
barabanRouter.use(authRequired);

// GET /api/baraban/status — can spin? next spin time? multiplier?
barabanRouter.get('/status', async (req, res, next) => {
  try {
    const status = await getBarabanStatus(req.user.id);
    res.json(status);
  } catch (err) { next(err); }
});

// POST /api/baraban/spin — perform spin (validated, transactional)
barabanRouter.post('/spin', async (req, res, next) => {
  try {
    const result = await spinBaraban(req.user.id);
    getIo()?.emit('user:stats-dirty', {
      reason: 'baraban-spin',
      userIds: [req.user.id],
      at: Date.now(),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    // Expose 403/429 messages to the client directly
    if (err.status === 403 || err.status === 429) {
      return res.status(err.status).json({
        error: err.message,
        nextSpinMs: err.nextSpinMs,
      });
    }
    next(err);
  }
});

// GET /api/baraban/history — last 10 spins for current user
barabanRouter.get('/history', async (req, res, next) => {
  try {
    const history = await getSpinHistory(req.user.id);
    res.json(history);
  } catch (err) { next(err); }
});
