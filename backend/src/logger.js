/**
 * logger.js — Structured application logger.
 *
 * In production (NODE_ENV=production) every log line is a JSON object so
 * log aggregators (Datadog, Grafana Loki, CloudWatch) can parse fields.
 *
 * In development the same calls produce coloured human-readable text.
 *
 * Usage:
 *   import { logger } from './logger.js';
 *   logger.info('server started on port %d', port);
 *   logger.warn('[coins] insufficient balance userId=%s', userId);
 *   logger.error('[db] query error', err);
 *
 * Log levels (via LOG_LEVEL env, default: info in prod, debug in dev):
 *   debug < info < warn < error < silent
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const env        = process.env.NODE_ENV || 'development';
const isProd     = env === 'production';
const rawLevel   = String(process.env.LOG_LEVEL || (isProd ? 'info' : 'debug')).toLowerCase();
const activeLevel = LEVELS[rawLevel] ?? LEVELS.info;

// ── ANSI colours (dev only) ──────────────────────────────────────────────────
const RESET  = '\x1b[0m';
const C = { debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };

// Simple printf-style %s/%d/%o interpolation matching console.log behaviour.
function interpolate(parts) {
  if (!parts || parts.length === 0) return '';
  let [fmt, ...args] = parts;
  if (typeof fmt !== 'string') return parts.map(String).join(' ');
  let i = 0;
  const msg = fmt.replace(/%[sdoO]/g, (tok) => {
    const v = args[i++];
    if (v === undefined) return tok;
    if (tok === '%o' || tok === '%O') {
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  });
  // Append remaining unformatted args.
  const rest = args.slice(i).map((a) => {
    if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  });
  return rest.length > 0 ? `${msg} ${rest.join(' ')}` : msg;
}

function emit(level, parts) {
  if ((LEVELS[level] ?? 0) < activeLevel) return;

  const message = interpolate(parts);

  if (isProd) {
    // JSON line — one object per log entry; easy for log shippers to parse.
    const line = {
      ts:  new Date().toISOString(),
      lvl: level,
      pid: process.pid,
      msg: message,
    };
    // Surface Error objects as structured fields.
    for (const a of parts.slice(1)) {
      if (a instanceof Error) {
        line.errMessage = a.message;
        line.errStack   = a.stack;
        break;
      }
    }
    const out = JSON.stringify(line);
    if (level === 'error' || level === 'warn') process.stderr.write(out + '\n');
    else                                        process.stdout.write(out + '\n');
  } else {
    // Human-readable dev format.
    const ts    = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const label = (C[level] ?? '') + `[${level.toUpperCase()}]` + RESET;
    const text  = `${ts} ${label} ${message}`;
    if (level === 'error')      console.error(text);
    else if (level === 'warn')  console.warn(text);
    else                        console.log(text);
  }
}

export const logger = {
  debug:  (...args) => emit('debug',  args),
  info:   (...args) => emit('info',   args),
  warn:   (...args) => emit('warn',   args),
  error:  (...args) => emit('error',  args),
  /** Suppress all output (for test environments). */
  silent: () => {},
};

// ── Unhandled promise rejections & uncaught exceptions ───────────────────────
// Capture before the app even starts so nothing slips through.
// Sentry (if configured in index.js) will also capture these — we keep the
// logger call for environments without Sentry.
if (!process.listenerCount('unhandledRejection')) {
  process.on('unhandledRejection', (reason) => {
    logger.error('[process] unhandledRejection: %o', reason);
  });
}
if (!process.listenerCount('uncaughtException')) {
  process.on('uncaughtException', (err) => {
    console.error(err);
    logger.error('[process] uncaughtException:', err);
    // Let the process crash — PM2/Docker will restart it.
    process.exit(1);
  });
}
