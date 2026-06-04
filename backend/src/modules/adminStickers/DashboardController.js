import { StickerRepository } from './StickerRepository.js';

export class DashboardController {
  constructor(repository = new StickerRepository()) {
    this.repository = repository;
  }

  stats = async (_req, res, next) => {
    try {
      res.json(await this.repository.stats());
    } catch (err) { next(err); }
  };
}
