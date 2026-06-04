import { query } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

let polling = false;
let stopped = true;
let nextOffset = 0;
let webAppUrlWarningShown = false;
const adminSessions = new Map();

const BOT_COMMANDS = [
  { command: 'start', description: "O'yinni ochish" },
  { command: 'play', description: "Durak Imperia'ni boshlash" },
  { command: 'admin', description: 'Admin panel' },
];

const WELCOME_TEXT = [
  "Durak Imperia'ga xush kelibsiz.",
  '',
  "O'yinni bot ichida oching yoki Play Marketdan ilovani yuklab oling.",
].join('\n');

const HELP_TEXT = [
  "Durak Imperia yordam markazi",
  '',
  "/play - o'yinni ochish",
  "/admin - admin panel (faqat tasdiqlangan adminlarga ochiladi)",
  '',
  "Agar tugma ochilmasa, internetingizni tekshirib botni qayta oching.",
].join('\n');

const ADMIN_BUTTONS = {
  stats: 'Statistika',
  broadcast: 'Xabar yuborish',
  users: "O'yinchilar",
  economy: 'Hisob-kitob',
  tournaments: 'Turnirlar',
  reports: 'Shikoyatlar',
  bans: 'Ban nazorati',
  support: 'Support',
  settings: 'Bot sozlamalari',
  webAdmin: 'Sayt admin paneli',
};

function enabled() {
  return !!config.telegram.botToken;
}

function pollingAllowedHere() {
  if (!config.telegram.pollingEnabled) return false;
  const instanceId = process.env.INSTANCE_ID || '';
  return !instanceId || instanceId === config.telegram.pollingInstanceId;
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;
}

function normalizedUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).toString();
  } catch {
    return raw;
  }
}

function gameLaunchUrl() {
  return normalizedUrl(config.telegram.gameUrl);
}

function adminLaunchUrl() {
  return normalizedUrl(config.telegram.adminUrl);
}

function playMarketLaunchUrl() {
  return normalizedUrl(config.telegram.playMarketUrl);
}

function heroImageUrl() {
  const configured = normalizedUrl(config.telegram.heroImageUrl);
  if (configured) return configured;
  const base = gameLaunchUrl();
  try {
    return new URL('/images/durak-imperia-logo.jpg', base).toString();
  } catch {
    return '';
  }
}

function routeUrl(hashPath) {
  const base = gameLaunchUrl();
  try {
    const url = new URL(base);
    url.hash = hashPath;
    return url.toString();
  } catch {
    return base;
  }
}

function webAppInfoForUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return { url: parsed.toString() };
  } catch {
    return null;
  }
}

function telegramWebAppInfo() {
  return webAppInfoForUrl(gameLaunchUrl());
}

function telegramAdminWebAppInfo() {
  return webAppInfoForUrl(adminLaunchUrl());
}

function warnIfWebAppUnavailable() {
  if (webAppUrlWarningShown) return;
  webAppUrlWarningShown = true;
  const url = gameLaunchUrl();
  logger.warn('[telegram] TELEGRAM_GAME_URL must be an HTTPS URL to open as a Telegram WebApp; falling back to a regular URL button', {
    gameUrl: url || null,
  });
}

async function telegramApi(method, payload = {}) {
  if (!enabled()) throw new Error('telegram bot token is not configured');
  const res = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.description || `Telegram API ${res.status}`);
    err.status = data.error_code || res.status;
    err.telegram = data;
    throw err;
  }
  return data.result;
}

function linkButton(text, url, webApp = null) {
  if (webApp) return { text, web_app: webApp };
  if (url) return { text, url };
  return { text, callback_data: 'bot:help' };
}

function launchButton() {
  const webApp = telegramWebAppInfo();
  if (!webApp) warnIfWebAppUnavailable();
  return linkButton("O'yinni ochish", gameLaunchUrl(), webApp);
}

function playMarketButton() {
  return linkButton('Play Marketdan yuklash', playMarketLaunchUrl());
}

function adminPanelButton() {
  const webApp = telegramAdminWebAppInfo();
  const url = adminLaunchUrl();
  if (webApp || url) return linkButton('Sayt admin paneli', url, webApp);
  return { text: 'Admin panel sozlanmagan', callback_data: 'bot:admin_missing' };
}

function launchKeyboard() {
  const rows = [
    [launchButton()],
    [playMarketButton()],
  ];
  return { inline_keyboard: rows };
}

