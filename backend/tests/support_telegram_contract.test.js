import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relPath) {
  return readFileSync(resolve(root, relPath), 'utf8').replace(/^\uFEFF/, '');
}

test('support widget sends Telegram WebApp initData only through ticket context', () => {
  const widget = read('web-client/public/src/supportWidget.js');
  const main = read('web-client/public/src/main.js');
  assert.match(main, /supportWidget\.js\?v=[^'"]+/);
  assert.match(widget, /function telegramSupportContext/);
  assert.match(widget, /initData: typeof tg\.initData === 'string' \? tg\.initData : ''/);
});

test('support route verifies Telegram initData and does not persist raw initData', () => {
  const route = read('backend/src/routes/support.js');
  assert.match(route, /verifyTelegramWebAppInitData/);
  assert.match(route, /sanitizeSupportContext\(rawContext\)/);
  assert.match(route, /verifiedTelegramSupportContext\(rawContext\)/);
  assert.match(route, /hasInitData/);
  assert.doesNotMatch(route, /JSON\.stringify\(\{\s*context:\s*rawContext/);
});

test('admin support replies can notify verified Telegram chat', () => {
  const route = read('backend/src/routes/support.js');
  const service = read('backend/src/services/telegramBot.js');
  assert.match(route, /notifyTelegramSupportReply/);
  assert.match(route, /sendTelegramMessage\(chatId/);
  assert.match(service, /export function verifyTelegramWebAppInitData/);
  assert.match(service, /crypto\.timingSafeEqual/);
});

test('Android store release is minified, shrunk, and strict keystore aware', () => {
  const gradle = read('capacitor/android/app/build.gradle');
  const proguard = read('capacitor/android/app/proguard-rules.pro');
  const script = read('scripts/build-android-release.ps1');
  assert.match(gradle, /release\s*\{[\s\S]*debuggable false[\s\S]*minifyEnabled true[\s\S]*shrinkResources true/);
  assert.match(proguard, /com\.getcapacitor/);
  assert.match(proguard, /org\.apache\.cordova/);
  assert.match(proguard, /@android\.webkit\.JavascriptInterface/);
  assert.match(script, /ANDROID_KEYSTORE_BASE64/);
  assert.match(script, /Strict store release requires a real release keystore/);
});
