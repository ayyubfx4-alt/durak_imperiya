import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { logger } from './logger.js';
import { setupSocket } from './game/socket.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { inventoryRouter } from './routes/inventory.js';
import { shopRouter } from './routes/shop.js';
import { friendsRouter } from './routes/friends.js';
import { gamesRouter } from './routes/games.js';
import { adminRouter } from './routes/admin.js';
import { telegramAdminRouter } from './routes/telegramAdmin.js';
import { paymentsRouter, stripeWebhookHandler } from './routes/payments.js';
import { tournamentsRouter } from './routes/tournaments.js';
import { donationsRouter } from './routes/donations.js';
import { reportsRouter } from './routes/reports.js';
import { stickersRouter } from './routes/stickers.js';
import { supportRouter } from './routes/support.js';
import { barabanRouter } from './routes/baraban.js';
import { voiceChatRouter } from './routes/voiceChat.js';
import { aiRouter } from './routes/ai.js';
import { productionRouter } from './routes/production.js';
import { admobRouter } from './routes/admob.js';
import { notFound, errorHandler } from './middleware/error.js';
import { adminAssetsRoot } from './services/adminAssets.js';
import { bootstrapAdmin } from './services/auth.js';
import { ensureSeeded as ensureBotPoolSeeded } from './game/botPool.js';
import { ensureFakeDonationsSeeded } from './services/donations.js';
import { pool as getPool, dbHealthCheck } from './db.js';
import { closeRedis, countOnline, isAdapterEnabled } from './scaling/redisAdapter.js';
import { getRoomManager } from './game/socketRegistry.js';
import { startTelegramBot, stopTelegramBot } from './services/telegramBot.js';
import { scalingMode } from './scaling/sessionStore.js';

// ── M3: Sentry error tracking (optional — only activates when SENTRY_DSN set) ──
let Sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    const sentryModule = await import('@sentry/node');
    Sentry = sentryModule;
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: config.env,
      tracesSampleRate: config.env === 'production' ? 0.1 : 1.0,
      // Attach user context from req.user when available.
      beforeSend(event) {
        return event;
      },
    });
    logger.info('[sentry] Sentry initialized (env=%s)', config.env);
  } catch (e) {
    logger.warn('[sentry] @sentry/node not installed — skipping: %s', e.message);
  }
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.corsOrigins, credentials: false }));

// Stripe webhook must run before express.json() so that req.body is the raw buffer.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use('/api/assets/admin', express.static(adminAssetsRoot(), {
  immutable: true,
  maxAge: '30d',
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

app.use(express.json({ limit: '8mb' }));

const generalLimiter = rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true });
// Strict per-IP limit on credential endpoints to slow credential-stuffing.
const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  message: { error: 'too many auth attempts, try again later' },
});
// Light limit on coin-spending endpoints to prevent rapid-fire abuse.
const coinLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  message: { error: 'too many coin operations, slow down' },
});

app.use(generalLimiter);

