import { Router } from 'express';
import { grantAdMobSsvReward } from '../services/admobSsv.js';
import { logger } from '../logger.js';

export const admobRouter = Router();

admobRouter.get('/ssv', async (req, res, next) => {
  try {
    const rawQuery = String(req.originalUrl || '').split('?')[1] || '';
    const result = await grantAdMobSsvReward(rawQuery);
    res.status(200).json(result);
  } catch (err) {
    logger.warn('[admob] SSV rejected: %s', err.message);
    next(err);
  }
});
