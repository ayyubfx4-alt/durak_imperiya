// Unit tests covering the v4 TOR-specific additions: bet tier validation,
// 6-player table support, forfeit semantics, and the bot pool spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, forfeit, playAttack } from '../src/game/engine.js';
import { isValidBetTier, BET_TIERS, GOLD_BUNDLES, DOLLAR_BUNDLES, config } from '../src/config.js';
import { BOT_NAMES, buildBotPoolSpec } from '../src/data/botNames.js';
import { CARD_SKINS } from '../src/data/cardSkins.js';
import { computeRankFromWins, winsFromRank, RANK_COLORS, WINS_PER_COLOR } from '../src/services/rank.js';
import { isExclusiveItem, REFERRAL_GENERATIONS_FOR_EXCLUSIVE } from '../src/data/exclusiveItems.js';
import { MIN_DONATION_USD_CENTS } from '../src/services/donations.js';

test('bet tiers: min/max & sample values', () => {
  assert.equal(BET_TIERS[0], 100);
  assert.equal(BET_TIERS[BET_TIERS.length - 1], 1_000_000);
  assert.ok(isValidBetTier(100));
  assert.ok(isValidBetTier(2500));
  assert.ok(isValidBetTier(5000));
  assert.ok(isValidBetTier(1_000_000));
  assert.ok(!isValidBetTier(50));
  assert.ok(!isValidBetTier(105));
  assert.ok(!isValidBetTier(1_500_000));
});

test('config: TOR constants', () => {
  assert.equal(config.game.minBet, 100);
  assert.equal(config.game.maxBet, 1_000_000);
  assert.equal(config.game.adBonus, 800);
  // TOR §4.1: cap is 1 000 $ — users with a balance above this threshold
  // cannot claim ad bonuses.
  assert.equal(config.game.adBalanceCap, 1000);
  assert.equal(config.game.dailyBonus, 0);
  assert.deepEqual(config.game.allowedTableSizes, [2, 3, 4, 6]);
  assert.equal(config.game.tournament.entryGoldCoins, 35);
  assert.equal(config.game.tournament.prizeFirstGoldCoins, 150);
  assert.equal(config.game.elonStickerStakeThreshold, 1_000_000);
});

test('Gold Coin bundles match TOR §4.2', () => {
  assert.equal(GOLD_BUNDLES.length, 5);
  assert.deepEqual(GOLD_BUNDLES[0], { id: 'gold_55', goldCoins: 55, priceUsd: 1, dollarsEquiv: 10000 });
  assert.deepEqual(GOLD_BUNDLES[4], { id: 'gold_6800', goldCoins: 6800, priceUsd: 100, dollarsEquiv: 1236000 });
  assert.equal(DOLLAR_BUNDLES.length, GOLD_BUNDLES.length);
  assert.equal(DOLLAR_BUNDLES[0].dollars, 10000);
  assert.equal(DOLLAR_BUNDLES[0].costGoldCoins, 55);
});

test('bot pool spec: 100 distinct usernames with rank metadata', () => {
  assert.equal(BOT_NAMES.length, 100);
  assert.equal(new Set(BOT_NAMES).size, 100);
  const spec = buildBotPoolSpec();
  assert.equal(spec.length, 100);
  const ids = new Set(spec.map((b) => b.id));
  assert.equal(ids.size, 100);
  const colors = new Set(spec.map((b) => b.avatarColor));
  // TOR §8: rank ladder colours are white→gold→red→blue→pink→ink. Bots fill
  // the first five tiers; "ink" is reserved for human grinders.
  for (const c of ['white', 'gold', 'red', 'blue', 'pink']) {
    assert.ok(colors.has(c), `missing avatar color: ${c}`);
  }
});

test('engine: createGame accepts 6 players (with shrunk hand size)', () => {
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, username: `P${i}` }));
  const g = createGame({ players, stake: 100 });
  assert.equal(g.players.length, 6);
  // 6 players × 5 cards = 30, leaving 6 cards in the deck (including the
  // trump indicator).
  for (const p of g.players) assert.equal(p.hand.length, 5);
  assert.ok(g.trumpCard, 'trump card must exist for 6-player table');
  assert.equal(g.deck.length, 6);
});

test('engine: createGame rejects 5 players (not in TOR sizes)', () => {
  const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, username: `P${i}` }));
  assert.throws(() => createGame({ players, stake: 100 }), /one of 2, 3, 4, 6/);
});

test('engine.forfeit: marks forfeiter as durak and ends game (2 player)', () => {
  const g = createGame({
    players: [
      { id: 'a', username: 'A' },
      { id: 'b', username: 'B' },
    ],
    stake: 100,
  });
  const res = forfeit(g, 'a', 'turn_timeout');
  assert.equal(res.ok, true);
  assert.equal(res.ended, true);
  assert.equal(g.phase, 'ended');
  assert.equal(g.durakId, 'a');
  assert.deepEqual(g.winnerOrder, ['b']);
  assert.equal(g.players[0].out, true);
});

