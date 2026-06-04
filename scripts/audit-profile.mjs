import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

function ok(label, condition, hint = '') {
  if (!condition) {
    console.error(`\n[profile-audit] failed: ${label}`);
    if (hint) console.error(`[profile-audit] ${hint}`);
    process.exit(1);
  }
  console.log(`[profile-audit] ok: ${label}`);
}

console.log('[profile-audit] Profile route and UI contract checks');

const profilePage = read('web-client/public/src/pages/profile.js');
const usersRoute = read('backend/src/routes/users.js');
const authRoute = read('backend/src/routes/auth.js');
const apiClient = read('web-client/public/src/api.js');
const mainJs = read('web-client/public/src/main.js');
const releaseCheck = read('scripts/release-check.mjs');

ok('Profile page accepts route params', profilePage.includes('renderProfileV80(root, params = {})'));
ok('Public profile route loads requested user id', profilePage.includes('api.profile(profileId)') && profilePage.includes('publicProfile: true'));
ok('Public profile does not replace current session user', profilePage.includes('state.user = data.user') && profilePage.includes('publicProfile: false'));
ok('Public profile has friend request action', profilePage.includes('rpRequestFriend(me.id)') && profilePage.includes('api.friendRequest(userId)'));
ok('Friend request locked state is explained', profilePage.includes("err?.data?.error === 'FEATURE_LOCKED'") && profilePage.includes("Do'stlar ${required} ta o'yindan keyin ochiladi"));
ok('Stats button opens real modal', profilePage.includes('rpOpenStatsModal(root, me'));
ok('Referral button opens real API modal', profilePage.includes('rpOpenReferralModal(root)') && profilePage.includes('api.referralTree()'));
ok('Edit profile opens nickname/avatar modal', profilePage.includes('rpOpenEditProfileModal(root)') && profilePage.includes('api.setNickname(nickname)') && profilePage.includes('rpOpenAvatarUpload(root)'));
ok('Profile chat button routes to friends instead of inert text', profilePage.includes("['💬', 'CHAT', () => navigate('friends')]"));
ok('Profile premium modal uses priceGoldCoins', profilePage.includes('p.priceGoldCoins || p.priceGold'));
ok('Profile module is cache-busted', mainJs.includes('profile.js?v=149-profile-polish'));

ok('API client exposes profile endpoints', apiClient.includes("profile: (id) => request('GET', `/api/users/profile/${id}`)") && apiClient.includes("profileShowcase: () => request('GET', '/api/users/me/showcase')"));
ok('API client exposes profile edit endpoints', apiClient.includes("updateProfile: (body) => request('POST', '/api/users/me/profile', body)") && apiClient.includes("setNickname: (nickname) => request('POST', '/api/auth/nickname'"));

ok('Public profile backend returns nickname and avatar', usersRoute.includes('username, nickname, avatar_url, coins'));
ok('Public profile backend filters banned/admin/bot rows', usersRoute.includes('is_banned = FALSE') && usersRoute.includes('is_admin IS NOT TRUE') && usersRoute.includes('is_bot IS NOT TRUE'));
ok('Public profile backend returns global rank', usersRoute.includes('global_rank') && usersRoute.includes('ROW_NUMBER() OVER'));
ok('Own profile showcase includes inventory collections', usersRoute.includes('stickers: STICKER_PACKS.map') && usersRoute.includes('emojiPacks: EMOJI_PACKS.slice'));
ok('Avatar update validates image input', usersRoute.includes("invalid avatar") && usersRoute.includes('data:image'));
ok('Nickname endpoint is authenticated', authRoute.includes("authRouter.post('/nickname', authRequired"));
ok('Release check runs this profile audit', releaseCheck.includes('scripts/audit-profile.mjs'));

console.log('\n[profile-audit] Profile checks passed.');