function adminKeyboard() {
  return {
    keyboard: [
      [ADMIN_BUTTONS.stats, ADMIN_BUTTONS.broadcast],
      [ADMIN_BUTTONS.users, ADMIN_BUTTONS.economy],
      [ADMIN_BUTTONS.tournaments, ADMIN_BUTTONS.reports],
      [ADMIN_BUTTONS.bans, ADMIN_BUTTONS.support],
      [ADMIN_BUTTONS.settings],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: 'Durak Imperia admin buyrugini tanlang',
  };
}

function adminInlineKeyboard() {
  return {
    inline_keyboard: [
      [adminPanelButton()],
    ],
  };
}

function ownerId() {
  return String(config.telegram.ownerId || '8324791195').trim();
}

function isTelegramAdmin(source) {
  const fromId = String(source?.from?.id || source?.message?.from?.id || source?.chat?.id || source?.message?.chat?.id || '').trim();
  return !!fromId && config.telegram.adminIds.includes(fromId);
}

function identityFrom(source) {
  const message = source?.message || source;
  const from = source?.from || message?.from || {};
  const chat = source?.message?.chat || message?.chat || {};
  return {
    telegramId: String(from.id || chat.id || '').trim(),
    chatId: String(chat.id || from.id || '').trim(),
    username: from.username || null,
    firstName: from.first_name || null,
    lastName: from.last_name || null,
    languageCode: from.language_code || null,
    text: String(message?.text || source?.data || '').trim(),
  };
}

function commandFromText(text) {
  const match = String(text || '').match(/^\/([a-z0-9_]+)(?:@\w+)?/i);
  return match ? match[1].toLowerCase() : null;
}

async function logTelegramEvent(eventType, source, payload = {}) {
  const identity = identityFrom(source);
  await query(
    `INSERT INTO telegram_bot_events (event_type, telegram_id, chat_id, payload)
     VALUES ($1, $2, $3, $4)`,
    [
      eventType,
      identity.telegramId || null,
      identity.chatId || null,
      {
        ...payload,
        username: identity.username,
        command: commandFromText(identity.text),
      },
    ]
  ).catch((err) => logger.warn('[telegram] event log skipped:', err.message));
}

async function upsertTelegramUser(source) {
  const identity = identityFrom(source);
  if (!identity.telegramId || !identity.chatId) return null;
  const command = commandFromText(identity.text);
  const r = await query(
    `INSERT INTO telegram_users
       (telegram_id, chat_id, username, first_name, last_name, language_code,
        is_active, is_admin, last_command, message_count, last_start_at, last_seen_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, 1, now(), now(), now())
     ON CONFLICT (telegram_id) DO UPDATE
       SET chat_id = EXCLUDED.chat_id,
           username = EXCLUDED.username,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           language_code = EXCLUDED.language_code,
           is_active = TRUE,
           is_admin = EXCLUDED.is_admin,
           last_command = COALESCE(EXCLUDED.last_command, telegram_users.last_command),
           message_count = COALESCE(telegram_users.message_count, 0) + 1,
           last_seen_at = now(),
           last_start_at = CASE WHEN EXCLUDED.last_command = 'start' THEN now() ELSE telegram_users.last_start_at END,
           updated_at = now()
     RETURNING id, telegram_id, chat_id, username, first_name, last_name, language_code,
               is_active, is_admin, last_command, message_count, last_seen_at, last_start_at, created_at`,
    [
      identity.telegramId,
      identity.chatId,
      identity.username,
      identity.firstName,
      identity.lastName,
      identity.languageCode,
      config.telegram.adminIds.includes(identity.telegramId),
      command,
    ]
  );
  return r.rows[0] || null;
}

export async function sendTelegramMessage(chatId, text, options = {}) {
  const payload = {
    chat_id: String(chatId),
    text: String(text || '').slice(0, 4096),
    disable_web_page_preview: true,
    ...options,
  };
  const result = await telegramApi('sendMessage', payload);
  await query(
    'UPDATE telegram_users SET last_message_at = now(), updated_at = now() WHERE chat_id = $1',
    [String(chatId)]
  ).catch(() => {});
  return result;
}

async function sendTelegramPhoto(chatId, photo, caption, options = {}) {
  const payload = {
    chat_id: String(chatId),
    photo,
    caption: String(caption || '').slice(0, 1024),
    ...options,
  };
  const result = await telegramApi('sendPhoto', payload);
  await query(
    'UPDATE telegram_users SET last_message_at = now(), updated_at = now() WHERE chat_id = $1',
    [String(chatId)]
  ).catch(() => {});
  return result;
}

async function sendTelegramVideo(chatId, video, caption, options = {}) {
  const payload = {
    chat_id: String(chatId),
    video,
    caption: String(caption || '').slice(0, 1024),
    supports_streaming: true,
    ...options,
  };
  const result = await telegramApi('sendVideo', payload);
  await query(
    'UPDATE telegram_users SET last_message_at = now(), updated_at = now() WHERE chat_id = $1',
    [String(chatId)]
  ).catch(() => {});
  return result;
}

async function sendHeroOrMessage(chatId, text, options = {}) {
  const photo = heroImageUrl();
  if (photo) {
    try {
      return await sendTelegramPhoto(chatId, photo, text, options);
    } catch (err) {
      logger.warn('[telegram] hero photo skipped:', err.message);
    }
  }
  return sendTelegramMessage(chatId, text, options);
}

async function sendStartMessage(message) {
  await upsertTelegramUser(message).catch((err) => {
    logger.warn('[telegram] user upsert skipped:', err.message);
  });
  await logTelegramEvent('start', message);
  await sendHeroOrMessage(
    message.chat.id,
    WELCOME_TEXT,
    { reply_markup: launchKeyboard() }
  );
}

async function sendHelpMessage(chatId, source = null) {
  if (source) await logTelegramEvent('help', source);
  await sendTelegramMessage(chatId, HELP_TEXT, { reply_markup: launchKeyboard() });
}

async function sendSupportMessage(chatId, source = null) {
  if (source) await logTelegramEvent('support', source);
  await sendTelegramMessage(
    chatId,
    [
      'Support:',
      '',
      "1. O'yin ichida Yordam yoki Shikoyat bo'limini oching.",
      '2. Muammoni qisqa va aniq yozing.',
      "3. Admin javobi o'yin ichida ko'rinadi.",
      '',
      "O'yinga qaytish uchun pastdagi tugmani bosing.",
    ].join('\n'),
    { reply_markup: launchKeyboard() }
  );
}

function fmtInt(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function adminText(chatId, lines, replyMarkup = adminKeyboard()) {
  return sendTelegramMessage(chatId, lines.filter((line) => line !== null && line !== undefined).join('\n'), {
    reply_markup: replyMarkup,
  });
}

async function adminProjectSnapshot() {
  const [users, games, online, banned, openSupport, activeTournaments] = await Promise.all([
    query("SELECT COUNT(*)::int AS total FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE").catch(() => ({ rows: [{ total: 0 }] })),
    query('SELECT COUNT(*)::int AS total FROM games').catch(() => ({ rows: [{ total: 0 }] })),
    query("SELECT COUNT(*)::int AS total FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE AND updated_at > now() - INTERVAL '5 minutes'").catch(() => ({ rows: [{ total: 0 }] })),
    query('SELECT COUNT(*)::int AS total FROM users WHERE is_banned = TRUE').catch(() => ({ rows: [{ total: 0 }] })),
    query("SELECT COUNT(*)::int AS total FROM support_tickets WHERE status IN ('open','pending','new')").catch(() => ({ rows: [{ total: 0 }] })),
    query("SELECT COUNT(*)::int AS total FROM tournaments WHERE status IN ('scheduled','open','running')").catch(() => ({ rows: [{ total: 0 }] })),
  ]);
  return {
    users: users.rows[0]?.total || 0,
    games: games.rows[0]?.total || 0,
    online: online.rows[0]?.total || 0,
    banned: banned.rows[0]?.total || 0,
    openSupport: openSupport.rows[0]?.total || 0,
    activeTournaments: activeTournaments.rows[0]?.total || 0,
  };
}

async function sendAdminStats(chatId, source = null) {
  if (source) await logTelegramEvent('admin_stats', source);
  const [tg, project] = await Promise.all([telegramStats(), adminProjectSnapshot()]);
  await adminText(chatId, [
    '📊 Durak Imperia statistikasi',
    '',
    `O'yinchilar: ${fmtInt(project.users)}`,
    `Online: ${fmtInt(project.online)}`,
    `O'yinlar: ${fmtInt(project.games)}`,
    `Aktiv turnirlar: ${fmtInt(project.activeTournaments)}`,
    `Ochiq support: ${fmtInt(project.openSupport)}`,
    `Banlanganlar: ${fmtInt(project.banned)}`,
    '',
    `Telegram userlar: ${fmtInt(tg.totalUsers)}`,
    `Telegram aktiv: ${fmtInt(tg.activeUsers)}`,
    `Telegram xabarlar: ${fmtInt(tg.messageCount)}`,
    `Bot: ${tg.bot?.username ? `@${tg.bot.username}` : tg.bot?.error || '-'}`,
  ]);
}

async function sendAdminTournaments(chatId, source = null) {
  if (source) await logTelegramEvent('admin_tournaments', source);
  const r = await query(
    `SELECT name, status, max_players, prize_coins, starts_at,
            (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id)::int AS entries
       FROM tournaments t
      ORDER BY starts_at DESC NULLS LAST, created_at DESC
      LIMIT 8`
  ).catch(() => ({ rows: [] }));
  const lines = [
    "Turnirlar nazorati",
    '',
    r.rows.length ? null : "Hozircha aktiv turnir topilmadi.",
    ...r.rows.map((row, index) => `${index + 1}. ${row.name || 'Turnir'} - ${row.status || '-'} | ${row.entries || 0}/${row.max_players || 0} | sovrin ${fmtInt(row.prize_coins)} GC`),
    '',
    "Turnir yaratish, bracket va sovrinlarni to'liq boshqarish sayt admin panelida.",
  ];
  await adminText(chatId, lines, adminInlineKeyboard());
}

async function sendAdminEconomy(chatId, source = null) {
  if (source) await logTelegramEvent('admin_economy', source);
  const [balances, txs] = await Promise.all([
    query(`SELECT
             COALESCE(SUM(coins), 0)::bigint AS total_coins,
             COALESCE(SUM(gold_coins), 0)::bigint AS total_gold,
             COALESCE(MAX(coins), 0)::bigint AS max_coins,
             COALESCE(MAX(gold_coins), 0)::bigint AS max_gold
           FROM users
          WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE`).catch(() => ({ rows: [{}] })),
    query(`SELECT
             (SELECT COUNT(*)::int FROM transactions) AS dollar_txs,
             (SELECT COUNT(*)::int FROM gold_transactions) AS gold_txs,
             (SELECT COUNT(*)::int FROM stripe_payments WHERE status = 'completed') AS paid_orders`).catch(() => ({ rows: [{}] })),
  ]);
  const b = balances.rows[0] || {};
  const t = txs.rows[0] || {};
  await adminText(chatId, [
    'Hisob-kitob nazorati',
    '',
    `Jami Durak Dollar: ${fmtInt(b.total_coins)}`,
    `Jami Gold Coin: ${fmtInt(b.total_gold)}`,
    `Eng katta Dollar balans: ${fmtInt(b.max_coins)}`,
    `Eng katta Gold balans: ${fmtInt(b.max_gold)}`,
    '',
    `Dollar ledger: ${fmtInt(t.dollar_txs)}`,
    `Gold ledger: ${fmtInt(t.gold_txs)}`,
    `Tasdiqlangan to'lovlar: ${fmtInt(t.paid_orders)}`,
    '',
    "Pul qo'shish/ayirish faqat sayt admin panelida audit bilan bajariladi.",
  ], adminInlineKeyboard());
}

async function sendAdminBanInfo(chatId, source = null) {
  if (source) await logTelegramEvent('admin_bans', source);
  const [banned, reports] = await Promise.all([
    query(`SELECT username, nickname, banned_reason, banned_until
             FROM users
            WHERE is_banned = TRUE
            ORDER BY updated_at DESC
            LIMIT 8`).catch(() => ({ rows: [] })),
    query(`SELECT COUNT(*)::int AS open
             FROM reports
            WHERE status = 'open'`).catch(() => ({ rows: [{ open: 0 }] })),
  ]);
  const rows = banned.rows.map((u, index) => {
    const name = u.nickname || u.username || 'user';
    const until = u.banned_until ? ` | ${new Date(u.banned_until).toISOString().slice(0, 10)}` : ' | permanent';
    return `${index + 1}. ${name}${until}`;
  });
  await adminText(chatId, [
    '🚫 Ban boshqaruvi',
    '',
    `Ochiq shikoyatlar: ${fmtInt(reports.rows[0]?.open || 0)}`,
    rows.length ? 'So‘nggi banlar:' : 'Hozir banlangan userlar topilmadi.',
    ...rows,
    '',
    "Ban berish/ochish va dalillarni ko'rish sayt admin panelida bajariladi.",
  ], adminInlineKeyboard());
}

async function sendAdminReports(chatId, source = null) {
  if (source) await logTelegramEvent('admin_reports', source);
  const r = await query(
    `SELECT r.reason, r.status, r.created_at,
            reporter.username AS reporter_name,
            reported.username AS reported_name
       FROM reports r
       LEFT JOIN users reporter ON reporter.id = r.reporter_id
       LEFT JOIN users reported ON reported.id = r.reported_id
      ORDER BY r.created_at DESC
      LIMIT 8`
  ).catch(() => ({ rows: [] }));
  await adminText(chatId, [
    'Shikoyatlar',
    '',
    r.rows.length ? null : "Hozircha shikoyat topilmadi.",
    ...r.rows.map((row, index) => {
      const from = row.reporter_name || 'user';
      const to = row.reported_name || 'user';
      return `${index + 1}. ${row.status || 'open'} | ${from} -> ${to} | ${row.reason || '-'}`;
    }),
    '',
    "Shikoyatni ko'rish, dalil va ban qarori sayt admin panelida.",
  ], adminInlineKeyboard());
}

async function sendAdminUsers(chatId, source = null) {
  if (source) await logTelegramEvent('admin_users', source);
  const [project, users] = await Promise.all([
    adminProjectSnapshot(),
    telegramUsers({ limit: 8 }),
  ]);
  const rows = users.map((u, index) => {
    const name = u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(' ') || u.telegram_id;
    const admin = u.is_admin ? ' admin' : '';
    return `${index + 1}. ${name}${admin} | xabar: ${fmtInt(u.message_count)}`;
  });
  await adminText(chatId, [
    '👥 Foydalanuvchilar',
    '',
    `O'yin userlari: ${fmtInt(project.users)}`,
    `Online: ${fmtInt(project.online)}`,
    `Telegram userlar: ${fmtInt(users.length)} ta oxirgi chat`,
    '',
    ...rows,
  ], adminInlineKeyboard());
}

async function sendAdminSupport(chatId, source = null) {
  if (source) await logTelegramEvent('admin_support', source);
  const r = await query(
    `SELECT subject, category, priority, status, unread_by_staff, last_message_at
       FROM support_tickets
      ORDER BY last_message_at DESC
      LIMIT 8`
  ).catch(() => ({ rows: [] }));
  await adminText(chatId, [
    'Support markazi',
    '',
    r.rows.length ? null : "Hozircha support murojaati topilmadi.",
    ...r.rows.map((row, index) => `${index + 1}. ${row.status || '-'} | ${row.priority || 'normal'} | ${row.category || 'game'} | ${row.subject || '-'}`),
    '',
    "Javob berish va ticket yopish sayt admin panelida bajariladi.",
  ], adminInlineKeyboard());
}

async function sendAdminSettings(chatId, source = null) {
  if (source) await logTelegramEvent('admin_settings', source);
  const health = await telegramBotHealth();
  await adminText(chatId, [
    'Bot sozlamalari',
    '',
    `Token: ${health.configured ? 'ulangan' : 'ulanmagan'}`,
    `Polling: ${health.pollingEnabled ? 'yoqilgan' : "o'chirilgan"}`,
    `Launch: ${health.launchMode}`,
    `Admin launch: ${health.adminLaunchMode}`,
    `Admin ID soni: ${health.adminIdsCount}`,
    `Admin guard: ${health.adminGuardOk ? 'OK' : 'xato'}`,
    `Play Market: ${health.playMarketUrl || '-'}`,
  ], adminInlineKeyboard());
}

async function sendAdminWebLink(chatId, source = null) {
  if (source) await logTelegramEvent('admin_web_link', source);
  await adminText(chatId, [
    'Sayt admin paneli',
    '',
    "To'liq boshqaruv sayt admin panelida ochiladi.",
  ], adminInlineKeyboard());
}

async function beginAdminBroadcast(chatId, source = null) {
  if (source) await logTelegramEvent('admin_broadcast_begin', source);
  adminSessions.set(String(chatId), { mode: 'broadcast_text', createdAt: Date.now() });
  await adminText(chatId, [
    'Hammaga xabar yuborish',
    '',
    "Keyingi yuborgan matn, rasm yoki video Telegram bot userlariga broadcast sifatida tayyorlanadi.",
    "Rasm/video caption bilan yuborilsa, caption ham birga ketadi.",
    "Yuborishdan oldin tasdiqlash oynasi chiqadi.",
    '',
    'Bekor qilish: /cancel',
  ]);
}

function broadcastConfirmKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Yuborish', callback_data: 'bot:broadcast_confirm' },
        { text: 'Bekor qilish', callback_data: 'bot:broadcast_cancel' },
      ],
    ],
  };
}

