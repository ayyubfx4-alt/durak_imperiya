import { Router } from 'express';
import { authRequired, adminRequired, adminPermission } from '../middleware/auth.js';
import { query } from '../db.js';
import {
  configureTelegramBot,
  sendTelegramAdminTestMessage,
  sendTelegramBroadcast,
  telegramBroadcasts,
  telegramBotHealth,
  telegramEvents,
  telegramStats,
  telegramUsers,
} from '../services/telegramBot.js';

export const telegramAdminRouter = Router();

telegramAdminRouter.use(authRequired, adminRequired);
telegramAdminRouter.use(adminPermission(['notifications.send']));

telegramAdminRouter.get('/stats', async (_req, res, next) => {
  try {
    res.json(await telegramStats());
  } catch (err) { next(err); }
});

telegramAdminRouter.get('/health', async (_req, res, next) => {
  try {
    res.json(await telegramBotHealth());
  } catch (err) { next(err); }
});

telegramAdminRouter.get('/users', async (req, res, next) => {
  try {
    res.json(await telegramUsers({
      active: String(req.query.active || 'all'),
      limit: req.query.limit,
    }));
  } catch (err) { next(err); }
});

telegramAdminRouter.get('/broadcasts', async (req, res, next) => {
  try {
    res.json(await telegramBroadcasts({ limit: req.query.limit }));
  } catch (err) { next(err); }
});

telegramAdminRouter.get('/events', async (req, res, next) => {
  try {
    res.json(await telegramEvents({ limit: req.query.limit }));
  } catch (err) { next(err); }
});

telegramAdminRouter.post('/configure', async (req, res, next) => {
  try {
    const result = await configureTelegramBot();
    await query(
      'INSERT INTO audit_log (admin_id, action, metadata) VALUES ($1, $2, $3)',
      [req.user?.id || null, 'telegram_configure', { result }]
    ).catch(() => {});
    res.json({ ok: true, result });
  } catch (err) { next(err); }
});

telegramAdminRouter.post('/test-admin-message', async (req, res, next) => {
  try {
    const result = await sendTelegramAdminTestMessage({ message: req.body?.message });
    await query(
      'INSERT INTO audit_log (admin_id, action, metadata) VALUES ($1, $2, $3)',
      [req.user?.id || null, 'telegram_admin_test_message', result]
    ).catch(() => {});
    res.json(result);
  } catch (err) { next(err); }
});

telegramAdminRouter.post('/broadcast', async (req, res, next) => {
  try {
    const result = await sendTelegramBroadcast({
      message: req.body?.message,
      broadcast: req.body?.broadcast,
      adminId: req.user?.id || null,
    });
    await query(
      'INSERT INTO audit_log (admin_id, action, metadata) VALUES ($1, $2, $3)',
      [req.user?.id || null, 'telegram_broadcast', result]
    ).catch(() => {});
    res.json(result);
  } catch (err) { next(err); }
});
