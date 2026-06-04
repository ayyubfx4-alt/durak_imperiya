export const API_BASE = import.meta.env.VITE_API_BASE
  || (typeof window !== 'undefined' && location.hostname === 'localhost' ? 'http://localhost:4000' : '');

export function getToken() { return localStorage.getItem('admin.token') || ''; }
export function setToken(token) { localStorage.setItem('admin.token', token || ''); }
export function clearToken() { localStorage.removeItem('admin.token'); }

function qs(params = {}) {
  const out = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') out.set(key, value);
  });
  const text = out.toString();
  return text ? `?${text}` : '';
}

async function request(method, path, body, options = {}) {
  const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...(options.headers || {}) };
  if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    cache: 'no-store',
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const isCsv = res.headers.get('content-type')?.includes('text/csv');
  const data = isCsv ? await res.text() : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) clearToken();
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const get = (path, params) => request('GET', `${path}${qs(params)}`);
const post = (path, body) => request('POST', path, body);
const put = (path, body) => request('PUT', path, body);
const del = (path) => request('DELETE', path);

export function assetUrl(url) {
  const text = String(url || '');
  if (!text) return '';
  if (/^(https?:|data:|blob:)/i.test(text)) return text;
  if (text.startsWith('/api/') && API_BASE) return `${API_BASE}${text}`;
  return text;
}