function bestPhotoFileId(photos = []) {
  const sorted = [...photos].filter((item) => item?.file_id).sort((a, b) => {
    const aSize = Number(a.file_size || 0);
    const bSize = Number(b.file_size || 0);
    if (aSize !== bSize) return bSize - aSize;
    const aArea = Number(a.width || 0) * Number(a.height || 0);
    const bArea = Number(b.width || 0) * Number(b.height || 0);
    return bArea - aArea;
  });
  return sorted[0]?.file_id || null;
}

function extractBroadcastPayload(message, text = '') {
  const body = String(text || message?.text || '').trim();
  const caption = String(message?.caption || '').trim();
  const photoFileId = bestPhotoFileId(message?.photo || []);
  if (photoFileId) {
    return { kind: 'photo', fileId: photoFileId, caption };
  }
  if (message?.video?.file_id) {
    return { kind: 'video', fileId: message.video.file_id, caption };
  }
  if (body) {
    return { kind: 'text', text: body };
  }
  return null;
}

function validateBroadcastPayload(payload) {
  const kind = payload?.kind;
  if (kind === 'text') {
    const text = String(payload.text || '').trim();
    if (text.length < 2) return 'message is required';
    if (text.length > 4096) return 'message is too long';
    return null;
  }
  if (kind === 'photo' || kind === 'video') {
    if (!payload.fileId) return `${kind} file id is required`;
    if (String(payload.caption || '').length > 1024) return 'caption is too long';
    return null;
  }
  return 'unsupported broadcast type';
}

