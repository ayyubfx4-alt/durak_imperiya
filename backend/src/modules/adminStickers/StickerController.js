import { HttpError } from '../../middleware/error.js';
import { StickerRepository } from './StickerRepository.js';
import { normalizeStickerInput, parsePagination, parseStickerFilters } from './validators.js';

export class StickerController {
  constructor(repository = new StickerRepository()) {
    this.repository = repository;
  }

  index = async (req, res, next) => {
    try {
      const result = await this.repository.getAll(parseStickerFilters(req.query), parsePagination(req.query));
      res.json(result);
    } catch (err) { next(err); }
  };

  show = async (req, res, next) => {
    try {
      const sticker = await this.repository.findById(req.params.id);
      if (!sticker) throw new HttpError(404, 'sticker not found');
      res.json(sticker);
    } catch (err) { next(err); }
  };

  create = async (req, res, next) => {
    try {
      const sticker = await this.repository.create(normalizeStickerInput(req.body));
      await this.audit(req, 'sticker_create', sticker.id, sticker);
      res.status(201).json(sticker);
    } catch (err) { next(err); }
  };

  update = async (req, res, next) => {
    try {
      const sticker = await this.repository.update(req.params.id, normalizeStickerInput(req.body, { partial: true }));
      if (!sticker) throw new HttpError(404, 'sticker not found');
      await this.audit(req, 'sticker_update', sticker.id, sticker);
      res.json(sticker);
    } catch (err) { next(err); }
  };

  destroy = async (req, res, next) => {
    try {
      const ok = await this.repository.delete(req.params.id);
      if (!ok) throw new HttpError(404, 'sticker not found');
      await this.audit(req, 'sticker_delete', req.params.id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  };

  prices = async (req, res, next) => {
    try {
      const sticker = await this.repository.update(req.params.id, {
        priceGold: req.body?.priceGold ?? req.body?.price_gold ?? 0,
        priceUzs: req.body?.priceUzs ?? req.body?.price_uzs ?? 0,
      });
      if (!sticker) throw new HttpError(404, 'sticker not found');
      await this.audit(req, 'sticker_price_update', sticker.id, {
        priceGold: sticker.priceGold,
        priceUzs: sticker.priceUzs,
        dynamicPrice: sticker.dynamicPrice,
      });
      res.json(sticker);
    } catch (err) { next(err); }
  };

  audit(req, action, targetId, metadata = null) {
    if (typeof req.adminAudit === 'function') return req.adminAudit(action, targetId, metadata);
    return Promise.resolve();
  }
}
