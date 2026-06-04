// TOR §14 — in-game complaint endpoints. Players submit a report via the
// "Shikoyat" button; admins consume the queue from the admin panel.
import { Router } from 'express';
import { authRequired, adminRequired } from '../middleware/auth.js';
import {
  submitReport,
  listReports,
  resolveReport,
  REPORT_REASONS,
  REPORT_RESOLUTIONS,
} from '../services/reports.js';
import { HttpError } from '../middleware/error.js';

export const reportsRouter = Router();

reportsRouter.get('/reasons', (_req, res) => {
  res.json({ reasons: REPORT_REASONS, resolutions: REPORT_RESOLUTIONS });
});

reportsRouter.post('/', authRequired, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.reportedId) throw new HttpError(400, 'reportedId required');
    const r = await submitReport({
      reporterId: req.user.id,
      reportedId: String(body.reportedId),
      roomCode: body.roomCode ? String(body.roomCode).slice(0, 16) : null,
      gameId: body.gameId ? String(body.gameId).slice(0, 64) : null,
      reason: body.reason,
      details: body.details,
    });
    res.json({ ok: true, ...r });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

reportsRouter.get('/admin', authRequired, adminRequired, async (req, res, next) => {
  try {
    const rows = await listReports({
      status: req.query.status || 'open',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(rows);
  } catch (err) { next(err); }
});

reportsRouter.post('/admin/:id/resolve', authRequired, adminRequired, async (req, res, next) => {
  try {
    const r = await resolveReport({
      reportId: req.params.id,
      adminId: req.user.id,
      resolution: String(req.body?.resolution || 'no_action'),
    });
    res.json(r);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});