function normalizeBroadcastPayload({ message, broadcast } = {}) {
  if (broadcast && typeof broadcast === 'object') {
    if (broadcast.kind === 'text') {
      return { kind: 'text', text: String(broadcast.text || broadcast.message || '').trim() };
    }
    if (broadcast.kind === 'photo' || broadcast.kind === 'video') {
      return {
        kind: broadcast.kind,
        fileId: String(broadcast.fileId || broadcast.file_id || '').trim(),
        caption: String(broadcast.caption || '').trim(),
      };
    }
  }
  return { kind: 'text', text: String(message || '').trim() };
}

function broadcastDbMessage(payload) {
  if (payload.kind === 'text') return payload.text;
  const caption = String(payload.caption || '').trim();
  return `[${payload.kind}]${caption ? ` ${caption}` : ''}`;
}

function broadcastMetadata(payload, errors) {
  const base = { type: payload.kind, errors: errors.slice(0, 25) };
  if (payload.kind === 'photo' || payload.kind === 'video') {
    base.file_id = payload.fileId;
    base.caption = payload.caption || '';
  }
  return base;
}

async function sendBroadcastPayload(chatId, payload, options = {}) {
  if (payload.kind === 'photo') {
    return sendTelegramPhoto(chatId, payload.fileId, payload.caption || '', options);
  }
  if (payload.kind === 'video') {
    return sendTelegramVideo(chatId, payload.fileId, payload.caption || '', options);
  }
  return sendTelegramMessage(chatId, payload.text, options);
}

