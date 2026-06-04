import test from 'node:test';
import assert from 'node:assert/strict';
import { BARABAN_PRIZES, barabanPrizeWeightTotal } from '../src/services/baraban.js';

test('baraban reward table is a clean 100 percent contract', () => {
  assert.equal(barabanPrizeWeightTotal(), 100);
  assert.deepEqual(
    BARABAN_PRIZES
      .filter((prize) => prize.type === 'coins')
      .map((prize) => prize.amount),
    [50, 100, 250, 500, 1000]
  );
  assert.equal(BARABAN_PRIZES.find((prize) => prize.type === 'premium_day')?.weight, 1);
  assert.equal(BARABAN_PRIZES.find((prize) => prize.type === 'avatar_frame')?.weight, 2);
  assert.equal(BARABAN_PRIZES.find((prize) => prize.type === 'emoji_pack')?.weight, 3);
  assert.equal(BARABAN_PRIZES.find((prize) => prize.type === 'rank_points')?.amount, 25);
  assert.equal(BARABAN_PRIZES.find((prize) => prize.type === 'reroll')?.weight, 6);
  assert.equal(BARABAN_PRIZES.find((prize) => prize.type === 'empty')?.weight, 6);
});