// M2: Comprehensive health check — DB, Redis, rooms, system stats.
app.get('/health', async (_req, res) => {
  try {
    // DB ping with latency
    const db = await dbHealthCheck();

    // Redis ping
    let redis = { ok: false, latencyMs: null };
    if (isAdapterEnabled()) {
      const t = Date.now();
      const online = await countOnline().catch(() => null);
      redis = { ok: online !== null, latencyMs: Date.now() - t, onlineUsers: online ?? 0 };
    } else {
      redis = { ok: false, note: 'REDIS_URL not set — single-process mode' };
    }

    // Game stats
    const mgr = getRoomManager();
    const rooms      = mgr ? mgr.rooms.size : 0;
    const activePlayers = mgr
      ? Array.from(mgr.rooms.values()).reduce((s, r) => s + r.seats.filter((seat) => seat && !seat.isBot).length, 0)
      : 0;

    // Memory
    const mem = process.memoryUsage();

    const status = db.ok ? 'ok' : 'degraded';
    res.status(db.ok ? 200 : 503).json({
      status,
      ts:         Date.now(),
      uptime:     Math.floor(process.uptime()),
      instance:   scalingMode().instanceId,
      env:        config.env,
      db:         { ok: db.ok, latencyMs: db.latencyMs, error: db.error },
      redis:      redis,
      game:       { activeRooms: rooms, activePlayers },
      memory: {
        heapUsedMb:  Math.round(mem.heapUsed  / 1048576),
        heapTotalMb: Math.round(mem.heapTotal / 1048576),
        rssMb:       Math.round(mem.rss       / 1048576),
      },
      version: process.env.npm_package_version || '1.1.0',
    });
  } catch (err) {
    logger.error('[health] health check failed: %s', err.message);
    res.status(503).json({ status: 'error', error: err.message });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/admin/pin-login', strictAuthLimiter);
app.use('/api/users/me/daily-bonus', coinLimiter);
app.use('/api/users/me/ad-bonus', coinLimiter);
app.use('/api/users', usersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/shop/buy', coinLimiter);
app.use('/api/shop/verify-iap', coinLimiter);
app.use('/api/shop', shopRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/games', gamesRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/donations', donationsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/stickers/buy', coinLimiter);
app.use('/api/stickers', stickersRouter);
app.use('/api/support', supportRouter);
app.use('/api/admin/telegram', telegramAdminRouter);
app.use('/api/admin', adminRouter);
app.use('/api/baraban', barabanRouter);
app.use('/api/voice', voiceChatRouter);
app.use('/api/ai', aiRouter);
app.use('/api/production', productionRouter);
app.use('/api/admob', admobRouter);
app.use('/api/payments', paymentsRouter);

app.use(notFound);
// M3: Sentry error handler must come before custom errorHandler.
if (Sentry?.setupExpressErrorHandler) {
  Sentry.setupExpressErrorHandler(app);
}
app.use(errorHandler);

const httpServer = http.createServer(app);

async function start() {
  // PRO: setupSocket attaches Redis adapter (no-op if REDIS_URL unset).
  await setupSocket(httpServer);
  try {
    if (config.admin.email && config.admin.password) {
      try { await bootstrapAdmin(config.admin.email, config.admin.password); }
      catch (e) { logger.warn('admin bootstrap skipped:', e.message); }
    }
  } catch (e) {
    logger.warn('admin bootstrap failed:', e.message);
  }
  // TOR §3: seed the 100-bot global pool on first boot. Idempotent.
  try { await ensureBotPoolSeeded(); }
  catch (e) { logger.warn('bot_pool seed skipped:', e.message); }
  // TOR §6: seed the 100 fake donations so the leaderboard never looks empty.
  try { await ensureFakeDonationsSeeded(); }
  catch (e) { logger.warn('fake donations seed skipped:', e.message); }
  // Any game that is still open after a process restart no longer has an
  // in-memory room attached to it. Close it as a technical draw so admin
  // stats do not keep showing impossible "active" matches forever.
  try {
    const pool = await getPool();
    const r = await pool.query(
      `UPDATE games
          SET ended_at = now(),
              is_draw = TRUE,
              final_state = COALESCE(final_state, '{}'::jsonb)
                || jsonb_build_object('reason', 'server_restart', 'closedAt', now())
        WHERE ended_at IS NULL
        RETURNING room_code`
    );
    for (const row of r.rows) {
      logger.warn('orphaned active game closed after restart', { roomCode: row.room_code });
    }
  } catch (_) { /* ignore */ }
  httpServer.listen(config.port, () => {
    logger.info(`Durak Online backend on :${config.port} (${config.env})`);
    startTelegramBot();
  });
}

start().catch((err) => {
  logger.error('fatal startup error:', err);
  process.exit(1);
});

const shutdown = async () => {
  logger.info('shutting down...');
  stopTelegramBot();
  httpServer.close();
  await closeRedis().catch(() => {});
  try { const pool = await getPool(); await pool.end(); } catch (_) {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
