import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function fail(message, hint = '') {
  console.error(`\n[ui-liveness] failed: ${message}`);
  if (hint) console.error(`[ui-liveness] ${hint}`);
  process.exit(1);
}

function ok(message) {
  console.log(`[ui-liveness] ok: ${message}`);
}

function assertContains(path, label, needles) {
  const source = read(path);
  const missing = needles.filter((needle) => !source.includes(needle));
  if (missing.length) {
    fail(label, `${path} missing: ${missing.join(', ')}`);
  }
  ok(label);
}

function assertSingleLiveRender(path, marker, label) {
  const source = read(path);
  const count = source.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length || 0;
  if (count !== 1) fail(label, `${path} has ${count} copies of ${marker}`);
  ok(label);
}

console.log('[ui-liveness] Project-wide live UI audit');

assertContains('web-client/public/src/pages/home.js', 'Home baraban countdown ticks and cleans up', [
  'baraban-time-value',
  'setInterval(updateCountdown, 1000)',
  'clearHomeLiveCleanups()',
  'Date.now() - receivedAt',
]);
assertSingleLiveRender(
  'web-client/public/src/pages/home.js',
  "return h('section', { class: 'dash-promo baraban'",
  'Home baraban has one live render path',
);

assertContains('web-client/public/src/pages/leaderboard.js', 'Leaderboard season countdown ticks and cleans up', [
  'rr-live-countdown',
  'liveDurationFromSeconds',
  'setInterval(update, 1000)',
  'clearLeaderboardLiveCleanups()',
]);

assertContains('web-client/public/src/pages/tournaments.js', 'Tournament start countdown ticks and cleans up', [
  'rt-live-countdown',
  'liveTimeUntil',
  'setInterval(update, 1000)',
  'clearTournamentLiveCleanups()',
]);

assertContains('web-client/public/src/pages/game.js', 'Game turn timer ticks and clears interval', [
  'timerInterval = setInterval(() =>',
  'view.turnDeadline - Date.now()',
  'clearInterval(timerInterval)',
]);

assertContains('web-client/public/src/realtime.js', 'Wallet/profile live refresh is wired globally', [
  'user:stats-dirty',
  "setInterval(() => heartbeat('poll'), POLL_MS)",
  'tournament_tickets',
]);

assertContains('web-client/public/src/main.js', 'Live countdown modules are cache-busted', [
  'home.js?v=146-live-countdown',
  'leaderboard.js?v=147-live-ui',
  'tournaments.js?v=147-live-ui',
]);

assertContains('web-client/public/index.html', 'Browser entrypoint cache is busted for live UI', [
  '/src/main.js?v=147-live-ui',
  '/styles.css?v=147-live-ui',
]);

console.log('[ui-liveness] Live UI checks passed.');
