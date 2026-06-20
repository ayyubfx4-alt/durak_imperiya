import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relPath) {
  return readFileSync(resolve(root, relPath), 'utf8').replace(/^\uFEFF/, '');
}

function assertCheck(label, condition, hint = '') {
  if (!condition) {
    console.error(`\n[release-check] failed: ${label}`);
    if (hint) console.error(`[release-check] ${hint}`);
    process.exit(1);
  }
  console.log(`[release-check] ok: ${label}`);
}

function run(label, cmd, args, cwd = root) {
  console.log(`\n[release-check] ${label}`);
  const r = spawnSync(cmd, args, { cwd, shell: false, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[release-check] failed: ${label}`);
    process.exit(r.status || 1);
  }
}

console.log('[release-check] Static Play release checks');

const capacitorConfig = JSON.parse(read('capacitor/capacitor.config.json'));
assertCheck('Capacitor app id is com.durakimperia.game', capacitorConfig.appId === 'com.durakimperia.game');
assertCheck('Capacitor app name is Durak Imperia', capacitorConfig.appName === 'Durak Imperia');
assertCheck('Capacitor cleartext server traffic is disabled', capacitorConfig.server?.cleartext === false);
assertCheck('Capacitor does not force a localhost/server.url build', !capacitorConfig.server?.url);

const androidVariables = read('capacitor/android/variables.gradle');
const targetSdk = Number(androidVariables.match(/targetSdkVersion\s*=\s*(\d+)/)?.[1] || 0);
const compileSdk = Number(androidVariables.match(/compileSdkVersion\s*=\s*(\d+)/)?.[1] || 0);
assertCheck('Android targetSdkVersion is 36+', targetSdk >= 36, `Found targetSdkVersion=${targetSdk}`);
assertCheck('Android compileSdkVersion is 36+', compileSdk >= 36, `Found compileSdkVersion=${compileSdk}`);
const androidAppGradle = read('capacitor/android/app/build.gradle');
assertCheck('Android release enables R8 minification', /release\s*\{[\s\S]*minifyEnabled\s+true/.test(androidAppGradle));
assertCheck('Android release enables resource shrinking', /release\s*\{[\s\S]*shrinkResources\s+true/.test(androidAppGradle));
assertCheck('Android release is not debuggable', /release\s*\{[\s\S]*debuggable\s+false/.test(androidAppGradle));
const proguardRules = read('capacitor/android/app/proguard-rules.pro');
assertCheck(
  'Android ProGuard keeps Capacitor/Cordova/WebView bridges',
  proguardRules.includes('com.getcapacitor')
    && proguardRules.includes('org.apache.cordova')
    && proguardRules.includes('@android.webkit.JavascriptInterface'),
);
const androidReleaseScript = read('scripts/build-android-release.ps1');
assertCheck(
  'Android release script supports secure env keystore',
  androidReleaseScript.includes('ANDROID_KEYSTORE_BASE64')
    && androidReleaseScript.includes('ANDROID_KEYSTORE_PASSWORD')
    && androidReleaseScript.includes('ANDROID_KEY_ALIAS')
    && androidReleaseScript.includes('ANDROID_KEY_PASSWORD'),
);
assertCheck(
  'Strict Android release refuses generated keystores',
  androidReleaseScript.includes('Strict store release requires a real release keystore'),
);

const androidManifest = read('capacitor/android/app/src/main/AndroidManifest.xml');
assertCheck('Android cleartext traffic is blocked', androidManifest.includes('android:usesCleartextTraffic="false"'));
assertCheck('Android backup is disabled for production', androidManifest.includes('android:allowBackup="false"'));
assertCheck('Android notification permission is declared', androidManifest.includes('android.permission.POST_NOTIFICATIONS'));
assertCheck('Android voice chat permission is declared', androidManifest.includes('android.permission.RECORD_AUDIO'));
assertCheck('Android network security config is wired', androidManifest.includes('@xml/network_security_config'));
assertCheck('Android AdMob app id placeholder is wired', androidManifest.includes('com.google.android.gms.ads.APPLICATION_ID'));
assertCheck('Android Firebase notification channel is wired', androidManifest.includes('default_notification_channel_id'));
assertCheck(
  'Android network security config exists',
  existsSync(resolve(root, 'capacitor/android/app/src/main/res/xml/network_security_config.xml')),
);
const androidNetworkSecurity = read('capacitor/android/app/src/main/res/xml/network_security_config.xml');
assertCheck(
  'Android network security blocks cleartext',
  androidNetworkSecurity.includes('cleartextTrafficPermitted="false"'),
);
const nativeConfig = read('web-client/public/native-config.js');
const runtimeConfig = read('web-client/public/runtime-config.js');
const runtimeConfigTemplate = read('web-client/public/runtime-config.js.template');
const runtimeConfigEntrypoint = read('web-client/docker-entrypoint.d/30-runtime-config.sh');
const webClientDockerfile = read('web-client/Dockerfile');
const webClientNginx = read('web-client/nginx.conf');
const apiClient = read('web-client/public/src/api.js');
const indexHtmlNative = read('web-client/public/index.html');
const deployCompose = read('docker-compose.deploy.yml');
const envExample = read('.env.example');
const productionRoute = read('backend/src/routes/production.js');
assertCheck(
  'Native release source does not hardcode the HTTP test server',
  !nativeConfig.includes('http://')
    && !runtimeConfig.includes('http://')
    && !apiClient.includes('http://62.171.185.105')
    && !indexHtmlNative.includes('http://62.171.185.105'),
);
assertCheck(
  'Runtime config is loaded before native config',
  indexHtmlNative.includes('/runtime-config.js?v=180-admob-runtime-config')
    && indexHtmlNative.indexOf('/runtime-config.js') < indexHtmlNative.indexOf('/native-config.js'),
);
assertCheck(
  'Web Docker image injects runtime config from env',
  webClientDockerfile.includes('30-runtime-config.sh')
    && runtimeConfigTemplate.includes('__ADMOB_REWARDED_ANDROID_ID__')
    && runtimeConfigTemplate.includes('__ADMOB_SSV_CALLBACK_URL__'),
);
assertCheck(
  'Runtime config exposes voice ICE servers',
  runtimeConfigTemplate.includes('__DURAK_ICE_SERVERS__')
    && runtimeConfigEntrypoint.includes('VOICE_ICE_SERVERS')
    && runtimeConfigEntrypoint.includes('TURN_USER')
    && runtimeConfigEntrypoint.includes('TURN_PASSWORD')
    && runtimeConfigEntrypoint.includes('turn_host')
    && runtimeConfigEntrypoint.includes('stun:stun.l.google.com:19302')
    && runtimeConfigEntrypoint.includes('turn:'),
);
assertCheck(
  'Deploy compose includes a TURN relay for voice chat',
  deployCompose.includes('coturn/coturn')
    && deployCompose.includes('3478:3478/udp')
    && deployCompose.includes('3478:3478/tcp')
    && deployCompose.includes('49160-49200:49160-49200/udp')
    && deployCompose.includes('TURN_USER:?TURN_USER must be set')
    && deployCompose.includes('TURN_PASSWORD:?TURN_PASSWORD must be set')
    && deployCompose.includes('VOICE_ICE_SERVERS'),
);
assertCheck(
  'Production readiness blocks voice deploys without TURN',
  productionRoute.includes('VOICE_ICE_SERVERS')
    && productionRoute.includes('TURN_USER')
    && productionRoute.includes('TURN_PASSWORD')
    && productionRoute.includes('voice.ice.turn')
    && productionRoute.includes('voice.turn.credentials'),
);
assertCheck(
  'Nginx serves runtime config without cache',
  webClientNginx.includes('location = /runtime-config.js')
    && webClientNginx.includes('no-store, no-cache'),
);
const testApkScript = read('scripts/build-android-test-apk.ps1');
assertCheck(
  'HTTP test APK path is isolated to debug builds',
  testApkScript.includes('assembleDebug') && testApkScript.includes('build-android-test-apk') && testApkScript.includes('OriginalNativeConfig'),
);

const capacitorPackage = read('capacitor/package.json');
assertCheck('Old invalid IAP package is not used', !capacitorPackage.includes('@capacitor-community/in-app-purchases'));
assertCheck('cordova-plugin-purchase is configured', capacitorPackage.includes('cordova-plugin-purchase'));

const billingGradle = `${read('capacitor/android/app/capacitor.build.gradle')}\n${read('capacitor/android/capacitor-cordova-android-plugins/build.gradle')}`;
const billingMajor = Number(billingGradle.match(/com\.android\.billingclient:billing:(\d+)\./)?.[1] || 0);
assertCheck('Google Play Billing Library is 8+', billingMajor >= 8, `Found billing major=${billingMajor}`);

assertCheck('Native API config file exists', existsSync(resolve(root, 'web-client/public/native-config.js')));
assertCheck('Backend production env example exists', existsSync(resolve(root, 'backend/.env.production.example')));
assertCheck('Play alignment migration exists', existsSync(resolve(root, 'backend/migrations/018_playstore_release_alignment.sql')));
const playMigration = read('backend/migrations/018_playstore_release_alignment.sql');
assertCheck('Admin inbox table migration exists', playMigration.includes('CREATE TABLE IF NOT EXISTS admin_inbox'));
assertCheck('Gold admin audit columns migration exists', playMigration.includes('gold_transactions') && playMigration.includes('admin_id'));
assertCheck('Baraban 10-game unlock migration exists', playMigration.includes("('baraban', 10"));

const homePage = read('web-client/public/src/pages/home.js');
const mainJs = read('web-client/public/src/main.js');
const indexHtml = read('web-client/public/index.html');
const supportWidget = read('web-client/public/src/supportWidget.js');
const supportRoute = read('backend/src/routes/support.js');
const telegramBotService = read('backend/src/services/telegramBot.js');
const serviceWorker = read('web-client/public/sw.js');
const nativeBridge = read('web-client/public/src/native/capacitor-bridge.js');
const barabanService = read('backend/src/services/baraban.js');
const adminApi = read('admin-panel/src/api.js');
const adminAnalyticsPage = read('admin-panel/src/pages/Analytics.jsx');
const barabanPanelReturns = homePage.match(/return h\('section', \{ class: 'dash-promo baraban'/g)?.length || 0;
assertCheck(
  'Baraban countdown has a live one-second timer',
  homePage.includes('baraban-time-value')
    && homePage.includes('setInterval(updateCountdown, 1000)')
    && homePage.includes('clearHomeLiveCleanups()'),
);
assertCheck(
  'Baraban countdown is based on fresh server status',
  homePage.includes('_clientReceivedAt')
    && homePage.includes('Date.now() - receivedAt')
    && barabanService.includes('nextSpinAt')
    && barabanService.includes('serverTime'),
);
assertCheck(
  'Baraban panel has only the live render path',
  barabanPanelReturns === 1 && !homePage.includes('Keyingi spin: ${timer}'),
  `Found ${barabanPanelReturns} baraban render return(s)`,
);
assertCheck(
  'Home cache-bust version includes home scope fix build',
  mainJs.includes('home.js?v=172-home-scope-fix')
    && indexHtml.includes('/src/main.js?v=147-live-ui')
    && indexHtml.includes('/styles.css?v=147-live-ui'),
);
assertCheck(
  'Support widget sends Telegram WebApp initData for verified ticket replies',
  mainJs.includes('supportWidget.js?v=170-telegram-support')
    && supportWidget.includes('telegramSupportContext')
    && supportWidget.includes('initData: typeof tg.initData'),
);
assertCheck(
  'Backend verifies Telegram initData before support bot notification',
  telegramBotService.includes('verifyTelegramWebAppInitData')
    && telegramBotService.includes('crypto.timingSafeEqual')
    && supportRoute.includes('verifiedTelegramSupportContext')
    && supportRoute.includes('notifyTelegramSupportReply'),
);
assertCheck(
  'Service worker cache is bumped for AdMob runtime config build',
  serviceWorker.includes("durak-v21-admob-runtime-config")
    && serviceWorker.includes("pathname === '/runtime-config.js'")
    && indexHtml.includes('180-admob-runtime-config'),
);
assertCheck(
  'Native rewarded ads send AdMob SSV user identity',
  nativeBridge.includes('ssv')
    && nativeBridge.includes('customData')
    && nativeBridge.includes('ssvPending')
    && nativeBridge.includes('onRewardedVideoAdReward'),
);
assertCheck(
  'Admin analytics shows customer countries, donors, premium and purchases',
  adminApi.includes('analyticsCustomerActivity')
    && adminAnalyticsPage.includes("Donat qilgan o'yinchilar")
    && adminAnalyticsPage.includes('Premium sotib olganlar')
    && adminAnalyticsPage.includes('Stiker sotib olganlar')
    && adminAnalyticsPage.includes('Boshqa narsalar sotib olganlar'),
);

const prodEnv = read('docs/production.env.example');
assertCheck('Ad reward cap is documented as 50000', prodEnv.includes('AD_BALANCE_CAP=50000'));
assertCheck('Production env documents target SDK 36+', /ANDROID_TARGET_SDK=(3[6-9]|[4-9]\d)/.test(prodEnv));
assertCheck('Production env documents Billing 8+', /GOOGLE_PLAY_BILLING_MAJOR=([8-9]|\d{2,})/.test(prodEnv));
assertCheck(
  'Production env documents TURN voice chat config',
  prodEnv.includes('TURN_USER=')
    && prodEnv.includes('TURN_PASSWORD=')
    && prodEnv.includes('VOICE_ICE_SERVERS=')
    && prodEnv.includes('stun:stun.l.google.com:19302')
    && prodEnv.includes('turn:YOUR_DOMAIN:3478?transport=udp')
    && envExample.includes('turn:your-domain.example:3478?transport=udp'),
);

if (process.platform === 'win32') {
  run('backend tests', 'cmd.exe', ['/d', '/s', '/c', 'npm test'], `${root}/backend`);
} else {
  run('backend tests', 'npm', ['test'], `${root}/backend`);
}
run('backend admin syntax', 'node', ['--check', 'backend/src/routes/admin.js']);
run('backend config syntax', 'node', ['--check', 'backend/src/config.js']);
run('backend index syntax', 'node', ['--check', 'backend/src/index.js']);
run('backend syntax', 'node', ['--check', 'backend/src/routes/production.js']);
run('backend baraban syntax', 'node', ['--check', 'backend/src/services/baraban.js']);
run('backend gold syntax', 'node', ['--check', 'backend/src/services/goldCoins.js']);
run('web AI syntax', 'node', ['--check', 'web-client/public/src/services/aiChat.js']);
run('web native bridge syntax', 'node', ['--check', 'web-client/public/src/native/capacitor-bridge.js']);
run('web game syntax', 'node', ['--check', 'web-client/public/src/pages/game.js']);
run('web shop syntax', 'node', ['--check', 'web-client/public/src/pages/shop.js']);
run('project-wide live UI audit', 'node', ['scripts/audit-ui-liveness.mjs']);
run('shop economy audit', 'node', ['scripts/audit-shop-economy.mjs']);
run('profile audit', 'node', ['scripts/audit-profile.mjs']);
run('public secret audit', 'node', ['scripts/audit-public-secrets.mjs']);
run('admin production build', process.platform === 'win32' ? 'cmd.exe' : 'npm',
  process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build'],
  `${root}/admin-panel`);

console.log('\n[release-check] Code checks passed.');
console.log('[release-check] For final store release, run the live endpoint too:');
console.log('  curl https://YOUR_DOMAIN/api/production/readiness');