async function sendBroadcastPreview(chatId, payload) {
  if (payload.kind === 'photo' || payload.kind === 'video') {
    await sendBroadcastPayload(chatId, payload);
    const label = payload.kind === 'photo' ? 'rasm' : 'video';
    await sendTelegramMessage(
      chatId,
      [
        'Broadcast preview',
        '',
        `Turi: ${label}`,
        `Caption: ${payload.caption ? payload.caption : '-'}`,
        '',
        'Shu xabar hammaga yuborilsinmi?',
      ].join('\n'),
      { reply_markup: broadcastConfirmKeyboard() }
    );
    return;
  }
  await sendTelegramMessage(
    chatId,
    [
      'Broadcast preview',
      '',
      payload.text,
      '',
      'Shu xabar hammaga yuborilsinmi?',
    ].join('\n'),
    { reply_markup: broadcastConfirmKeyboard() }
  );
}

async function handleAdminBroadcastMessage(message, text) {
  const chatId = String(message.chat.id);
  const session = adminSessions.get(chatId);
  if (!session || session.mode !== 'broadcast_text') return false;
  const payload = extractBroadcastPayload(message, text);
  if (!payload) {
    await sendTelegramMessage(chatId, 'Matn, rasm yoki video yuboring. Bekor qilish: /cancel', { reply_markup: adminKeyboard() });
    return true;
  }
  if (payload.kind === 'text' && payload.text.startsWith('/')) return false;
  const validationError = validateBroadcastPayload(payload);
  if (validationError === 'message is too long') {
    await sendTelegramMessage(chatId, 'Xabar juda uzun. 4096 belgidan oshmasin.', { reply_markup: adminKeyboard() });
    return true;
  }
  if (validationError === 'caption is too long') {
    await sendTelegramMessage(chatId, 'Caption juda uzun. Rasm/video caption 1024 belgidan oshmasin.', { reply_markup: adminKeyboard() });
    return true;
  }
  if (validationError) {
    await sendTelegramMessage(chatId, 'Bu turdagi xabar broadcast uchun qo‘llab-quvvatlanmaydi. Matn, rasm yoki video yuboring.', { reply_markup: adminKeyboard() });
    return true;
  }
  adminSessions.set(chatId, { ...session, mode: 'broadcast_confirm', broadcast: payload });
  await sendBroadcastPreview(chatId, payload);
  return true;
}

async function cancelAdminSession(chatId, source = null) {
  adminSessions.delete(String(chatId));
  if (source) await logTelegramEvent('admin_session_cancel', source);
  await sendTelegramMessage(chatId, 'Bekor qilindi.', { reply_markup: adminKeyboard() });
}

async function handleAdminPanelText(message, text) {
  if (!isTelegramAdmin(message)) return false;
  const chatId = message.chat.id;
  const clean = String(text || '').trim();
  if (/^\/cancel(?:@\w+)?(?:\s|$)/i.test(clean) || clean === 'Bekor qilish') {
    await cancelAdminSession(chatId, message);
    return true;
  }
  if (await handleAdminBroadcastMessage(message, clean)) return true;

  switch (clean) {
    case ADMIN_BUTTONS.stats:
      await sendAdminStats(chatId, message);
      return true;
    case ADMIN_BUTTONS.broadcast:
      await beginAdminBroadcast(chatId, message);
      return true;
    case ADMIN_BUTTONS.users:
      await sendAdminUsers(chatId, message);
      return true;
    case ADMIN_BUTTONS.economy:
      await sendAdminEconomy(chatId, message);
      return true;
    case ADMIN_BUTTONS.tournaments:
      await sendAdminTournaments(chatId, message);
      return true;
    case ADMIN_BUTTONS.reports:
      await sendAdminReports(chatId, message);
      return true;
    case ADMIN_BUTTONS.bans:
      await sendAdminBanInfo(chatId, message);
      return true;
    case ADMIN_BUTTONS.support:
      await sendAdminSupport(chatId, message);
      return true;
    case ADMIN_BUTTONS.settings:
      await sendAdminSettings(chatId, message);
      return true;
    case ADMIN_BUTTONS.webAdmin:
      await sendAdminWebLink(chatId, message);
      return true;
    default:
      return false;
  }
}

