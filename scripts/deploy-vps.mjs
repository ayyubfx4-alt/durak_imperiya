import { Client } from 'ssh2';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const host = process.env.VPS_HOST;
const username = process.env.VPS_USER || 'root';
const password = process.env.VPS_PASSWORD;
const archive = process.env.DEPLOY_ARCHIVE;
const remoteRoot = process.env.REMOTE_ROOT || '/opt/durak_imperia';
const publicAppUrl = (process.env.PUBLIC_APP_URL || `http://${host}:18081`).replace(/\/+$/, '');
const corsOrigin = process.env.CORS_ORIGIN || publicAppUrl;
const privacyPolicyUrl = process.env.PRIVACY_POLICY_URL || `${publicAppUrl}/privacy.html`;
const stripeSuccessUrl = process.env.STRIPE_SUCCESS_URL || `${publicAppUrl}/#/shop?status=success`;
const stripeCancelUrl = process.env.STRIPE_CANCEL_URL || `${publicAppUrl}/#/shop?status=cancelled`;
const importIncomingEnv = process.env.DEPLOY_IMPORT_ENV === '1' ? '1' : '0';

if (!host || !password || !archive) {
  console.error('VPS_HOST, VPS_PASSWORD and DEPLOY_ARCHIVE are required.');
  process.exit(1);
}

const conn = new Client();

function exec(command, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!quiet) console.log(`\n$ ${command}`);
    conn.exec(command, { pty: false }, (err, stream) => {
      if (err) return reject(err);
      let stderr = '';
      stream.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`command failed (${code}): ${command}\n${stderr}`));
      });
      stream.on('data', (data) => {
        if (!quiet) process.stdout.write(data.toString());
      });
      stream.stderr.on('data', (data) => {
        stderr += data.toString();
        if (!quiet) process.stderr.write(data.toString());
      });
    });
  });
}

function upload(local, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(local, remote, { concurrency: 2, chunkSize: 32768 }, (putErr) => {
        if (putErr) {
          sftp.end();
          return reject(putErr);
        }
        sftp.chmod(remote, 0o600, (chmodErr) => {
          sftp.end();
          if (chmodErr) return reject(chmodErr);
          resolve();
        });
      });
    });
  });
}

