import pg from 'pg';

const apiBase = String(process.env.API_BASE || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
const stamp = Date.now().toString(36);
const users = [];
let token = '';

function assertCheck(label, condition, details = '') {
  if (!condition) throw new Error(`[live-profile] failed: ${label}${details ? ` (${details})` : ''}`);
  console.log(`[live-profile] ok: ${label}`);
}

async function request(path, options = {}) {
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

async function register(suffix) {
  const username = `qa_profile_${stamp}_${suffix}`;
  const password = `Qa${stamp}${suffix}!pass`;
  const r = await request('/api/auth/register', {
    method: 'POST',
    body: { username, email: `${username}@durak.local`, password },
  });
  users.push(r.data.user.id);
  return r.data;
}

async function cleanup() {
  if (!pool) return;
  for (const id of users) await pool.query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
  await pool.end().catch(() => {});
}

try {
  console.log(`[live-profile] API ${apiBase}`);
  const first = await register('a');
  const second = await register('b');
  token = first.token;

  assertCheck('new profile user starts with 6000 dollars', Number(first.user.coins) === 6000);
  assertCheck('second profile user exists', !!second.user.id);

  const showcase = (await request('/api/users/me/showcase')).data;
  assertCheck('own showcase returns current user', showcase.user.id === first.user.id);
  assertCheck('own showcase has rewards', Array.isArray(showcase.rewards) && showcase.rewards.length > 0);
  assertCheck('own showcase has sticker collection', Array.isArray(showcase.stickers) && showcase.stickers.length > 0);
  assertCheck('own showcase has emoji collection', Array.isArray(showcase.emojiPacks) && showcase.emojiPacks.length > 0);

  const avatar = 'data:image/png;base64,iVBORw0KGgo=';
  const updated = (await request('/api/users/me/profile', {
    method: 'POST',
    body: { avatarUrl: avatar },
  })).data;
  assertCheck('profile avatar update is saved', updated.user.avatar_url === avatar);

  const newNick = `qaNick_${stamp.slice(-8)}`;
  const nick = (await request('/api/auth/nickname', {
    method: 'POST',
    body: { nickname: newNick },
  })).data;
  assertCheck('nickname update succeeds', nick.nickname === newNick);

  const settings = (await request('/api/users/me/settings', {
    method: 'POST',
    body: { settings: { pref_language: 'uz', pref_master_volume: 44, pref_sound: false, ignored_key: true } },
  })).data;
  assertCheck('profile settings sanitize and save language', settings.settings.pref_language === 'uz');
  assertCheck('profile settings sanitize and save volume', Number(settings.settings.pref_master_volume) === 44);
  assertCheck('profile settings drop unknown keys', settings.settings.ignored_key === undefined);

  const publicProfile = (await request(`/api/users/profile/${second.user.id}`)).data;
  assertCheck('public profile returns requested user', publicProfile.id === second.user.id);
  assertCheck('public profile includes nickname/display fields', publicProfile.username === second.user.username && 'avatar_url' in publicProfile);
  assertCheck('public profile includes rank', Number.isFinite(Number(publicProfile.global_rank || 0)));

  if (pool) {
    await pool.query('UPDATE users SET games_played = 5 WHERE id = $1', [first.user.id]);
  }
  const friend = (await request('/api/friends/request', {
    method: 'POST',
    body: { friendId: second.user.id },
  })).data;
  assertCheck('profile friend request action works', friend.ok === true || friend.status === 'pending');

  const invalidAvatar = await request('/api/users/me/profile', {
    method: 'POST',
    body: { avatarUrl: 'javascript:alert(1)' },
    allowError: true,
  });
  assertCheck('invalid avatar is rejected', invalidAvatar.status === 400);

  console.log('\n[live-profile] Live profile check passed.');
} finally {
  await cleanup();
}
