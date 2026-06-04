import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getAIUsage, consumeAIUsage } from '../services/aiUsage.js';

export const aiRouter = Router();

function isPremium(user) {
  return !!(user?.premium_until && new Date(user.premium_until) > new Date());
}

aiRouter.get('/usage', authRequired, async (req, res, next) => {
  try {
    res.json(await getAIUsage(req.user.id, isPremium(req.user)));
  } catch (err) { next(err); }
});

aiRouter.post('/consume', authRequired, async (req, res, next) => {
  try {
    res.json(await consumeAIUsage(req.user.id, isPremium(req.user)));
  } catch (err) { next(err); }
});
