import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relPath) {
  return readFileSync(resolve(root, relPath), 'utf8');
}

function ok(label, condition, hint = '') {
  if (!condition) {
    console.error(`\n[shop-economy-audit] failed: ${label}`);
    if (hint) console.error(`[shop-economy-audit] ${hint}`);
    process.exit(1);
  }
  console.log(`[shop-economy-audit] ok: ${label}`);
}

console.log('[shop-economy-audit] Shop and balance contract checks');

const defaults = read('backend/src/services/economyDefaults.js');
const authService = read('backend/src/services/auth.js');
const googleAuth = read('backend/src/services/googleAuth.js');
const shopRoute = read('backend/src/routes/shop.js');
const stickersRoute = read('backend/src/routes/stickers.js');
const inventoryRoute = read('backend/src/routes/inventory.js');
const goldService = read('backend/src/services/goldCoins.js');
const shopPage = read('web-client/public/src/pages/shop.js');
const apiClient = read('web-client/public/src/api.js');
const releaseCheck = read('scripts/release-check.mjs');

ok('Starting Durak Dollar balance is 6000', defaults.includes('STARTING_PLAYER_COINS = 6000'));
ok('Starting Gold Coin balance remains 0', defaults.includes('STARTING_PLAYER_GOLD_COINS = 0'));
ok(
  'Latest migration sets users.coins default to 6000',
  existsSync(resolve(root, 'backend/migrations/025_starting_player_bonus_6000.sql'))
    && read('backend/migrations/025_starting_player_bonus_6000.sql').includes('ALTER COLUMN coins SET DEFAULT 6000'),
);
ok('Password registration uses starting balance constants', authService.includes('STARTING_PLAYER_COINS') && authService.includes('STARTING_PLAYER_GOLD_COINS'));
ok('Guest registration uses starting balance constants', (authService.match(/STARTING_PLAYER_COINS/g) || []).length >= 3);
ok('Google registration uses starting balance constants', googleAuth.includes('STARTING_PLAYER_COINS') && googleAuth.includes('STARTING_PLAYER_GOLD_COINS'));

const tabs = [
  ['featured', 'renderFeatured'],
  ['gold', 'renderGold'],
  ['dollars', 'renderDollars'],
  ['premium', 'renderPremium'],
  ['emoji', 'renderEmojiAndStickers'],
  ['cards', 'renderCardSkins'],
  ['stickers', 'renderStickers'],
  ['frames', 'renderProfileFrames'],
  ['donations', 'renderDonations'],
];

for (const [tab, renderFn] of tabs) {
  ok(`Shop tab exists: ${tab}`, shopPage.includes(`['${tab}'`) || shopPage.includes(`TAB === '${tab}'`));
  ok(`Shop tab renders section: ${tab}`, shopPage.includes(renderFn));
}

const frontendApiContracts = [
  ['Gold Coin purchase opens checkout', 'stripeCheckout(item.type, item.id'],
  ['Dollar exchange calls backend bundle route', 'api.buyDollarBundle(b.id)'],
  ['Premium purchase pays with Gold Coin', 'api.buyPremium(plan.id, true)'],
  ['Emoji pack purchase calls backend', 'api.buyPack(p.id)'],
  ['Card skin purchase calls backend', 'api.buySkin(s.id)'],
  ['Profile frame purchase calls backend', 'api.buyProfileFrame(f.id)'],
  ['Sticker pack purchase calls backend', 'api.stickerBuy(pack.id)'],
  ['Donation opens checkout only', "type: 'donation'"],
  ['Not enough Gold routes to Gold purchase', 'openNeedGold(root'],
];

for (const [label, needle] of frontendApiContracts) {
  ok(label, shopPage.includes(needle));
}

const apiRoutes = [
  ['api.buyDollarBundle', "request('POST', '/api/shop/buy/dollar-bundle'"],
  ['api.buyPremium', "request('POST', '/api/shop/buy/premium'"],
  ['api.buyPack', "request('POST', '/api/shop/buy/emoji-pack'"],
  ['api.buySkin', "request('POST', '/api/shop/buy/card-skin'"],
  ['api.buyProfileFrame', "request('POST', '/api/shop/buy/profile-frame'"],
  ['api.stickerBuy', "request('POST', '/api/stickers/buy'"],
  ['api.stripeCheckout', "request('POST', '/api/payments/create-checkout-session'"],
];

for (const [label, needle] of apiRoutes) {
  ok(`${label} points at expected route`, apiClient.includes(needle));
}

const backendPurchaseContracts = [
  ['Emoji purchase is atomic and debits Gold', shopRoute.includes("post('/buy/emoji-pack'") && shopRoute.includes('FOR UPDATE') && shopRoute.includes('gold_transactions') && shopRoute.includes("'emoji_pack'")],
  ['Card skin purchase is atomic and selects skin', shopRoute.includes("post('/buy/card-skin'") && shopRoute.includes('selected_skin') && shopRoute.includes("'card_skin'")],
  ['Profile frame purchase is atomic and selects frame', shopRoute.includes("post('/buy/profile-frame'") && shopRoute.includes('selected_avatar_frame') && shopRoute.includes("'avatar_frame'")],
  ['Dollar exchange is atomic with two ledgers', goldService.includes('convertGoldToDollars') && goldService.includes('UPDATE users SET gold_coins') && goldService.includes("'gold_convert'")],
  ['Premium cannot be granted free in production', shopRoute.includes("post('/buy/premium'") && shopRoute.includes('premium requires Gold Coin payment or a verified IAP receipt') && shopRoute.includes('changeGoldCoins')],
  ['Sticker purchase is atomic and debits Gold', stickersRoute.includes("post('/buy'") && stickersRoute.includes('FOR UPDATE') && stickersRoute.includes("'sticker_pack_buy'") && stickersRoute.includes("'sticker_pack'")],
  ['Inventory select skin never debits currency', inventoryRoute.includes("post('/me/select-skin'") && inventoryRoute.includes('skin not owned')],
  ['Inventory select frame never debits currency', inventoryRoute.includes("post('/me/select-avatar-frame'") && inventoryRoute.includes('frame not owned')],
  ['Legacy free money endpoints are production-gated', shopRoute.includes('ALLOW_DEV_PURCHASES') && shopRoute.includes('real purchases must go through /verify-iap')],
];

for (const [label, condition] of backendPurchaseContracts) {
  ok(label, condition);
}

ok('Release check runs this shop economy audit', releaseCheck.includes('scripts/audit-shop-economy.mjs'));

console.log('\n[shop-economy-audit] All shop and balance contract checks passed.');
