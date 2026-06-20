import { Client } from 'ssh2';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const host = '62.171.185.105';
const username = 'root';
const password = 'Javohir2010';
const remoteRoot = '/opt/durak_v6_final';

// 1. Create a local tarball archive of the project
const archivePath = join(tmpdir(), `durak_v6_deploy_${Date.now()}.tgz`);
const excludeListPath = join(tmpdir(), `durak_exclude_${Date.now()}.txt`);
console.log(`Creating local tarball archive at: ${archivePath}`);

try {
  const excludes = [
    'node_modules',
    '.git',
    'dist',
    'tools',
    'capacitor',
    '*.tgz',
    '*.tar.gz'
  ].join('\n');
  writeFileSync(excludeListPath, excludes, 'utf8');

  // We run tar command. Note that on Windows we are in the project folder.
  execSync(
    `tar -czf "${archivePath}" -X "${excludeListPath}" .`,
    { stdio: 'inherit' }
  );
  console.log('Archive created successfully.');
  try { unlinkSync(excludeListPath); } catch {}
} catch (error) {
  console.error('Failed to create local archive:', error.message);
  try { unlinkSync(excludeListPath); } catch {}
  process.exit(1);
}

const conn = new Client();

conn.on('error', (err) => {
  console.error(`VPS deploy connection failed: ${err.message}`);
  try { unlinkSync(archivePath); } catch {}
  process.exit(1);
});

function execRemote(command, { quiet = false } = {}) {
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

function uploadFile(local, remote) {
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
    const remoteArchive = '/tmp/durak_v6_deploy.tgz';
    await execRemote(`mkdir -p ${remoteRoot}`);
    await execRemote(`rm -f ${remoteArchive}`, { quiet: true });
    
    console.log(`Uploading archive to remote server...`);
    await uploadFile(archivePath, remoteArchive);
    console.log('Archive uploaded successfully.');

    // We prepare the remote setup script
    const remoteScript = `
set -euo pipefail
APP_ROOT="${remoteRoot}"
RELEASE_DIR="$APP_ROOT/app"
NEW_DIR="$APP_ROOT/app.new"
BACKUP_DIR="$APP_ROOT/backups/$(date +%Y%m%d-%H%M%S)"

echo "Checking dependencies..."
if ! command -v docker &> /dev/null; then
  echo "Docker not found. Installing..."
  if command -v apt-get &> /dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y docker.io git curl
    systemctl start docker || true
    systemctl enable docker || true
  elif command -v yum &> /dev/null; then
    yum install -y docker git curl
    systemctl start docker || true
    systemctl enable docker || true
  else
    echo "ERROR: Docker is not installed and package manager is not supported. Please install Docker manually."
    exit 1
  fi
fi

if ! docker compose version &> /dev/null; then
  echo "Docker Compose v2 not found. Installing..."
  if command -v apt-get &> /dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y docker-compose-plugin
  else
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -SL https://github.com/docker/compose/releases/download/v2.26.1/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi
fi

echo "Creating backup directory..."
mkdir -p "$APP_ROOT/backups"
rm -rf "$NEW_DIR"
mkdir -p "$NEW_DIR"

echo "Extracting archive..."
tar -xzf ${remoteArchive} -C "$NEW_DIR"

if [ -d "$RELEASE_DIR" ]; then
  echo "Backing up existing release..."
  mkdir -p "$BACKUP_DIR"
  cp -a "$RELEASE_DIR/." "$BACKUP_DIR/" || true
fi

echo "Replacing app directory with the new release..."
rm -rf "$RELEASE_DIR"
mv "$NEW_DIR" "$RELEASE_DIR"

cd "$RELEASE_DIR"

echo "Setting up production environment files from .env.v6.server..."
if [ -f ".env.v6.server" ]; then
  cp .env.v6.server .env
  cp .env "$APP_ROOT/.env"
else
  echo "ERROR: .env.v6.server not found in release!"
  exit 1
fi

echo "Stopping any running containers..."
docker compose -f docker-compose.v6-server.yml down --remove-orphans || true

echo "Starting containers and building images..."
docker compose -f docker-compose.v6-server.yml up -d --build

echo "Running migrations..."
docker compose -f docker-compose.v6-server.yml exec -T backend npm run migrate

echo "Running seed database..."
docker compose -f docker-compose.v6-server.yml exec -T backend npm run seed || true

echo "Cleaning up archive..."
rm -f ${remoteArchive}

echo "Showing container status:"
docker compose -f docker-compose.v6-server.yml ps
`;

    const localScriptPath = join(tmpdir(), `durak-v6-remote-${Date.now()}.sh`);
    writeFileSync(localScriptPath, remoteScript, { mode: 0o600 });
    
    console.log('Uploading remote execution script...');
    await uploadFile(localScriptPath, '/tmp/durak_v6_remote_deploy.sh');
    try { unlinkSync(localScriptPath); } catch {}

    console.log('Running remote deployment script on VPS...');
    await execRemote('bash /tmp/durak_v6_remote_deploy.sh');

    console.log('\nDeployment completed successfully! Performing local checks...');
    await execRemote('curl -fsS http://127.0.0.1:15000/health || true');
    await execRemote('curl -fsS -o /dev/null -w "Web Client HTTP status: %{http_code}\\n" http://127.0.0.1:19080/ || true');

    conn.end();
    try { unlinkSync(archivePath); } catch {}
  } catch (err) {
    console.error('Deployment failed:', err.message);
    conn.end();
    try { unlinkSync(archivePath); } catch {}
    process.exit(1);
  }
}).connect({
  host,
  port: 22,
  username,
  password,
  readyTimeout: 30000,
  keepaliveInterval: 10000,
  keepaliveCountMax: 12,
});
