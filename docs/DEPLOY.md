# Deployment guide

## 1. Self-host with Docker Compose (single VM)

Cheapest option, suitable for small-to-medium traffic (~1000 concurrent users).

```bash
# Provision a VM (DigitalOcean/Linode/Hetzner — $5–20/mo)
ssh root@server.example.com
apt update && apt install -y docker.io docker-compose-plugin git
git clone <your-repo> durak-online
cd durak-online
cp .env.example .env
nano .env                   # set JWT_SECRET, ADMIN_BOOTSTRAP_PASSWORD, etc.
docker compose up -d --build
docker compose exec backend npm run migrate
```

Front with **Caddy** for free HTTPS:

```caddyfile
api.example.com {
    reverse_proxy localhost:4000
}
example.com {
    reverse_proxy localhost:8080
}
admin.example.com {
    reverse_proxy localhost:8081
}
```

## 2. Railway / Render / Fly.io (PaaS)

### Backend on Fly.io

```bash
cd backend
flyctl launch
flyctl postgres create
flyctl postgres attach <name>
flyctl secrets set JWT_SECRET="$(openssl rand -base64 32)"
flyctl deploy
```

### Web client + Admin panel on Cloudflare Pages / Vercel

Both are static sites that hit the backend over HTTPS. Set environment variable `VITE_API_BASE` (admin panel) and the `__API_BASE__` global (web client) to the backend URL.

## 3. AWS (ECS Fargate + RDS)

1. Push images to ECR: `backend`, `web-client`, `admin-panel`.
2. Create RDS Postgres (`db.t4g.micro` for testing).
3. ECS Fargate service for `backend` (1 task, 0.5 vCPU / 1GB RAM, port 4000).
4. ALB → backend, with WebSocket support enabled (sticky sessions for Socket.IO).
5. CloudFront + S3 for static clients (build artifacts from `web-client/public` and `admin-panel/dist`).
6. Cognito or your own JWT for auth.

## 4. Scaling beyond a single backend instance

The current `RoomManager` keeps room state in memory. For horizontal scale:

1. Replace the room store with **Redis** (pub/sub for game events, hash for room state).
2. Make socket.io use the **redis adapter**: `npm install @socket.io/redis-adapter` and configure.
3. Pin a player to one backend pod via sticky-session cookie or Socket.IO's session affinity.

Concrete patch:

```js
// backend/src/game/socket.js
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
const pub = createClient({ url: process.env.REDIS_URL });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);
io.adapter(createAdapter(pub, sub));
```

## 5. Mobile app store distribution

The web client is a PWA — users can install it from any browser. To ship as native app stores:

- **Android:** wrap with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) or [PWABuilder](https://www.pwabuilder.com/) → signed `.aab`.
- **iOS:** Capacitor (`npx cap init`, `npx cap add ios`) wraps the same web bundle into a native iOS app.

Both still hit the same backend.
