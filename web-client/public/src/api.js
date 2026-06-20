// REST client for the backend.
//
// Resolution order:
//   1. Explicit runtime config (`window.__API_BASE__` / native-config.js).
//   2. Native shells fallback to the public game origin, never device localhost.
//   3. Browser localhost dev talks to Node :4000.
//   4. Production browser uses same-origin paths behind nginx.
const PUBLIC_GAME_ORIGIN = '';

function isNativeShell() {
  return !!(typeof window !== 'undefined'
    && window.Capacitor
    && window.Capacitor.isNativePlatform
    && window.Capacitor.isNativePlatform());
}

function configuredBase() {
  if (typeof window === 'undefined') return '';
  return String(window.__API_BASE__ || window.__DURAK_API_BASE__ || '').replace(/\/+$/, '');
}

const DEFAULT_BASE = configuredBase()
  || (isNativeShell() ? PUBLIC_GAME_ORIGIN : '')
  || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:4000' : '');

export const API_BASE = DEFAULT_BASE;

export function getToken() { return localStorage.getItem('durak.token') || ''; }
export function setToken(t) { localStorage.setItem('durak.token', t || ''); }
export function clearToken() { localStorage.removeItem('durak.token'); }

async function request(method, path, body) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
  };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const url = `${API_BASE}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      cache: 'no-store',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const out = new Error("Server bilan aloqa yo'q. Internetni tekshiring yoki ilovani qayta oching.");
    out.cause = err;
    out.status = 0;
    out.url = url;
    throw out;
  }
  if (res.status === 304) {
    const freshUrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
    return request(method, freshUrl.replace(API_BASE, ''), body);
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* ignore */ }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  // Generic request helpers (some pages use these directly).
  get:  (path) => request('GET',  path.startsWith('/api') ? path : `/api${path}`),
  post: (path, body) => request('POST', path.startsWith('/api') ? path : `/api${path}`, body),
  // Generic method for pages that need arbitrary HTTP verbs (e.g. baraban)
  request: (method, path, body) => request(method, path.startsWith('/api') ? path : `/api${path}`, body),

  guest: () => request('POST', '/api/auth/guest'),
  google: (idToken) => request('POST', '/api/auth/google', { idToken }),
  telegram: (initData) => request('POST', '/api/auth/telegram', { initData }),
  register: (body) => request('POST', '/api/auth/register', body),
  login: (body) => request('POST', '/api/auth/login', body),
  me: () => request('GET', '/api/auth/me'),
  progression: () => request('GET', '/api/users/me/progression'),
  checkNickname: (nick) => request('GET', `/api/auth/nickname/check?nick=${encodeURIComponent(nick)}`),
  setNickname: (nickname) => request('POST', '/api/auth/nickname', { nickname }),
  setLocale: (locale) => request('POST', '/api/auth/me/locale', { locale }),
  updateProfile: (body) => request('POST', '/api/users/me/profile', body),
  setCountry: (countryCode) => request('PATCH', '/api/users/me/country', { countryCode }),
  getSettings: () => request('GET', '/api/users/me/settings'),
  saveSettings: (settings) => request('POST', '/api/users/me/settings', { settings }),
  resetSettings: () => request('POST', '/api/users/me/settings/reset'),
  setSkin: (skin) => request('POST', '/api/auth/me/skin', { skin }),
  setBadges: (badges) => request('POST', '/api/auth/me/badges', { badges }),

  leaderboard: (sort = 'season', limit = 100) => request('GET', `/api/users/leaderboard?sort=${encodeURIComponent(sort)}&limit=${limit}`),
  countryLeaderboard: () => request('GET', '/api/users/countries/stats'),
  leaderboardOverview: () => request('GET', '/api/users/leaderboard/overview'),
  leaderboardMe: (sort = 'season') => request('GET', `/api/users/leaderboard/me?sort=${encodeURIComponent(sort)}`),
  profile: (id) => request('GET', `/api/users/profile/${id}`),
  profileShowcase: () => request('GET', '/api/users/me/showcase'),
  // Daily bonus is gone in v4; the server returns 410 if called. Kept here
  // for backward compatibility with older builds that still expose the
  // button — they get a graceful error instead of a 404.
  daily: () => request('POST', '/api/users/me/daily-bonus'),
  ad: (proof = {}) => request('POST', '/api/users/me/ad-bonus', proof),
  adBonus: (proof = {}) => request('POST', '/api/users/me/ad-bonus', proof),
  economy: () => request('GET', '/api/users/config/economy'),

  inventory: () => request('GET', '/api/inventory/me'),
  inventoryGrouped: () => request('GET', '/api/inventory/me/grouped'),
  cardCollection: () => request('GET', '/api/inventory/card-collection'),
  openCardBox: (boxType) => request('POST', '/api/inventory/card-collection/open-box', { boxType }),
  catalog: () => request('GET', '/api/inventory/catalog'),
  pack: (id) => request('GET', `/api/inventory/catalog/emoji-pack/${id}`),
  selectSkin: (skinId) => request('POST', '/api/inventory/me/select-skin', { skinId }),
  setBadgeShowcase: (badges) => request('POST', '/api/inventory/me/badges/showcase', { badges }),

  bundles: () => request('GET', '/api/shop/coin-bundles'),
  goldBundles: () => request('GET', '/api/shop/gold-bundles'),
  dollarBundles: () => request('GET', '/api/shop/dollar-bundles'),
  premiumTiers: () => request('GET', '/api/shop/premium-tiers'),
  buyPack: (packId) => request('POST', '/api/shop/buy/emoji-pack', { packId }),
  buySkin: (skinId) => request('POST', '/api/shop/buy/card-skin', { skinId }),
  buyProfileFrame: (frameId) => request('POST', '/api/shop/buy/profile-frame', { frameId }),
  selectProfileFrame: (frameId) => request('POST', '/api/inventory/me/select-avatar-frame', { frameId }),
  buyBundle: (bundleId) => request('POST', '/api/shop/buy/coin-bundle', { bundleId }),
  buyGoldBundle: (bundleId) => request('POST', '/api/shop/buy/gold-bundle', { bundleId }),
  buyDollarBundle: (bundleId) => request('POST', '/api/shop/buy/dollar-bundle', { bundleId }),
  // Alias: convert Gold Coins to Durak Dollars via a dollar bundle.
  convertGoldToDollars: (bundleId) => request('POST', '/api/shop/buy/dollar-bundle', { bundleId }),
  buyPremium: (tierId, payWithGold = false) => request('POST', '/api/shop/buy/premium', { tierId, payWithGold }),

  tournamentsList: () => request('GET', '/api/tournaments'),
  tournamentRegister: (id, payWith) => request('POST', `/api/tournaments/${id}/register`, payWith ? { payWith } : undefined),
  tournamentEntries: (id) => request('GET', `/api/tournaments/${id}/entries`),
  tournamentBracket: (id) => request('GET', `/api/tournaments/${id}/bracket`),
  tournamentMatchRoom: (id, matchId) => request('POST', `/api/tournaments/${id}/matches/${matchId}/room`),
  tournamentGift: (id, body) => request('POST', `/api/tournaments/${id}/gift`, body),
  tournamentHallOfFame: () => request('GET', '/api/tournaments/hall-of-fame'),
  tournamentOverview: () => request('GET', '/api/tournaments/overview'),

  aiUsage: () => request('GET', '/api/ai/usage'),
  aiConsume: () => request('POST', '/api/ai/consume'),

  donationsList: (limit = 100) => request('GET', `/api/donations?limit=${limit}`),
  donationsConfig: () => request('GET', '/api/donations/config'),
  donate: (amountUsdCents, message, displayName) => request('POST', '/api/donations', { amountUsdCents, message, displayName }),
  donationsUsersLeaderboard: () => request('GET', '/api/donations/leaderboard/users'),

  // PRO v5: Sticker pack endpoints
  stickerPacks: () => request('GET', '/api/stickers/packs'),
  stickerFree: () => request('GET', '/api/stickers/free'),
  stickerInventory: () => request('GET', '/api/stickers/me'),
  stickerBuy: (packId) => request('POST', '/api/stickers/buy', { packId }),
  stickerSend: (stickerId, roomCode) => request('POST', '/api/stickers/send', { stickerId, roomCode }),

  referralDepth: () => request('GET', '/api/users/me/referral-depth'),
  referralTree: () => request('GET', '/api/users/me/referral-tree'),

  friends: () => request('GET', '/api/friends/list'),
  roomInviteFriends: () => request('GET', '/api/friends/room-invite/list'),
  roomInviteSearch: (q) => request('GET', `/api/friends/room-invite/search?q=${encodeURIComponent(q)}`),
  friendsSearch: (q) => request('GET', `/api/friends/search?q=${encodeURIComponent(q)}`),
  friendRequest: (friendId) => request('POST', '/api/friends/request', { friendId }),
  friendAccept: (friendId) => request('POST', '/api/friends/accept', { friendId }),
  friendRemove: (friendId) => request('POST', '/api/friends/remove', { friendId }),
  giftSticker: (friendId, packId, message) => request('POST', '/api/friends/gift/sticker', { friendId, packId, message }),
  giftSkin: (friendId, skinId, message) => request('POST', '/api/friends/gift/skin', { friendId, skinId, message }),
  giftInbox: () => request('GET', '/api/friends/gifts/inbox'),
  friendMessagesUnread: () => request('GET', '/api/friends/messages/unread'),
  friendMessages: (friendId, limit = 80) => request('GET', `/api/friends/messages/${encodeURIComponent(friendId)}?limit=${encodeURIComponent(limit)}`),
  sendFriendMessage: (friendId, content) => request('POST', `/api/friends/messages/${encodeURIComponent(friendId)}`, { content }),

  reportSubmit: (body) => request('POST', '/api/reports', body),

  supportTickets: () => request('GET', '/api/support/tickets'),
  supportCreateTicket: (body) => request('POST', '/api/support/tickets', body),
  supportTicket: (id) => request('GET', `/api/support/tickets/${encodeURIComponent(id)}`),
  supportReply: (id, body) => request('POST', `/api/support/tickets/${encodeURIComponent(id)}/messages`, body),
  supportClose: (id) => request('POST', `/api/support/tickets/${encodeURIComponent(id)}/close`),

  recentGames: () => request('GET', '/api/games/me/recent'),
  myAchievements: () => request('GET', '/api/games/me/achievements'),

  paymentConfig: () => request('GET', '/api/payments/config'),
  stripeCheckout: (type, productId, extra = {}) => request('POST', '/api/payments/create-checkout-session', { type, productId, ...extra }),
  fulfillStripeCheckout: (sessionId) => request('POST', '/api/payments/checkout/fulfill', { sessionId }),
};
