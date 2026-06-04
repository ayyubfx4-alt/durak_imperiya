import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relPath) {
  return readFileSync(resolve(root, relPath), 'utf8');
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
assertCheck('Android targetSdkVersion is 35+', targetSdk >= 35, `Found targetSdkVersion=${targetSdk}`);

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
const apiClient = read('web-client/public/src/api.js');
const indexHtmlNative = read('web-client/public/index.html');
assertCheck(
  'Native release source does not hardcode the HTTP test server',
  !nativeConfig.includes('http://')
    && !apiClient.includes('http://62.171.185.105')
    && !indexHtmlNative.includes('http://62.171.185.105'),
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
const barabanService = read('backend/src/services/baraban.js');
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
  'Home cache-bust version includes live countdown build',
  mainJs.includes('home.js?v=146-live-countdown')
    && indexHtml.includes('/src/main.js?v=147-live-ui')
    && indexHtml.includes('/styles.css?v=147-live-ui'),
);

const prodEnv = read('docs/production.env.example');
assertCheck('Ad reward cap is documented as 1000', prodEnv.includes('AD_BALANCE_CAP=1000'));
assertCheck('Production env documents target SDK 35+', /ANDROID_TARGET_SDK=(3[5-9]|[4-9]\d)/.test(prodEnv));
assertCheck('Production env documents Billing 8+', /GOOGLE_PLAY_BILLING_MAJOR=([8-9]|\d{2,})/.test(prodEnv));

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