export const api = {
  pinLogin: (pin) => post('/api/admin/pin-login', { pin }),
  login: (username, password) => post('/api/admin/login', { username, password }),
  me: () => get('/api/admin/me'),
  changePassword: (data) => put('/api/admin/me/password', data),

  dashboardStats: () => get('/api/admin/dashboard/stats'),
  dashboardEvents: (limit = 50) => get('/api/admin/dashboard/events', { limit }),
  dashboardCharts: () => get('/api/admin/dashboard/charts'),
  stats: () => get('/api/admin/stats'),
  scalingMode: () => get('/api/admin/scaling'),
  uploadAsset: (data) => post('/api/admin/assets/upload', data),
  productionResetPreview: () => get('/api/admin/production/reset-preview'),
  productionReset: (data) => post('/api/admin/production/reset', data),

  users: (params) => get('/api/admin/users', params),
  userDetail: (id) => get(`/api/admin/users/${id}`),
  updateUser: (id, data) => put(`/api/admin/users/${id}`, data),
  banUser: (id, data) => post(`/api/admin/users/${id}/ban`, data),
  unbanUser: (id) => post(`/api/admin/users/${id}/unban`),
  muteUser: (id, data) => post(`/api/admin/users/${id}/mute`, data),
  unmuteUser: (id) => post(`/api/admin/users/${id}/unmute`, {}),
  grantPremium: (id, data) => post(`/api/admin/users/${id}/premium`, data),
  setUserRole: (id, role) => put(`/api/admin/users/${id}/role`, { role }),
  adjustCoins: (id, data) => post(`/api/admin/users/${id}/coins`, data),
  adjustGold: (id, data) => post(`/api/admin/users/${id}/gold`, data),
  deleteUser: (id) => del(`/api/admin/users/${id}`),
  resetPassword: (id) => post(`/api/admin/users/${id}/reset-password`, {}),
  userSessions: (id) => get(`/api/admin/users/${id}/sessions`),
  kickSessions: (id) => del(`/api/admin/users/${id}/sessions`),

  rooms: () => get('/api/admin/rooms'),
  roomDetail: (id) => get(`/api/admin/rooms/${encodeURIComponent(id)}`),
  closeRoom: (id) => del(`/api/admin/rooms/${encodeURIComponent(id)}`),
  cleanupRooms: () => post('/api/admin/rooms/cleanup-stale', {}),
  kickPlayer: (roomId, userId) => post(`/api/admin/rooms/${encodeURIComponent(roomId)}/kick/${encodeURIComponent(userId)}`, {}),
  gameHistory: (params) => get('/api/admin/games/history', params),
  gameStats: () => get('/api/admin/games/stats'),

  economyOverview: () => get('/api/admin/economy/overview'),
  economyTransactions: (params) => get('/api/admin/economy/transactions', params),
  economyAirdrop: (data) => post('/api/admin/economy/airdrop', data),
  shopStats: () => get('/api/admin/economy/shop-stats'),
  updatePrice: (data) => put('/api/admin/economy/prices', data),

  stickerStats: () => get('/api/admin/stickers/dashboard/stats'),
  stickers: (params) => get('/api/admin/stickers', params),
  createSticker: (data) => post('/api/admin/stickers', data),
  updateSticker: (id, data) => put(`/api/admin/stickers/${id}`, data),
  updateStickerPrices: (id, data) => request('PATCH', `/api/admin/stickers/${id}/prices`, data),
  deleteSticker: (id) => del(`/api/admin/stickers/${id}`),
  toggleSticker: (id) => post(`/api/admin/stickers/${id}/toggle`, {}),
  stickerOwners: (id) => get(`/api/admin/stickers/${id}/owners`),
  uploadStickerSvg: (data) => post('/api/admin/stickers/upload-svg', data),

  catalog: (kind, params) => get(`/api/admin/${kind}`, params),
  createCatalog: (kind, data) => post(`/api/admin/${kind}`, data),
  updateCatalog: (kind, id, data) => put(`/api/admin/${kind}/${encodeURIComponent(id)}`, data),
  deleteCatalog: (kind, id) => del(`/api/admin/${kind}/${encodeURIComponent(id)}`),
  toggleCatalog: (kind, id) => post(`/api/admin/${kind}/${encodeURIComponent(id)}/toggle`, {}),

  settings: () => get('/api/admin/settings'),
  saveFakeBots: (data) => put('/api/admin/settings/fake-bots', data),
  saveFakeDonations: (data) => put('/api/admin/settings/fake-donations', data),
  saveMaintenance: (data) => put('/api/admin/settings/maintenance', data),
  saveGameConfig: (data) => put('/api/admin/settings/game-config', data),
  saveAntibot: (data) => put('/api/admin/settings/antibot', data),

  leaderboard: async (params) => {
    const data = await get('/api/admin/ranking/leaderboard', params);
    return Array.isArray(data) ? data : (data.players || data.rows || []);
  },
  seasons: () => get('/api/admin/ranking/seasons'),
  createSeason: (data) => post('/api/admin/ranking/seasons', data),
  resetRanking: (confirmationToken) => post('/api/admin/ranking/reset', { confirmationToken }),
  rankDistribution: () => get('/api/admin/ranking/distribution'),

  broadcastHistory: () => get('/api/admin/messages/broadcast-history'),
  sendBroadcast: (data) => post('/api/admin/messages/broadcast', data),
  sendToUser: (data) => post('/api/admin/messages/send-to-user', data),
  inbox: () => get('/api/admin/messages/inbox'),
  markInboxRead: (id) => put(`/api/admin/messages/inbox/${id}/read`, {}),
  deleteInbox: (id) => del(`/api/admin/messages/inbox/${id}`),

  telegramStats: () => get('/api/admin/telegram/stats'),
  telegramHealth: () => get('/api/admin/telegram/health'),
  telegramUsers: (params) => get('/api/admin/telegram/users', params),
  telegramBroadcasts: () => get('/api/admin/telegram/broadcasts'),
  telegramEvents: (params) => get('/api/admin/telegram/events', params),
  telegramConfigure: () => post('/api/admin/telegram/configure', {}),
  telegramTestAdminMessage: (data) => post('/api/admin/telegram/test-admin-message', data),
  telegramBroadcast: (data) => post('/api/admin/telegram/broadcast', data),

  goldStats: () => get('/api/admin/gold/stats'),
  goldTransactions: (params) => get('/api/admin/gold/transactions', params),
  grantGold: (data) => post('/api/admin/gold/grant', data),

  shopItems: (params) => get('/api/admin/shop/items', params),
  updateShopItem: (id, data) => put(`/api/admin/shop/items/${encodeURIComponent(id)}`, data),
  toggleShopItem: (id) => post(`/api/admin/shop/items/${encodeURIComponent(id)}/toggle`, {}),
  shopPurchases: (params) => get('/api/admin/shop/purchases', params),

  tournaments: () => get('/api/admin/tournaments'),
  createTournament: (data) => post('/api/admin/tournaments', data),
  updateTournament: (id, data) => put(`/api/admin/tournaments/${id}`, data),
  cancelTournament: (id) => del(`/api/admin/tournaments/${id}`),
  startTournament: (id) => post(`/api/admin/tournaments/${id}/start`, {}),
  endTournament: (id) => post(`/api/admin/tournaments/${id}/end`, {}),
  tournamentBracket: (id) => get(`/api/admin/tournaments/${id}/bracket`),
  tournamentWinners: (id) => get(`/api/admin/tournaments/${id}/winners`),
  setTournamentWinners: (id, winners) => post(`/api/admin/tournaments/${id}/winners`, { winners }),
  disqualifyTournamentUser: (id, userId) => post(`/api/admin/tournaments/${id}/disqualify/${userId}`, {}),

  promotions: () => get('/api/admin/promotions'),
  createPromotion: (data) => post('/api/admin/promotions', data),
  updatePromotion: (id, data) => put(`/api/admin/promotions/${id}`, data),
  deletePromotion: (id) => del(`/api/admin/promotions/${id}`),
  generatePromotions: (data) => post('/api/admin/promotions/generate-bulk', data),

  revenueReport: () => get('/api/admin/reports/revenue'),
  retentionReport: () => get('/api/admin/reports/retention'),
  funnelReport: () => get('/api/admin/reports/funnel'),
  moderationReports: (params) => get('/api/admin/reports/moderation', params),
  exportReport: () => get('/api/admin/reports/export'),
  analyticsOverview: () => get('/api/admin/analytics/overview'),
  securityOverview: () => get('/api/admin/security/overview'),
  roles: () => get('/api/admin/roles'),
  updateRole: (role, permissions) => put(`/api/admin/roles/${encodeURIComponent(role)}`, { permissions }),
  backups: () => get('/api/admin/backups'),
  createDatabaseBackup: (data = {}) => post('/api/admin/backups/database', data),
  createSourceBackup: (data = {}) => post('/api/admin/backups/source', data),
  restoreBackup: (id) => post(`/api/admin/backups/${id}/restore`, {}),
  antibot: (category = 'all') => get('/api/admin/antibot', category && category !== 'all' ? { category } : {}),
  antibotClearUser: (id) => del(`/api/admin/antibot/${id}`),
  antibotDeleteUser: (id) => del(`/api/admin/antibot/${id}/user`),
  antibotBulkClear: (category) => del(`/api/admin/antibot${qs({ category })}`),
  antibotBulkDelete: (category) => del(`/api/admin/antibot${qs({ category, hardDelete: 1 })}`),
  audit: (params) => get('/api/admin/audit', params),

  supportStats: () => get('/api/support/admin/stats'),
  supportTickets: (params) => get('/api/support/admin/tickets', params),
  supportTicket: (id) => get(`/api/support/admin/tickets/${encodeURIComponent(id)}`),
  supportReply: (id, data) => post(`/api/support/admin/tickets/${encodeURIComponent(id)}/messages`, data),
  supportStatus: (id, data) => put(`/api/support/admin/tickets/${encodeURIComponent(id)}/status`, data),
  supportAssign: (id, data = {}) => post(`/api/support/admin/tickets/${encodeURIComponent(id)}/assign`, data),
};
