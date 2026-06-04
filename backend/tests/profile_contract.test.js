import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

test('profile frontend supports own and public profile routes', () => {
  const profile = read('web-client/public/src/pages/profile.js');
  assert.match(profile, /renderProfileV80\(root, params = \{\}\)/);
  assert.match(profile, /api\.profile\(profileId\)/);
  assert.match(profile, /publicProfile: true/);
  assert.match(profile, /publicProfile: false/);
});

test('profile buttons are wired to concrete actions', () => {
  const profile = read('web-client/public/src/pages/profile.js');
  assert.match(profile, /rpOpenReferralModal\(root\)/);
  assert.match(profile, /api\.referralTree\(\)/);
  assert.match(profile, /rpOpenStatsModal\(root, me/);
  assert.match(profile, /rpOpenEditProfileModal\(root\)/);
  assert.match(profile, /api\.setNickname\(nickname\)/);
  assert.match(profile, /api\.friendRequest\(userId\)/);
  assert.match(profile, /FEATURE_LOCKED/);
  assert.match(profile, /navigate\('friends'\)/);
});

test('profile payment modal uses the actual premium Gold Coin field', () => {
  const profile = read('web-client/public/src/pages/profile.js');
  assert.match(profile, /p\.priceGoldCoins \|\| p\.priceGold/);
  assert.match(profile, /api\.buyPremium\(item\.id, true\)/);
});

test('public profile backend returns safe display fields and rank', () => {
  const users = read('backend/src/routes/users.js');
  assert.match(users, /username, nickname, avatar_url, coins/);
  assert.match(users, /is_banned = FALSE/);
  assert.match(users, /is_admin IS NOT TRUE/);
  assert.match(users, /is_bot IS NOT TRUE/);
  assert.match(users, /global_rank/);
});

test('profile module cache bust is updated', () => {
  const main = read('web-client/public/src/main.js');
  assert.match(main, /profile\.js\?v=149-profile-polish/);
});
