function ts() {
  return new Date().toISOString();
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };
const configuredLevel = String(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info')).toLowerCase();
const activeLevel = LEVELS[configuredLevel] || LEVELS.info;
const enabled = (level) => activeLevel <= LEVELS[level];

export const logger = {
  info: (...args) => { if (enabled('info')) console.log(`[${ts()}] [info]`, ...args); },
  warn: (...args) => { if (enabled('warn')) console.warn(`[${ts()}] [warn]`, ...args); },
  error: (...args) => { if (enabled('error')) console.error(`[${ts()}] [error]`, ...args); },
  debug: (...args) => {
    if (process.env.DEBUG || enabled('debug')) console.log(`[${ts()}] [debug]`, ...args);
  },
};
