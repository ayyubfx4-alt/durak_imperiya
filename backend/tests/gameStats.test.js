import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGameStats } from '../src/services/gameStats.js';
import { unlockedFromStats } from '../src/data/achievements.js';

test('calculateGameStats derives wins, losses, draws, and streaks', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const rows = [
    { loser_id: userId, is_draw: false },
    { loser_id: null, is_draw: true },
    { loser_id: '22222222-2222-2222-2222-222222222222', is_draw: false },
    { loser_id: userId, is_draw: false },
  ];

  assert.deepEqual(calculateGameStats(rows, userId), {
    gamesPlayed: 4,
    gamesWon: 1,
    gamesLost: 2,
    gamesDraw: 1,
    winStreak: 0,
    lossStreak: 1,
    rankWins: 1,
  });
});

test('unlockedFromStats includes total win achievement milestones', () => {
  const unlocked = unlockedFromStats({
    gamesWon: 150,
    gamesPlayed: 150,
    coins: 0,
    friends: 0,
    draws: 0,
    bluffsCaught: 0,
    winStreak: 0,
    lossStreak: 0,
  });
  assert.ok(unlocked.includes('wins_50'));
  assert.ok(unlocked.includes('wins_100'));
  assert.ok(unlocked.includes('wins_150'));
  assert.equal(unlocked.includes('wins_500'), false);
});
