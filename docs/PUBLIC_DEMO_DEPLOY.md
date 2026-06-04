# Public Demo Deploy

Target public demo should be your own configured public origin, for example:

`https://your-domain.example`

This repository cannot make that IP work by itself. The VPS must run the containers and expose the selected ports.

## Recommended Production Ports

- Web app: `19080`
- Admin panel: `19081`
- Backend API: `14000`

If a temporary demo port is required, map the web or admin service to that port in the VPS compose file, but use a real HTTPS domain before Play Market release.

## Deploy Steps

1. Copy the repository to the VPS.
2. Copy `docs/production.env.example` to `.env`.
3. Fill real secrets and production URLs.
4. Run:

```powershell
docker compose -f docker-compose.deploy.yml up -d --build
```

5. Check:

```powershell
curl http://127.0.0.1:14000/health
curl http://127.0.0.1:14000/api/production/readiness
```

6. Configure firewall/security group to allow the public demo port.
7. Put HTTPS reverse proxy in front of the public app before Play Market release.

## Release Rule

Localhost passing is not enough for Play Market. Release only when:

- Public URL works
- `/health` returns `ok=true`
- `/api/production/readiness` returns `ok=true`
- WebSocket multiplayer works from another device/network
