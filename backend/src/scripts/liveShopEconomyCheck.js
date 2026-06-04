import pg from 'pg';

const apiBase = String(process.env.API_BASE || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const databaseUrl = process.env.DATABASE_URL;
const username = `qa_shop_${Date.now().toString(36)}`;
const password = `Qa${Date.now()}!pass`;
const email = `${username}@durak.local`;
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;

let token = '';
let userId = '';

function assertCheck(label, condition, details = '') {
  if (!condition) {
    throw new Error(`[live-shop-economy] failed: ${label}${details ? ` (${details})` : ''}`);
  }
  console.log(`[live-shop-economy] ok: ${label}`);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok && options.allowError !== true) {
    throw new Error(`${options.method || 'GET'} ${path} -> HTTP ${res.status}: ${data?.error || data?.message || 'no json'}`);
  }
  return { status: res.status, data };
}

async function setGold(goldCoins) {
  assertCheck('DATABASE_URL is available for live grant', !!pool);
  await pool.query('UPDATE users SET gold_coins = $1 WHERE id = $2', [goldCoins, userId]);
}

async function getMe() {
  return (await api('/api/auth/me')).data;
}

async function inventoryCount(itemType, itemId = null) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS qty
       FROM inventory
      WHERE user_id = $1 AND item_type = $2 AND ($3::text IS NULL OR item_id = $3::text)`,
    [userId, itemType, itemId]
  );
  return Number(r.rows[0]?.qty || 0);
}

async function cleanup() {
  if (!pool || !userId) return;
  await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  await pool.end().catch(() => {});
}

try {
  console.log(`[live-shop-economy] API ${apiBase}`);

  const register = await api('/api/auth/register', {
    method: 'POST',
    body: { username, email, password },
  });
  token = register.data.token;
  userId = register.data.user.id;
  assertCheck('new registration returns token and user id', !!token && !!userId);
  assertCheck('new registration receives 6000 Durak Dollars', Number(register.data.user.coins) === 6000, `coins=${register.data.user.coins}`);
  assertCheck('new registration receives 0 Gold Coin', Number(register.data.user.gold_coins) === 0, `gold=${register.data.user.gold_coins}`);

  let me = await getMe();
  assertCheck('/auth/me preserves 6000 Durak Dollars', Number(me.coins) === 6000, `coins=${me.coins}`);

  const [goldBundles, dollarBundles, premiumTiers, catalog, stickerPacks, donationConfig] = await Promise.all([
    api('/api/shop/gold-bundles').then((r) => r.data),
    api('/api/shop/dollar-bundles').then((r) => r.data),
    api('/api/shop/premium-tiers').then((r) => r.data),
    api('/api/inventory/catalog').then((r) => r.data),
    api('/api/stickers/packs').then((r) => r.data),
    api('/api/donations/config').then((r) => r.data),
  ]);
  assertCheck('Gold Coin bundles load', Array.isArray(goldBundles) && goldBundles.length >= 5);
  assertCheck('Dollar exchange bundles load', Array.isArray(dollarBundles) && dollarBundles.length >= 5);
  assertCheck('Premium tiers load', Array.isArray(premiumTiers) && premiumTiers.length >= 3);
  assertCheck('Catalog has emoji, cards and frames', catalog?.emojiPacks?.length && catalog?.cardSkins?.length && catalog?.profileFrames?.length);
  assertCheck('Sticker packs load', Array.isArray(stickerPacks) && stickerPacks.length >= 10);
  assertCheck('Donation config has minimum', Number(donationConfig?.minDonationUsdCents || 0) >= 50);

  const devGold = await api('/api/shop/buy/gold-bundle', {
    method: 'POST',
    body: { bundleId: goldBundles[0].id },
    allowError: true,
  });
  assertCheck('Gold bundle cannot credit without verified payment', devGold.status === 403);

  const noGoldExchange = await api('/api/shop/buy/dollar-bundle', {
    method: 'POST',
    body: { bundleId: dollarBundles[0].id },
    allowError: true,
  });
  assertCheck('Dollar exchange rejects insufficient Gold Coin', noGoldExchange.status === 400);

  await setGold(10000);
  me = await getMe();
  assertCheck('test account was granted Gold Coin for purchase audit', Number(me.gold_coins) === 10000);

  const firstDollar = dollarBundles[0];
  const exchange = await api('/api/shop/buy/dollar-bundle', {
    method: 'POST',
    body: { bundleId: firstDollar.id },
  });
  assertCheck('Dollar exchange awards exact Durak Dollars', Number(exchange.data.awarded) === Number(firstDollar.dollars));
  assertCheck('Dollar exchange debits exact Gold Coin', Number(exchange.data.goldCoins) === 10000 - Number(firstDollar.costGoldCoins));
  assertCheck('Dollar exchange returns exact total dollars', Number(exchange.data.coins) === 6000 + Number(firstDollar.dollars));

  const premium = premiumTiers.find((tier) => Number(tier.priceGoldCoins || 0) > 0) || premiumTiers[0];
  const beforePremium = Number(exchange.data.goldCoins);
  const premiumResult = await api('/api/shop/buy/premium', {
    method: 'POST',
    body: { tierId: premium.id, payWithGold: true },
  });
  assertCheck('Premium activates with Gold Coin', !!premiumResult.data.premium_until);
  assertCheck('Premium debits exact Gold Coin', Number(premiumResult.data.goldCoins) === beforePremium - Number(premium.priceGoldCoins || 0));

  const emoji = catalog.emojiPacks.find((pack) => !pack.premium && !pack.exclusive && Number(pack.priceGold || 0) > 0);
  const beforeEmoji = Number(premiumResult.data.goldCoins);
  const emojiResult = await api('/api/shop/buy/emoji-pack', {
    method: 'POST',
    body: { packId: emoji.id },
  });
  assertCheck('Emoji pack debits Gold Coin', Number(emojiResult.data.goldCoins) === beforeEmoji - Number(emoji.priceGold || 0));
  assertCheck('Emoji pack writes pack inventory', await inventoryCount('emoji_pack', emoji.id) >= 1);
  assertCheck('Emoji pack writes emoji inventory', await inventoryCount('emoji') >= 1);
  const emojiRepeat = await api('/api/shop/buy/emoji-pack', {
    method: 'POST',
    body: { packId: emoji.id },
  });
  assertCheck('Repeat emoji purchase does not charge again', emojiRepeat.data.alreadyOwned === true && Number(emojiRepeat.data.spentGold) === 0);

  const skin = catalog.cardSkins.find((item) => !item.premium && !item.exclusive && Number(item.priceGold || 0) > 0);
  const beforeSkin = Number(emojiResult.data.goldCoins);
  const skinResult = await api('/api/shop/buy/card-skin', {
    method: 'POST',
    body: { skinId: skin.id },
  });
  assertCheck('Card skin debits Gold Coin', Number(skinResult.data.goldCoins) === beforeSkin - Number(skin.priceGold || 0));
  assertCheck('Card skin writes inventory', await inventoryCount('card_skin', skin.id) >= 1);
  assertCheck('Card skin is selected', skinResult.data.selectedSkin === skin.id);
  const skinRepeat = await api('/api/shop/buy/card-skin', {
    method: 'POST',
    body: { skinId: skin.id },
  });
  assertCheck('Repeat card skin purchase only selects, no charge', skinRepeat.data.alreadyOwned === true && Number(skinRepeat.data.spentGold) === 0);

  const frame = catalog.profileFrames.find((item) => Number(item.priceGold || 0) > 0);
  const beforeFrame = Number(skinResult.data.goldCoins);
  const frameResult = await api('/api/shop/buy/profile-frame', {
    method: 'POST',
    body: { frameId: frame.id },
  });
  assertCheck('Profile frame debits Gold Coin', Number(frameResult.data.goldCoins) === beforeFrame - Number(frame.priceGold || 0));
  assertCheck('Profile frame writes inventory', await inventoryCount('avatar_frame', frame.id) >= 1);
  assertCheck('Profile frame is selected', frameResult.data.selectedAvatarFrame === frame.id);
  const frameRepeat = await api('/api/shop/buy/profile-frame', {
    method: 'POST',
    body: { frameId: frame.id },
  });
  assertCheck('Repeat profile frame purchase only selects, no charge', frameRepeat.data.alreadyOwned === true && Number(frameRepeat.data.spent) === 0);

  const sticker = stickerPacks.find((pack) => !pack.premium && Number(pack.priceGold || 0) > 0);
  const beforeSticker = Number(frameResult.data.goldCoins);
  const stickerResult = await api('/api/stickers/buy', {
    method: 'POST',
    body: { packId: sticker.id },
  });
  assertCheck('Sticker pack debits Gold Coin', Number(stickerResult.data.goldCoins) === beforeSticker - Number(sticker.priceGold || 0));
  assertCheck('Sticker pack writes inventory', await inventoryCount('sticker_pack', sticker.id) >= 1);
  const stickerRepeat = await api('/api/stickers/buy', {
    method: 'POST',
    body: { packId: sticker.id },
  });
  assertCheck('Repeat sticker purchase does not charge again', stickerRepeat.data.alreadyOwned === true && Number(stickerRepeat.data.spentGold) === 0);

  const goldBeforeSelect = Number(stickerResult.data.goldCoins);
  await api('/api/inventory/me/select-skin', { method: 'POST', body: { skinId: skin.id } });
  await api('/api/inventory/me/select-avatar-frame', { method: 'POST', body: { frameId: 'none' } });
  me = await getMe();
  assertCheck('Selecting owned cosmetics does not change Gold Coin', Number(me.gold_coins) === goldBeforeSelect);

  console.log('\n[live-shop-economy] Live shop economy check passed.');
} finally {
  await cleanup();
}