async function sendAdminMessage(messageOrCallback) {
  const message = messageOrCallback?.message || messageOrCallback;
  await upsertTelegramUser(messageOrCallback).catch((err) => {
    logger.warn('[telegram] user upsert skipped:', err.message);
  });
  if (!isTelegramAdmin(messageOrCallback)) {
    await logTelegramEvent('admin_denied', messageOrCallback);
    await sendTelegramMessage(message.chat.id, 'Bu buyruq faqat tasdiqlangan Durak Imperia adminlari uchun.');
    return;
  }

  await logTelegramEvent('admin_open', messageOrCallback);
  const webApp = telegramAdminWebAppInfo();
  if (!webApp && !adminLaunchUrl()) {
    logger.warn('[telegram] TELEGRAM_ADMIN_URL is not configured', { adminUrl: adminLaunchUrl() || null });
  }
  await sendTelegramMessage(message.chat.id, 'Admin panel:', { reply_markup: adminInlineKeyboard() });
  await sendTelegramMessage(
    message.chat.id,
    [
      'Durak Imperia admin markazi',
      '',
      "Pastdagi tugmalar orqali o'yin statistikasi, xabar yuborish, o'yinchilar, hisob-kitob, turnir, shikoyat, ban va support nazorati ishlaydi.",
    ].join('\n'),
    { reply_markup: adminKeyboard() }
  );
}

async function answerCallback(callbackQuery, text = '') {
  await telegramApi('answerCallbackQuery', {
    callback_query_id: callbackQuery.id,
    text,
    show_alert: false,
  }).catch((err) => logger.warn('[telegram] callback answer skipped:', err.message));
}

async function handleCallback(callbackQuery) {
  const chatId = callbackQuery?.message?.chat?.id;
  if (!chatId) return;
  await upsertTelegramUser(callbackQuery).catch((err) => {
    logger.warn('[telegram] callback user upsert skipped:', err.message);
  });
  const data = String(callbackQuery.data || '');
  if (data === 'bot:help') {
    await answerCallback(callbackQuery);
    await sendHelpMessage(chatId, callbackQuery);
    return;
  }
  if (data === 'bot:support') {
    await answerCallback(callbackQuery);
    await sendSupportMessage(chatId, callbackQuery);
    return;
  }
  if (data === 'bot:broadcast_cancel') {
    await answerCallback(callbackQuery, 'Bekor qilindi');
    await cancelAdminSession(chatId, callbackQuery);
    return;
  }
  if (data === 'bot:broadcast_confirm') {
    if (!isTelegramAdmin(callbackQuery)) {
      await answerCallback(callbackQuery, 'Ruxsat yoq');
      return;
    }
    const session = adminSessions.get(String(chatId));
    const broadcast = session?.broadcast || (session?.message ? { kind: 'text', text: session.message } : null);
    if (!broadcast) {
      await answerCallback(callbackQuery, 'Xabar topilmadi');
      await sendTelegramMessage(chatId, 'Broadcast xabari topilmadi. Qaytadan urinib ko‘ring.', { reply_markup: adminKeyboard() });
      return;
    }
    await answerCallback(callbackQuery, 'Yuborilmoqda');
    const result = await sendTelegramBroadcast({ broadcast, adminId: null });
    adminSessions.delete(String(chatId));
    await logTelegramEvent('admin_broadcast_sent', callbackQuery, {
      broadcastId: result.id,
      sent: result.sent_count,
      failed: result.failed_count,
    });
    await sendTelegramMessage(
      chatId,
      [
        'Broadcast yakunlandi',
        '',
        `Yuborildi: ${fmtInt(result.sent_count)}`,
        `Xato: ${fmtInt(result.failed_count)}`,
        `Faolsiz: ${fmtInt(result.inactive_count)}`,
      ].join('\n'),
      { reply_markup: adminKeyboard() }
    );
    return;
  }
  if (data === 'bot:admin_status') {
    await answerCallback(callbackQuery, isTelegramAdmin(callbackQuery) ? 'Bot holati yuborildi' : 'Ruxsat yoq');
    if (isTelegramAdmin(callbackQuery)) {
      const stats = await telegramStats();
      await sendTelegramMessage(
        chatId,
        [
          'Telegram bot holati',
          '',
          `Token: ${stats.configured ? 'ulangan' : 'ulanmagan'}`,
          `Bot: ${stats.bot?.username ? `@${stats.bot.username}` : stats.bot?.error || '-'}`,
          `Launch: ${stats.launchMode}`,
          `Admin launch: ${stats.adminLaunchMode}`,
          `Aktiv chatlar: ${stats.activeUsers}`,
        ].join('\n'),
        { reply_markup: adminInlineKeyboard() }
      );
    }
    return;
  }
  if (data === 'bot:admin_missing') {
    await answerCallback(callbackQuery, 'Admin URL server env orqali sozlanadi');
    return;
  }
  await answerCallback(callbackQuery);
}

