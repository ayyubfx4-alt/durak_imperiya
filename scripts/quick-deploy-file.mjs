/**
 * Quick deploy: upload a single file to VPS via SFTP
 * Usage: node scripts/quick-deploy-file.mjs <local-path> <remote-path>
 * Example: node scripts/quick-deploy-file.mjs web-client/public/styles.css /opt/durak_v6_final/app/web-client/public/styles.css
 */
import { Client } from 'ssh2';
import { resolve } from 'node:path';

const host = '62.171.185.105';
const username = 'root';
const password = 'Javohir2010';

const [,, localArg, remoteArg] = process.argv;

if (!localArg || !remoteArg) {
  console.error('Usage: node scripts/quick-deploy-file.mjs <local-file> <remote-path>');
  process.exit(1);
}

const localPath = resolve(localArg);
const remotePath = remoteArg;

console.log(`Uploading: ${localPath}`);
console.log(`     → ${remotePath}`);

const conn = new Client();

conn.on('error', (err) => {
  console.error(`Connection failed: ${err.message}`);
  process.exit(1);
});

conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error(err); conn.end(); process.exit(1); }

    sftp.fastPut(localPath, remotePath, { concurrency: 4, chunkSize: 65536 }, (putErr) => {
      sftp.end();
      if (putErr) {
        console.error(`Upload failed: ${putErr.message}`);
        conn.end();
        process.exit(1);
      }
      console.log('✅ File uploaded successfully!');

      // Reload nginx in web-client container to pick up new static file
      conn.exec(
        'docker exec app-web-client-1 nginx -s reload 2>/dev/null || true',
        (execErr, stream) => {
          if (execErr) { conn.end(); return; }
          stream.on('close', () => {
            console.log('✅ nginx reloaded in web-client container.');
            conn.end();
          });
          stream.on('data', (d) => process.stdout.write(d.toString()));
          stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
        }
      );
    });
  });
}).connect({ host, port: 22, username, password, readyTimeout: 15000 });
