import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressReward } from '../src/services/profileRewards.js';

test('progressReward marks first win reward unlocked and unclaimed', () => {
  const reward = {
    key: 'first_win_100k',
    title: 'Birinchi g‘alaba',
    metric: 'games_won',
    target: 1,
    rewardCoins: 100000,
  };

  assert.deepEqual(progressReward(reward, { games_won: 1 }, new Set()), {
    ...reward,
    current: 1,
    progress: 100,
    unlocked: true,
    claimed: false,
  });
});

test('progressReward clamps partial progress and uses claimed ledger keys', () => {
  const reward = {
    key: 'wins_10_gold',
    title: '10 g‘alaba',
    metric: 'games_won',
    target: 10,
    rewardCoins: 50000,
  };

  assert.deepEqual(progressReward(reward, { games_won: 4 }, new Set(['wins_10_gold'])), {
    ...reward,
    current: 4,
    progress: 40,
    unlocked: false,
    claimed: true,
  });
});