async function handleUpdate(update) {
  if (update?.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const message = update?.message;
  if (!message?.chat?.id) return;
  const text = String(message.text || '').trim();
  await upsertTelegramUser(message).catch((err) => {
    logger.warn('[telegram] user upsert skipped:', err.message);
  });

  if (/^\/admin(?:@\w+)?(?:\s|$)/i.test(text)) {
    await sendAdminMessage(message);
    return;
  }
  if (/^\/(?:start|play)(?:@\w+)?(?:\s|$)/i.test(text)) {
    await sendStartMessage(message);
    return;
  }
  if (/^\/help(?:@\w+)?(?:\s|$)/i.test(text)) {
    await sendHelpMessage(message.chat.id, message);
    return;
  }
  if (/^\/support(?:@\w+)?(?:\s|$)/i.test(text)) {
    await sendSupportMessage(message.chat.id, message);
    return;
  }
  if (await handleAdminPanelText(message, text)) {
    return;
  }

  await logTelegramEvent('message', message);
  await sendTelegramMessage(
    message.chat.id,
    "O'yinga kirish yoki yordam olish uchun pastdagi tugmalardan foydalaning.",
    { reply_markup: launchKeyboard() }
  );
}

async function pollOnce() {
  const updates = await telegramApi('getUpdates', {
    offset: nextOffset || undefined,
    timeout: 25,
    allowed_updates: ['message', 'callback_query'],
  });
  for (const update of updates || []) {
    nextOffset = Math.max(nextOffset, Number(update.update_id || 0) + 1);
    try {
      await handleUpdate(update);
    } catch (err) {
      logger.warn('[telegram] update skipped:', err.message);
    }
  }
}

async function pollLoop() {
  if (polling || stopped || !enabled() || !pollingAllowedHere()) return;
  polling = true;
  try {
    await pollOnce();
  } catch (err) {
    logger.warn('[telegram] polling error:', err.message);
  } finally {
    polling = false;
    if (!stopped && enabled()) setTimeout(pollLoop, 1500);
  }
}

async function preparePolling() {
  await telegramApi('deleteWebhook', {
    drop_pending_updates: !!config.telegram.dropPendingUpdates,
  });
}

async function bestEffort(name, fn) {
  try {
    await fn();
    return { name, ok: true };
  } catch (err) {
    logger.warn(`[telegram] ${name} skipped:`, err.message);
    return { name, ok: false, error: err.message };
  }
}

export async function configureTelegramBot() {
  if (!enabled()) {
    const err = new Error('telegram bot token is not configured');
    err.status = 503;
    throw err;
  }
  return Promise.all([
    bestEffort('setMyName', () => telegramApi('setMyName', { name: 'Durak Imperia' })),
    bestEffort('setMyShortDescription', () => telegramApi('setMyShortDescription', { short_description: 'Premium online Durak karta oyini' })),
    bestEffort('setMyDescription', () => telegramApi('setMyDescription', { description: "Durak Imperia - mobil ilova bilan sinxron Telegram platforma: o'yin, do'kon, turnir, reyting, Play Market havolasi va admin panel." })),
    bestEffort('setMyCommands', () => telegramApi('setMyCommands', { commands: BOT_COMMANDS })),
    bestEffort('setChatMenuButton', async () => {
      const webApp = telegramWebAppInfo();
      if (!webApp) {
        warnIfWebAppUnavailable();
        return;
      }
      await telegramApi('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: 'Durak Imperia',
          web_app: webApp,
        },
      });
    }),
  ]);
}

export function startTelegramBot() {
  if (!enabled()) {
    logger.info('[telegram] TELEGRAM_BOT_TOKEN is not configured; bot polling disabled');
    return;
  }
  if (!pollingAllowedHere()) {
    logger.info('[telegram] bot polling disabled on this instance', {
      instanceId: process.env.INSTANCE_ID || null,
      pollingInstanceId: config.telegram.pollingInstanceId,
    });
    return;
  }
  stopped = false;
  logger.info('[telegram] bot polling enabled');
  preparePolling()
    .catch((err) => logger.warn('[telegram] webhook cleanup skipped:', err.message))
    .then(() => configureTelegramBot())
    .catch((err) => logger.warn('[telegram] launch menu setup skipped:', err.message))
    .finally(() => pollLoop());
}

export function stopTelegramBot() {
  stopped = true;
}

export async function telegramBotHealth() {
  const base = {
    configured: enabled(),
    pollingEnabled: config.telegram.pollingEnabled,
    pollingAllowedHere: pollingAllowedHere(),
    pollingInstanceId: config.telegram.pollingInstanceId,
    gameUrl: config.telegram.gameUrl,
    adminUrl: config.telegram.adminUrl || null,
    heroImageUrl: heroImageUrl() || null,
    playMarketUrl: playMarketLaunchUrl() || null,
    starsEnabled: config.telegram.starsEnabled,
    starsCurrency: config.telegram.starsCurrency,
    launchMode: telegramWebAppInfo() ? 'web_app' : 'url',
    adminLaunchMode: telegramAdminWebAppInfo() ? 'web_app' : (adminLaunchUrl() ? 'url' : 'missing'),
    ownerId: ownerId(),
    adminIdsCount: config.telegram.adminIds.length,
    adminGuardOk: config.telegram.adminIds.includes(ownerId()) && config.telegram.adminIds.every((id) => /^\d+$/.test(id)),
    ownerOnly: config.telegram.adminIds.length === 1 && config.telegram.adminIds[0] === ownerId(),
  };
  if (!enabled()) return { ...base, ok: false, bot: null };
  try {
    const bot = await telegramApi('getMe');
    return {
      ...base,
      ok: true,
      bot: {
        id: bot.id,
        username: bot.username,
        first_name: bot.first_name,
        can_join_groups: bot.can_join_groups,
        supports_inline_queries: bot.supports_inline_queries,
      },
    };
  } catch (err) {
    return { ...base, ok: false, bot: { error: err.message, status: err.status || null } };
  }
}

