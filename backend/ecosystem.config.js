/**
 * ecosystem.config.js — PM2 application configuration.
 *
 * B2 FIX: Cluster mode with max CPU cores utilisation.
 *
 * Usage:
 *   Development (single process, auto-restart on file change):
 *     pm2 start ecosystem.config.js --env development
 *
 *   Production (all CPU cores, Redis adapter required for cross-instance comms):
 *     pm2 start ecosystem.config.js --env production
 *
 *   Monitor:
 *     pm2 monit
 *     pm2 logs durak-backend
 *
 * IMPORTANT: cluster mode + Socket.IO requires Redis adapter.
 *   Set REDIS_URL in your environment. Without it, Socket.IO events will
 *   not propagate across worker processes and game state will be inconsistent.
 *
 * Scaling guide:
 *   2 vCPU  → 2 workers  → ~8,000  concurrent Socket.IO connections
 *   4 vCPU  → 4 workers  → ~16,000 concurrent Socket.IO connections
 *   8 vCPU  → 8 workers  → ~32,000 concurrent Socket.IO connections
 */

module.exports = {
  apps: [
    {
      name: 'durak-backend',
      script: 'src/index.js',
      cwd: __dirname,

      // ── Cluster mode ────────────────────────────────────────────────────────
      // 'max' = one worker per logical CPU core.
      // Change to a specific integer (e.g. 2) if you need to reserve CPU
      // for PostgreSQL/Redis running on the same host.
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',

      // ── Node.js flags ───────────────────────────────────────────────────────
      node_args: [
        '--max-old-space-size=512',   // heap cap per worker (MB)
      ],

      // ── Restart policy ──────────────────────────────────────────────────────
      autorestart:          true,
      max_restarts:         10,
      min_uptime:           '10s',    // must stay up 10 s to count as "started"
      restart_delay:        2000,     // ms between restart attempts
      exp_backoff_restart_delay: 100, // exponential backoff on repeated crashes

      // Kill and re-spawn instead of waiting indefinitely.
      kill_timeout: 5000,
      listen_timeout: 8000,

      // ── Logging ─────────────────────────────────────────────────────────────
      // JSON structured logs in production — pipe to your aggregator.
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: '',  // logger.js adds its own timestamps

      // ── Env: development ────────────────────────────────────────────────────
      env: {
        NODE_ENV: 'development',
        PORT: 4000,
        LOG_LEVEL: 'debug',
        PM2_INSTANCES: '1',           // single worker in dev
      },

      // ── Env: production ─────────────────────────────────────────────────────
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        LOG_LEVEL: 'info',
        // DB_POOL_MAX should be reduced per-worker in cluster mode.
        // E.g. for 4 workers and PostgreSQL max_connections=100:
        //   DB_POOL_MAX = 20  (4 × 20 = 80, leaving 20 for admin tools)
        DB_POOL_MAX: '20',
        // REDIS_URL must be set externally — never hard-code credentials here.
        // export REDIS_URL=redis://:password@redis-host:6379
      },
    },
  ],
};