conn.on('ready', async () => {
  try {
    console.log('Connected to VPS.');
    const remoteArchive = '/tmp/durak_imperia_deploy.tgz';
    await exec(`mkdir -p ${remoteRoot}`);
    await exec(`rm -f ${remoteArchive}`, { quiet: true });
    console.log(`Uploading ${archive}...`);
    await upload(archive, remoteArchive);

    const postgresPassword = `durak_${randomBytes(12).toString('hex')}`;
    const jwtSecret = randomBytes(48).toString('hex');
    const remoteScript = `
set -euo pipefail
APP_ROOT="${remoteRoot}"
RELEASE_DIR="$APP_ROOT/app"
NEW_DIR="$APP_ROOT/app.new"
BACKUP_DIR="$APP_ROOT/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$APP_ROOT/backups"
rm -rf "$NEW_DIR"
mkdir -p "$NEW_DIR"
tar -xzf ${remoteArchive} -C "$NEW_DIR"
INCOMING_ENV="$APP_ROOT/.env.incoming"
rm -f "$INCOMING_ENV"
if [ "${importIncomingEnv}" = "1" ] && [ -f "$NEW_DIR/.env" ]; then
  cp "$NEW_DIR/.env" "$INCOMING_ENV"
fi
if [ -d "$RELEASE_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  cp -a "$RELEASE_DIR/." "$BACKUP_DIR/" || true
fi
rm -rf "$RELEASE_DIR"
mv "$NEW_DIR" "$RELEASE_DIR"
cd "$RELEASE_DIR"
if [ -f "$APP_ROOT/.env" ]; then
  cp "$APP_ROOT/.env" .env
else
  cat > .env <<'ENVEOF'
NODE_ENV=production
POSTGRES_USER=durak
POSTGRES_PASSWORD=${postgresPassword}
POSTGRES_DB=durak
JWT_SECRET=${jwtSecret}
JWT_EXPIRES_IN=7d
CORS_ORIGIN=${corsOrigin}
ADMIN_BOOTSTRAP_EMAIL=admin@durak.local
ADMIN_BOOTSTRAP_PASSWORD=${process.env.ADMIN_BOOTSTRAP_PASSWORD || '2202'}
ADMIN_PIN=${process.env.ADMIN_PIN || '2202'}
PUBLIC_APP_URL=${publicAppUrl}
PRIVACY_POLICY_URL=${privacyPolicyUrl}
RELEASE_PLATFORMS=android
GOOGLE_PLAY_PACKAGE_NAME=com.durakimperia.game
ADMOB_HALAL_CATEGORIES_BLOCKED=0
PREMIUM_PRICES_APPROVED=0
GDEVELOP_SILVER_ACTIVE=0
USE_NODE_BACKEND_ONLY=1
ANDROID_RELEASE_KEYSTORE_READY=0
ALLOW_MOCK_IAP=0
ENVEOF
  cp .env "$APP_ROOT/.env"
fi
if [ -f "$INCOMING_ENV" ]; then
  for key in CORS_ORIGIN PUBLIC_APP_URL PRIVACY_POLICY_URL ADMIN_BOOTSTRAP_PASSWORD ADMIN_PIN PREMIUM_MONTHLY_USD PREMIUM_QUARTERLY_USD PREMIUM_YEARLY_USD PREMIUM_PRICES_APPROVED STRIPE_SECRET_KEY STRIPE_PUBLIC_KEY STRIPE_WEBHOOK_SECRET STRIPE_SUCCESS_URL STRIPE_CANCEL_URL FIREBASE_PROJECT_ID FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY FIREBASE_API_KEY FIREBASE_AUTH_DOMAIN FIREBASE_STORAGE_BUCKET FIREBASE_MESSAGING_SENDER_ID FIREBASE_APP_ID TELEGRAM_BOT_TOKEN TELEGRAM_GAME_URL TELEGRAM_BOT_POLLING_ENABLED TELEGRAM_BOT_INSTANCE_ID TELEGRAM_DROP_PENDING_UPDATES AD_BALANCE_CAP UNLOCK_AD_GAMES UNLOCK_COLLECTION_GAMES UNLOCK_VOICE_GAMES UNLOCK_BARABAN_GAMES UNLOCK_REFERRAL_GAMES UNLOCK_PREMIUM_GAMES UNLOCK_GOLD_SHOP_WINS GDEVELOP_SILVER_ACTIVE; do
    line=$(grep -m1 "^$key=" "$INCOMING_ENV" || true)
    if [ -n "$line" ]; then
      value="\${line#*=}"
      if [ -z "$value" ]; then
        continue
      fi
      tmp_env="$(mktemp)"
      grep -v "^$key=" .env > "$tmp_env" || true
      cat "$tmp_env" > .env
      rm -f "$tmp_env"
      printf '%s\n' "$line" >> .env
    fi
  done
  cp .env "$APP_ROOT/.env"
  rm -f "$INCOMING_ENV"
fi
docker compose -f docker-compose.deploy.yml down --remove-orphans || true
docker compose -f docker-compose.deploy.yml up -d --build
docker compose -f docker-compose.deploy.yml exec -T backend npm run migrate
docker compose -f docker-compose.deploy.yml exec -T backend npm run seed || true
rm -f ${remoteArchive}
docker compose -f docker-compose.deploy.yml ps
`;
    const localScript = join(tmpdir(), `durak-imperia-remote-${Date.now()}.sh`);
    writeFileSync(localScript, remoteScript, { mode: 0o600 });
    await upload(localScript, '/tmp/durak_imperia_remote_deploy.sh');
    try { unlinkSync(localScript); } catch {}
    await exec('bash /tmp/durak_imperia_remote_deploy.sh');
    await exec('curl -fsS http://127.0.0.1:14000/api/production/readiness || true');
    await exec('curl -fsS -o /dev/null -w "web:%{http_code}\\n" http://127.0.0.1:18081/');
    await exec('curl -fsS -o /dev/null -w "admin:%{http_code}\\n" http://127.0.0.1:18082/');
    await exec('curl -fsS -o /dev/null -w "support:%{http_code}\\n" http://127.0.0.1:18083/');
    conn.end();
  } catch (err) {
    console.error(err.message);
    conn.end();
    process.exitCode = 1;
  }
}).connect({
  host,
  port: Number(process.env.VPS_PORT || 22),
  username,
  password,
  readyTimeout: 30000,
  keepaliveInterval: 10000,
  keepaliveCountMax: 12,
});
