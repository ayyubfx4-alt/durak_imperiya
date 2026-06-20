import { Client } from 'ssh2';

const host = '62.171.185.105';
const username = 'root';
const password = 'Javohir2010';

const conn = new Client();
conn.on('error', (err) => {
  console.error('SSH Error:', err);
  process.exit(1);
});

conn.on('ready', () => {
  console.log('Connected to VPS.');
  conn.exec(
    'cd /opt/durak_v6_final/app && cp .env.v6.server .env && docker compose -f docker-compose.v6-server.yml up -d --build backend',
    (err, stream) => {
      if (err) { console.error('Exec error:', err); conn.end(); process.exit(1); }
      stream.on('close', (code) => {
        console.log(`Done with code ${code}`);
        conn.end();
        process.exit(code);
      });
      stream.on('data', (d) => process.stdout.write(d.toString()));
      stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
    }
  );
}).connect({ host, port: 22, username, password });
