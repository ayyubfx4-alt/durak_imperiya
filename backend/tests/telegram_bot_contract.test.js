import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

test('telegram bot is locked to the approved admin ids', () => {
  const config = read('backend/src/config.js');
  const env = read('.env.example');

  assert.match(config, /TELEGRAM_OWNER_ID = '8324791195'/);
  assert.match(config, /TELEGRAM_ADMIN_IDS = \['8324791195', '8396560736'\]/);
  assert.match(config, /ownerId:/);
  assert.match(config, /adminIds:/);
  assert.match(env, /TELEGRAM_OWNER_ID=8324791195/);
  assert.match(env, /TELEGRAM_ADMIN_IDS=8324791195,8396560736/);
  assert.match(env, /TELEGRAM_PLAY_MARKET_URL=/);
  assert.match(env, /TELEGRAM_STARS_ENABLED=1/);
});

test('telegram service has production command, callback, image, Play Market, and admin test flows', () => {
  const service = read('backend/src/services/telegramBot.js');

  assert.match(service, /BOT_COMMANDS/);
  assert.match(service, /setMyDescription/);
  assert.match(service, /setMyCommands/);
  assert.match(service, /allowed_updates: \['message', 'callback_query'\]/);
  assert.match(service, /sendTelegramPhoto/);
  assert.match(service, /sendTelegramVideo/);
  assert.match(service, /heroImageUrl/);
  assert.match(service, /playMarketButton/);
  assert.match(service, /function launchKeyboard\(\) \{\s*const rows = \[\s*\[launchButton\(\)\],\s*\];/s);
  assert.match(service, /function adminInlineKeyboard\(\) \{\s*return \{\s*inline_keyboard: \[\s*\[adminPanelButton\(\)\],\s*\],/s);
  assert.match(service, /ADMIN_BUTTONS/);
  assert.match(service, /Hisob-kitob/);
  assert.match(service, /Shikoyatlar/);
  assert.match(service, /Support markazi/);
  assert.match(service, /bot:broadcast_confirm/);
  assert.match(service, /extractBroadcastPayload/);
  assert.match(service, /message\?\.photo/);
  assert.match(service, /message\?\.video\?\.file_id/);
  assert.match(service, /sendBroadcastPayload/);
  assert.match(service, /bot:admin_status/);
  assert.match(service, /sendTelegramAdminTestMessage/);
  assert.match(service, /telegramBotHealth/);
  assert.match(service, /telegramBotEvents|telegram_bot_events/);
  assert.doesNotMatch(service, /Konkurslar ro'yxati/);
  assert.doesNotMatch(service, /Kanallar tekshirish/);
  assert.doesNotMatch(service, /Telegram Stars/);
});

test('telegram admin API exposes health, configure, test message, events, and broadcast', () => {
  const route = read('backend/src/routes/telegramAdmin.js');

  assert.match(route, /\/health/);
  assert.match(route, /\/configure/);
  assert.match(route, /\/test-admin-message/);
  assert.match(route, /\/events/);
  assert.match(route, /sendTelegramBroadcast/);
  assert.match(route, /broadcast: req\.body\?\.broadcast/);
});

test('telegram admin panel is wired to the professional control endpoints', () => {
  const api = read('admin-panel/src/api.js');
  const page = read('admin-panel/src/pages/Telegram.jsx');

  assert.match(api, /telegramHealth/);
  assert.match(api, /telegramConfigure/);
  assert.match(api, /telegramTestAdminMessage/);
  assert.match(api, /telegramEvents/);

  assert.match(page, /Telegram Bot Control/);
  assert.match(page, /Ownerga test xabar yuborish/);
  assert.match(page, /Command\/Menu yangilash/);
  assert.match(page, /Bot event log/);
  assert.match(page, /Admin ID OK/);
});

test('telegram professional migration stores admin state and event logs', () => {
  const migration = read('backend/migrations/027_telegram_professional_bot.sql');

  assert.match(migration, /ADD COLUMN IF NOT EXISTS is_admin/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS last_command/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS message_count/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS telegram_bot_events/);
  assert.match(migration, /8324791195/);
  assert.match(migration, /8396560736/);
});
