import { Router } from 'express';
import { StickerController } from './StickerController.js';
import { DashboardController } from './DashboardController.js';

export function createAdminStickersRouter() {
  const router = Router();
  const stickers = new StickerController();
  const dashboard = new DashboardController();

  router.get('/dashboard/stats', dashboard.stats);
  router.get('/', stickers.index);
  router.post('/', stickers.create);
  router.get('/:id', stickers.show);
  router.put('/:id', stickers.update);
  router.patch('/:id/prices', stickers.prices);
  router.delete('/:id', stickers.destroy);

  return router;
}