export async function telegramStats() {
  const [counts, lastUsers, lastBroadcast, lastEvents, health] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_active)::int AS active,
              COUNT(*) FILTER (WHERE NOT is_active)::int AS inactive,
              COUNT(*) FILTER (WHERE is_admin)::int AS admins,
              COALESCE(SUM(message_count), 0)::int AS message_count
         FROM telegram_users`
    ),
    query(
      `SELECT telegram_id, chat_id, username, first_name, last_name, language_code,
              is_active, is_admin, last_command, message_count,
              last_start_at, last_seen_at, last_message_at, created_at
         FROM telegram_users
        ORDER BY last_seen_at DESC NULLS LAST, last_start_at DESC
        LIMIT 10`
    ),
    query(
      `SELECT id, message, total_recipients, sent_count, failed_count, inactive_count, created_at
         FROM telegram_broadcasts
        ORDER BY created_at DESC
        LIMIT 5`
    ),
    query(
      `SELECT event_type, telegram_id, chat_id, payload, created_at
         FROM telegram_bot_events
        ORDER BY created_at DESC
        LIMIT 10`
    ).catch(() => ({ rows: [] })),
    telegramBotHealth(),
  ]);
  return {
    ...health,
    totalUsers: counts.rows[0]?.total || 0,
    activeUsers: counts.rows[0]?.active || 0,
    inactiveUsers: counts.rows[0]?.inactive || 0,
    adminUsers: counts.rows[0]?.admins || 0,
    messageCount: counts.rows[0]?.message_count || 0,
    commands: BOT_COMMANDS,
    lastUsers: lastUsers.rows,
    lastBroadcasts: lastBroadcast.rows,
    lastEvents: lastEvents.rows,
  };
}

export async function telegramUsers({ limit = 100, active = 'all' } = {}) {
  const params = [];
  const where = [];
  if (active === 'active') where.push('is_active = TRUE');
  if (active === 'inactive') where.push('is_active = FALSE');
  if (active === 'admin') where.push('is_admin = TRUE');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.max(1, Math.min(Number(limit) || 100, 500)));
  const r = await query(
    `SELECT telegram_id, chat_id, username, first_name, last_name, language_code,
            is_active, is_admin, last_command, message_count,
            last_start_at, last_seen_at, last_message_at, created_at
       FROM telegram_users
       ${clause}
      ORDER BY last_seen_at DESC NULLS LAST, last_start_at DESC
      LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

export async function telegramEvents({ limit = 100 } = {}) {
  const r = await query(
    `SELECT event_type, telegram_id, chat_id, payload, created_at
       FROM telegram_bot_events
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.max(1, Math.min(Number(limit) || 100, 300))]
  );
  return r.rows;
}

export async function telegramBroadcasts({ limit = 50 } = {}) {
  const r = await query(
    `SELECT id, message, total_recipients, sent_count, failed_count, inactive_count, metadata, created_at
       FROM telegram_broadcasts
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.max(1, Math.min(Number(limit) || 50, 200))]
  );
  return r.rows;
}

export async function sendTelegramBroadcast({ message, broadcast = null, adminId = null }) {
  const payload = normalizeBroadcastPayload({ message, broadcast });
  const validationError = validateBroadcastPayload(payload);
  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }
  if (!enabled()) {
    const err = new Error('telegram bot token is not configured');
    err.status = 503;
    throw err;
  }

  const users = await query(
    `SELECT chat_id FROM telegram_users WHERE is_active = TRUE ORDER BY last_seen_at DESC NULLS LAST, last_start_at DESC`
  );
  let sent = 0;
  let failed = 0;
  let inactive = 0;
  const errors = [];

  for (const row of users.rows) {
    try {
      await sendBroadcastPayload(row.chat_id, payload, { reply_markup: launchKeyboard() });
      sent += 1;
    } catch (err) {
      failed += 1;
      errors.push({ chatId: row.chat_id, error: err.message });
      if (err.status === 403 || /blocked|chat not found|deactivated/i.test(err.message)) {
        inactive += 1;
        await query(
          'UPDATE telegram_users SET is_active = FALSE, updated_at = now() WHERE chat_id = $1',
          [String(row.chat_id)]
        ).catch(() => {});
      }
    }
  }

  const r = await query(
    `INSERT INTO telegram_broadcasts
       (admin_id, message, total_recipients, sent_count, failed_count, inactive_count, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, message, total_recipients, sent_count, failed_count, inactive_count, metadata, created_at`,
    [
      adminId,
      broadcastDbMessage(payload),
      users.rows.length,
      sent,
      failed,
      inactive,
      broadcastMetadata(payload, errors),
    ]
  );
  return r.rows[0];
}

export async function sendTelegramAdminTestMessage({ message = '' } = {}) {
  if (!enabled()) {
    const err = new Error('telegram bot token is not configured');
    err.status = 503;
    throw err;
  }
  const text = String(message || '').trim() || [
    'Durak Imperia Telegram bot testi',
    '',
    'Admin ulanishi ishlayapti. Bot katta auditoriyaga tayyorlanmoqda.',
  ].join('\n');
  const adminIds = config.telegram.adminIds.length ? config.telegram.adminIds : [ownerId()];
  const sent = [];
  for (const adminId of adminIds) {
    try {
      const result = await sendHeroOrMessage(adminId, text, { reply_markup: adminKeyboard() });
      sent.push({
        adminId,
        ok: true,
        messageId: result?.message_id || result?.message?.message_id || null,
      });
    } catch (err) {
      sent.push({ adminId, ok: false, error: err.message });
    }
  }
  await logTelegramEvent('admin_test_sent', { from: { id: ownerId() }, chat: { id: ownerId() } }, {
    messageLength: text.length,
    adminIds,
  });
  return {
    ok: true,
    ownerId: ownerId(),
    adminIds,
    messageId: sent[0]?.messageId || null,
    sent,
  };
}