test('engine.forfeit: multi-player distributes winners (4 player)', () => {
  const g = createGame({
    players: [
      { id: 'a', username: 'A' },
      { id: 'b', username: 'B' },
      { id: 'c', username: 'C' },
      { id: 'd', username: 'D' },
    ],
    stake: 100,
  });
  forfeit(g, 'c', 'turn_timeout');
  assert.equal(g.phase, 'ended');
  assert.equal(g.durakId, 'c');
  // Winner order should include all three remaining players (c is the only
  // durak; a/b/d are winners that share the pot).
  assert.equal(g.winnerOrder.length, 3);
  assert.ok(!g.winnerOrder.includes('c'));
});

test('engine.forfeit: refuses a player who is already out', () => {
  const g = createGame({
    players: [
      { id: 'a', username: 'A' },
      { id: 'b', username: 'B' },
    ],
    stake: 100,
  });
  forfeit(g, 'a');
  const res = forfeit(g, 'a');
  assert.equal(res.ok, false);
});

test('engine.playAttack on ended game is a no-op', () => {
  const g = createGame({
    players: [
      { id: 'a', username: 'A' },
      { id: 'b', username: 'B' },
    ],
    stake: 100,
  });
  forfeit(g, 'b');
  const card = g.players[0].hand[0];
  const res = playAttack(g, 'a', card);
  assert.equal(res.ok, false);
});

test('donations: minimum is $0.50', () => {
  assert.equal(MIN_DONATION_USD_CENTS, 50);
});

test('rank: 0 wins → white / 0 / 0 / 0', () => {
  const r = computeRankFromWins(0);
  assert.equal(r.color, 'white');
  assert.equal(r.lines, 0);
  assert.equal(r.pluses, 0);
  assert.equal(r.progress, 0);
});

test('rank: 100 wins → white / 1 line / 0 + / 0 progress', () => {
  const r = computeRankFromWins(100);
  assert.equal(r.color, 'white');
  assert.equal(r.lines, 1);
  assert.equal(r.pluses, 0);
  assert.equal(r.progress, 0);
});

test('rank: 400 wins → white / 0 lines / 1 +', () => {
  const r = computeRankFromWins(400);
  assert.equal(r.color, 'white');
  assert.equal(r.lines, 0);
  assert.equal(r.pluses, 1);
  assert.equal(r.progress, 0);
});

test('rank: 1200 wins → gold / 0 / 0 / 0', () => {
  const r = computeRankFromWins(WINS_PER_COLOR);
  assert.equal(r.color, 'gold');
  assert.equal(r.lines, 0);
  assert.equal(r.pluses, 0);
});

test('rank: cap at ink colour', () => {
  const r = computeRankFromWins(WINS_PER_COLOR * 99);
  assert.equal(r.color, 'ink');
});

test('rank: winsFromRank is left-inverse below cap', () => {
  for (const n of [0, 1, 99, 100, 399, 400, 1199, 1200, 2500, 5999]) {
    assert.equal(winsFromRank(computeRankFromWins(n)), n);
  }
});

test('rank: RANK_COLORS matches TOR §8 order', () => {
  assert.deepEqual(RANK_COLORS, ['white', 'gold', 'red', 'blue', 'pink', 'ink']);
});

test('collection: 32-gen exclusive items are flagged', () => {
  assert.equal(REFERRAL_GENERATIONS_FOR_EXCLUSIVE, 32);
  assert.ok(isExclusiveItem('emoji_pack', 'pack_50'));
  assert.ok(!isExclusiveItem('card_skin', 'celestial'));
  assert.ok(!isExclusiveItem('emoji_pack', 'pack_01'));
  assert.ok(!isExclusiveItem('card_skin', 'default'));
});

test('card skins: curated 10-item premium catalog', () => {
  assert.equal(CARD_SKINS.length, 10);
  assert.equal(CARD_SKINS.filter((s) => s.collectionType === 'paid').length, 9);
  assert.equal(CARD_SKINS.filter((s) => s.collectionType === 'random').length, 0);
  assert.equal(CARD_SKINS[0].id, 'default');
  assert.ok(CARD_SKINS.find((s) => s.id === 'classic_gold' && s.priceCoins === 0 && s.collectionType === 'paid'));
  assert.ok(CARD_SKINS.find((s) => s.id === 'royal_queen' && s.collectionType === 'paid' && s.image));
  assert.ok(CARD_SKINS.every((s) => !s.premium));
});



