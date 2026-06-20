import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { STARTING_PLAYER_COINS, STARTING_PLAYER_GOLD_COINS } from '../src/services/economyDefaults.js';
import { DOLLAR_BUNDLES, GOLD_BUNDLES } from '../src/config.js';
import { PROFILE_FRAMES } from '../src/data/profileFrames.js';
import { STICKER_PACKS } from '../src/data/stickerPacks.js';
import { EMOJI_PACKS } from '../src/data/emojiPacks.js';
import { CARD_SKINS } from '../src/data/cardSkins.js';

const root = resolve(import.meta.dirname, '..', '..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

test('new player economy starts with 6000 Durak Dollars and 0 Gold Coin', () => {
  assert.equal(STARTING_PLAYER_COINS, 6000);
  assert.equal(STARTING_PLAYER_GOLD_COINS, 0);
});

test('all new account paths use shared economy defaults', () => {
  const auth = read('backend/src/services/auth.js');
  const google = read('backend/src/services/googleAuth.js');
  assert.match(auth, /STARTING_PLAYER_COINS/);
  assert.match(auth, /STARTING_PLAYER_GOLD_COINS/);
  assert.match(google, /STARTING_PLAYER_COINS/);
  assert.match(google, /STARTING_PLAYER_GOLD_COINS/);
});

test('migration updates the database default for future users only', () => {
  const migration = resolve(root, 'backend/migrations/025_starting_player_bonus_6000.sql');
  assert.equal(existsSync(migration), true);
  const sql = readFileSync(migration, 'utf8');
  assert.match(sql, /ALTER TABLE users ALTER COLUMN coins SET DEFAULT 6000/);
  assert.match(sql, /Existing player balances are intentionally left untouched/);
});

test('dollar exchange bundles mirror paid Gold Coin bundles exactly', () => {
  assert.equal(DOLLAR_BUNDLES.length, GOLD_BUNDLES.length);
  for (const [index, gold] of GOLD_BUNDLES.entries()) {
    assert.deepEqual(DOLLAR_BUNDLES[index], {
      id: `dollars_${gold.dollarsEquiv}`,
      dollars: gold.dollarsEquiv,
      costGoldCoins: gold.goldCoins,
    });
  }
});

test('shop catalog items that are for sale have explicit Gold Coin prices', () => {
  assert.ok(EMOJI_PACKS.length > 20);
  assert.ok(EMOJI_PACKS.every((pack) => Number(pack.priceGold || 0) > 0));

  assert.ok(STICKER_PACKS.length > 20);
  assert.ok(STICKER_PACKS.some((pack) => pack.id === 'pack_starter' && pack.freeDefault && pack.forSale === false));
  assert.ok(STICKER_PACKS.filter((pack) => pack.forSale !== false).every((pack) => Number(pack.priceGold || 0) > 0));

  assert.ok(PROFILE_FRAMES.length > 0);
  assert.ok(PROFILE_FRAMES.every((frame) => Number(frame.priceGold || 0) > 0));

  const freeClassicGold = CARD_SKINS.find((skin) => skin.id === 'classic_gold');
  assert.ok(freeClassicGold && Number(freeClassicGold.priceCoins || 0) === 0);

  const paidSkins = CARD_SKINS.filter((skin) => skin.collectionType === 'paid' && skin.id !== 'classic_gold');
  assert.ok(paidSkins.length > 0);
  assert.ok(paidSkins.every((skin) => Number(skin.priceCoins || 0) > 0));
});

test('frontend shop buttons point at the backend money routes', () => {
  const shop = read('web-client/public/src/pages/shop.js');
  assert.match(shop, /api\.buyDollarBundle\(b\.id\)/);
  assert.match(shop, /api\.buyPremium\(plan\.id, true\)/);
  assert.match(shop, /api\.buyPack\(p\.id\)/);
  assert.match(shop, /api\.buySkin\(s\.id\)/);
  assert.match(shop, /api\.buyProfileFrame\(f\.id\)/);
  assert.match(shop, /api\.stickerBuy\(pack\.id\)/);
  assert.match(shop, /api\.stripeCheckout\(item\.type, item\.id/);
});
