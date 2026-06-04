import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCard } from '../src/game/deck.js';
import { createGame, playAttack, playDefense, transferAttack } from '../src/game/engine.js';
import { normalizeMatchmakerOptions } from '../src/game/matchmaker.js';
import { parseAdMobSsvQuery, isAllowedAdUnit } from '../src/services/admobSsv.js';
import { iapFingerprint } from '../src/services/iapIdempotency.js';
import {
  SOCKET_LIMITS,
  canPokeTurnTimeout,
  checkGameActionRateLimit,
  checkSocketPacketRateLimit,
  normalizeAllowedTableSize,
} from '../src/game/socketGuards.js';

test('deck parser rejects malformed card ids without throwing', () => {
  assert.equal(parseCard(null), null);
  assert.equal(parseCard(undefined), null);
  assert.equal(parseCard(''), null);
  assert.equal(parseCard('6X'), null);
  assert.equal(parseCard('10S'), null);
  assert.deepEqual(parseCard('AS'), { rank: 'A', suit: 'S', value: 14 });
});

test('engine actions return invalid card for malformed card payloads', () => {
  const game = createGame({ players: [{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }], transferEnabled: true });
  const attacker = game.players[game.attackerIdx];
  const defender = game.players[game.defenderIdx];
  const firstCard = attacker.hand[0];

  assert.doesNotThrow(() => playAttack(game, attacker.id, null));
  assert.deepEqual(playAttack(game, attacker.id, null), { ok: false, error: 'invalid card' });
  assert.equal(playAttack(game, attacker.id, firstCard).ok, true);
  assert.deepEqual(playDefense(game, defender.id, undefined), { ok: false, error: 'invalid card' });
  assert.deepEqual(transferAttack(game, defender.id, ''), { ok: false, error: 'invalid card' });
});

test('matchmaker table size normalization rejects unsupported 5-player queues', () => {
  assert.equal(normalizeAllowedTableSize(5), 2);
  assert.equal(normalizeAllowedTableSize('4'), 4);
  assert.equal(normalizeAllowedTableSize(6), 6);
  assert.equal(normalizeAllowedTableSize(undefined), 2);
  assert.equal(normalizeMatchmakerOptions({ maxPlayers: 5, stake: 100 }).maxPlayers, 2);
});

test('game action limiter blocks repeated calls below 100ms', () => {
  const socket = {};
  assert.deepEqual(checkGameActionRateLimit(socket, 1000), { ok: true });
  const limited = checkGameActionRateLimit(socket, 1050);
  assert.equal(limited.ok, false);
  assert.equal(limited.error, 'rate limited');
  assert.equal(limited.retryAfterMs, 50);
  assert.deepEqual(checkGameActionRateLimit(socket, 1100), { ok: true });
});

test('socket packet limiter blocks excessive event bursts in one window', () => {
  const socket = {};
  for (let i = 0; i < SOCKET_LIMITS.SOCKET_EVENT_MAX_PER_WINDOW; i += 1) {
    assert.equal(checkSocketPacketRateLimit(socket, 'game:action', 1000).ok, true);
  }
  const limited = checkSocketPacketRateLimit(socket, 'game:action', 1000);
  assert.equal(limited.ok, false);
  assert.equal(limited.error, 'rate limited');
  assert.equal(checkSocketPacketRateLimit(socket, 'game:action', 1000 + SOCKET_LIMITS.SOCKET_EVENT_WINDOW_MS).ok, true);
});

test('poke-timeout requires seated current player and an expired server deadline', () => {
  const room = {
    state: { phase: 'playing' },
    turnDeadline: 2000,
    seats: [{ id: 'a', isBot: false }, { id: 'b', isBot: false }],
    gameState: {
      phase: 'attacking',
      attackerIdx: 0,
      defenderIdx: 1,
      players: [{ id: 'a' }, { id: 'b' }],
    },
  };

  assert.equal(canPokeTurnTimeout(room, 'spectator', 2500).error, 'not seated');
  assert.equal(canPokeTurnTimeout(room, 'b', 2500).error, 'not your turn');
  assert.equal(canPokeTurnTimeout(room, 'a', 1500).error, 'turn not expired');
  assert.deepEqual(canPokeTurnTimeout(room, 'a', 2000), { ok: true, currentPlayerId: 'a' });

  room.gameState.phase = 'defending';
  assert.equal(canPokeTurnTimeout(room, 'a', 2500).error, 'not your turn');
  assert.deepEqual(canPokeTurnTimeout(room, 'b', 2500), { ok: true, currentPlayerId: 'b' });
});

test('IAP fingerprint is global per receipt, not per user or product', () => {
  const receipt = '{"purchaseToken":"same-real-purchase"}';
  assert.equal(iapFingerprint(receipt), iapFingerprint(receipt));
  assert.notEqual(iapFingerprint(receipt), iapFingerprint('another-receipt'));
});

test('AdMob SSV parser preserves signed content and extracts identity fields', () => {
  const raw = [
    'ad_network=5450213213286189855',
    'ad_unit=6099942544',
    'reward_amount=800',
    'reward_item=coins',
    'timestamp=1507770365237',
    'transaction_id=abc123',
    'user_id=11111111-1111-1111-1111-111111111111',
    'signature=MEUCIQDabc',
    'key_id=1234567890',
  ].join('&');
  const parsed = parseAdMobSsvQuery(raw);
  assert.equal(parsed.signedContent, raw.split('&signature=')[0]);
  assert.equal(parsed.transactionId, 'abc123');
  assert.equal(parsed.userId, '11111111-1111-1111-1111-111111111111');
  assert.equal(parsed.keyId, '1234567890');
  assert.equal(isAllowedAdUnit('6099942544'), true);
});

test('AdMob SSV parser rejects reordered signature params', () => {
  assert.throws(
    () => parseAdMobSsvQuery('transaction_id=x&key_id=1&signature=abc'),
    /key_id|required|signature/
  );
});
