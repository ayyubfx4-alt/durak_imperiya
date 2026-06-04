# Durak Online

Real-time multiplayer **Durak** card game (36-card Russian deck, 2–4 players) — full stack, mobile-first, production-ready.

- **Backend:** Node.js + Socket.IO + PostgreSQL (server-authoritative game logic, Google OAuth / JWT auth, REST + WebSocket API).
- **Web/PWA client:** Vanilla JavaScript SPA with premium glassmorphism dark-theme UI, installable as a PWA. Plays on Android, iOS (Safari), and desktop browsers.
- **Admin panel:** React + Vite + Tailwind. User management, ban/unban, coin grants, premium grants, stats, audit log.
- **Docker Compose:** one command brings up Postgres, backend, web client, and admin panel.

> **Status:** production-grade scaffold with the full game engine, all major feature modules (Google auth, nickname system, multilingual i18n, currency, referral, achievements, premium, friends, chat, shop, bots, admin, AdMob, push notifications), and end-to-end docker setup. Card art and emoji image assets are placeholders — drop in real PNGs at `web-client/public/cards/` and `web-client/public/emoji/<packId>/<index>.png`.

---

## Repo layout

```
durak-online/
├─ backend/             # Node.js + Socket.IO + Postgres
│  ├─ src/
│  │  ├─ game/          # engine.js, deck.js, bot.js, room.js, socket.js
│  │  ├─ routes/        # auth, users, games, inventory, shop, friends, admin
│  │  ├─ services/      # auth, coins, referral, achievements
│  │  ├─ data/          # botNames, achievements, emojiPacks, cardSkins
│  │  ├─ middleware/    # auth, error
│  │  └─ scripts/       # migrate.js
│  ├─ migrations/       # 001_initial.sql
│  └─ tests/            # node --test based unit tests for the engine
├─ web-client/          # PWA client (HTML5 + vanilla JS)
│  └─ public/
│     ├─ src/
│     │  ├─ pages/      # login, home, lobby, game, profile, shop, friends, achievements
│     │  ├─ api.js      # REST wrapper
│     │  ├─ socket.js   # Socket.IO client wrapper
│     │  └─ main.js     # router entry
│     ├─ index.html
│     ├─ manifest.webmanifest
│     ├─ service-worker.js
│     └─ icons/
├─ admin-panel/         # React + Vite + Tailwind admin dashboard
└─ docker-compose.yml
```

---

## Quick start (Docker)

Requires Docker + Docker Compose v2.

```bash
git clone <this repo>
cd durak-online
cp .env.example .env       # edit JWT_SECRET, ADMIN_BOOTSTRAP_PASSWORD, etc.
docker compose up --build
```

Then in another terminal, run migrations once:

```bash
docker compose exec backend npm run migrate
```

Open:

- **Web client (game):** http://localhost:8080
- **Admin panel:** http://localhost:8081 (sign in with `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` from `.env`)
- **Backend health:** http://localhost:4000/health

---

## Local dev (without Docker)

You need Node 20+ and a Postgres 16+ instance.

```bash
# 1. Postgres
createdb durak
export DATABASE_URL=postgres://you@localhost:5432/durak

# 2. Backend
cd backend
cp .env.example .env  # edit JWT_SECRET etc.
npm install
npm run migrate
npm run dev          # → http://localhost:4000

# 3. Web client (in another shell)
cd web-client
npm install
npm run dev          # → http://localhost:8080

# 4. Admin panel (in another shell)
cd admin-panel
npm install
npm run dev          # → http://localhost:8081
```

---

## Authentication & Nickname System

- **Google Sign-In is the only login method** (no username/password). Firebase Auth handles the OAuth flow; the backend verifies the Firebase `id_token` and issues a JWT.
- On first login the user picks a **unique @nickname** (e.g. `@anvar`). Nicknames are indexed; a uniqueness check endpoint is available before confirmation (`GET /api/auth/nickname/check?nick=anvar`).
- Other players can **search by @nickname** (`GET /api/friends/search?nick=anvar`), **send friend requests**, and **invite to game room** via nickname.
- The user row stores: `google_id`, `nickname`, `display_name`, `avatar_url`, `locale`, `fcm_token`, `coins`, `premium_until`, `rank_wins`, `selected_skin`, `badges_showcase`.

---

## Multilingual Support (i18n)

- On **first launch** the app reads `navigator.language` (web) / `Locale.getDefault()` (Android) / `NSLocale` (iOS) and selects the closest supported locale.
- Supported locales: **uz** (O'zbek), **ru** (Русский), **en** (English). Easily extendable — add a JSON file under `web-client/public/i18n/`.
- Active locale is stored per-user on the server (`locale` column). The Settings screen lists all supported languages.
- All UI strings are driven by locale JSON; no hard-coded labels.

---

## Design System

### Visual Theme — «Night Arena»

| Token | Value |
|---|---|
| Background | `#0d0f1a` (deep navy) |
| Surface | `#161929` |
| Card glass | `rgba(255,255,255,0.06)` + `backdrop-filter: blur(16px)` |
| Accent (gold) | `#f5c842` |
| Accent (ruby) | `#e63560` |
| Trump highlight | `#00e0ff` (cyan glow) |
| Font | **Inter** (UI) + **Orbitron** (scores/ranks) — Google Fonts |

### Key UI Principles

- **Glassmorphism cards** — translucent card panels with frosted-glass blur, floating above the dark felt table.
- **Animated table felt** — soft radial gradient "felt" texture with a subtle particle shimmer via CSS `@keyframes`.
- **Micro-animations** — card deal (slide-in + flip), attack/defend (smooth translate), win/lose (confetti burst / shake).
- **Rank badge glow** — gold/red/black tier badges pulse with a matching color shadow.
- **Responsive & touch-first** — 44 px minimum touch targets, swipe gestures for card play, haptic feedback stubs.
- **Dark-only** — the app uses a single curated dark palette; no light mode toggle (premium card skins are the visual differentiator).

### Asset placement

```
web-client/public/
  cards/          ← drop card PNGs here (e.g. AS.png, 6C.png)
  emoji/<packId>/ ← 30 PNGs per pack (0.png … 29.png)
  i18n/           ← uz.json, ru.json, en.json
  icons/          ← PWA icons (192, 512)
  fonts/          ← self-hosted Inter & Orbitron woff2 (optional)
```

---

## Game rules implemented

- **36-card deck** (6,7,8,9,T,J,Q,K,A in 4 suits).
- **2–4 players.** Initial deal of 6 cards each. Bottom card is the trump indicator.
- **Lowest trump goes first.**
- **Attacker** plays a card → **defender** must beat with a higher card of the same suit OR any trump.
- Other attackers may **throw in** cards matching ranks already on the table.
- Defender **takes** all cards on the table if they cannot beat.
- Cards drawn after each round (attacker first, defender last) until deck is empty.
- Last player with cards = **Durak** (the loser).
- Optional **bluff mode** (host-toggleable): face-down cards with claimed ranks; opponents may challenge. Tracks "Sheriff Badge" (5 catches) and other bluff stats.
- **Server-authoritative:** all game state lives in the backend; the client only renders what the server sends and emits intent (`game:action`).

## Bot system

- Empty seats are filled with bots after **30 seconds** (configurable).
- Bot names from a curated realistic-name pool — never named "Bot1", etc.
- Bots do **not** leave when a real player joins; they continue until the round ends.
- 3 difficulty levels:
  - **Easy** — random valid moves
  - **Medium** — prefers low non-trumps, conservative trump usage
  - **Hard** — card counting, trump tracking, conditional take/defend strategy
- Logic lives in `backend/src/game/bot.js` (server-side, anti-cheat).

## Currency & economy

- **Daily bonus:** removed in the final economy.
- **Rewarded video bonus:** +800 virtual dollars / 6h. Only Rewarded Video is enabled; interstitial, app-open, and banner ads are disabled for the first release.
- **Win:** stake × player count
- **Referral:** direct invite = 5 virtual dollars, downstream levels = 1 virtual dollar after the referee plays 3 games.
- **Min bet:** 100 virtual dollars, max bet 1,000,000 virtual dollars.
- All coin movement goes through `services/coins.js` with row-level locking + transaction log.

## Premium subscription

- Tiers: monthly / 3-month / annual.
- **IAP integration:** client validates purchase receipts via **Google Play Billing** (Android) and **App Store StoreKit 2** (iOS). Server endpoint `/api/shop/verify-iap` checks receipt authenticity before granting.
- Benefits: unlimited AI helper, expanded voice chat, premium cosmetic access, profile badge, and premium emoji packs.

## Collections

- **50 emoji packs × 30 emoji each = 1,500 emoji.** Drop on game end (winners more likely). Duplicates increment quantity in `inventory`.
- **7 card skin packs.** Higher rarity wins display priority when multiple players bring custom skins.

## Rank / level system

- `rank_wins` increments every win.
- Visual lines/symbols computed client-side from `rank_wins`:
  - 1–399: white lines (every 100 wins)
  - 400+: white `+` symbols (every 4 lines)
  - 1200+: gold tier
  - then red, then black (every 3 `+`'s = next tier)

## Achievements (24+)

Win streaks (10/20/50/100), loss streaks (10/25), coin milestones (300/1k/10k/100k/1M), friend counts (10/50/100), games played (50/100/500/1k/10k), draws (10/50/100), Sheriff (5/25 bluff catches). See `backend/src/data/achievements.js`. Auto-checked after each game.

## Social

- Friend requests / accept / remove
- Friend search by username
- Online status (last activity within ~5m)
- Coin gifting (free)
- Item gifting requires owning the item (paid items must be purchased before gift)

### Chat rules

| Room size | Free user | Premium user |
|---|---|---|
| 2–3 players | text + emoji | + image + video |
| 4 players | emoji only | emoji only |

Server enforces rules in `backend/src/game/socket.js` (`chat:message` handler).

---

## REST API summary

See `docs/API.md` for full schema. Highlights:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | username + optional email + password |
| `POST` | `/api/auth/login` | — | identifier + password |
| `GET` | `/api/auth/me` | user | current user |
| `POST` | `/api/users/me/daily-bonus` | user | claim daily |
| `POST` | `/api/users/me/ad-bonus` | user | claim ad bonus |
| `GET` | `/api/users/leaderboard` | — | top players |
| `GET` | `/api/inventory/me` | user | owned items |
| `GET` | `/api/inventory/catalog` | — | all packs/skins |
| `POST` | `/api/shop/buy/emoji-pack` | user | spend coins for pack |
| `POST` | `/api/shop/buy/coin-bundle` | user | mock IAP credit |
| `POST` | `/api/shop/buy/premium` | user | mock subscription |
| `GET/POST` | `/api/friends/*` | user | social |
| `GET/POST` | `/api/admin/*` | admin | management |

## WebSocket events (`io` namespace `/`)

Authenticated via `auth: { token: <jwt> }`. Key events:

- `rooms:list` ↔ public room snapshots
- `room:create` `({ maxPlayers, stake, bluffEnabled, isPrivate, mode, botLevel })` → `{ ok, code }`
- `room:join` `({ code })` ↔ join existing
- `room:leave` `({ code })`
- `room:ready` `({ code, ready })`
- `room:state` ← lobby snapshot broadcast
- `game:start` ← initial state when game begins
- `game:action` `({ code, action: 'attack'|'defense'|'take'|'pass'|'challenge', payload })` ↔ apply move
- `game:move` ← server-authoritative state diff/full snapshot
- `game:timeout` ← turn timed out, server auto-played
- `game:end` ← final state
- `chat:message` `({ code, content, type: 'text'|'emoji'|'image'|'video' })`

State snapshots are filtered per-viewer: other players' hands are hidden, face-down bluff cards are hidden from non-bluffers.

---

## Configuration

All knobs in `.env` — see `.env.example`.

| Var | Default | Meaning |
|---|---|---|
| `JWT_SECRET` | `dev-secret-change-me` | signs auth tokens |
| `DATABASE_URL` | `postgres://durak:durak@postgres:5432/durak` | Postgres URL |
| `FIREBASE_PROJECT_ID` | — | Firebase project (Auth + optional Firestore) |
| `FIREBASE_CLIENT_EMAIL` | — | service-account email |
| `FIREBASE_PRIVATE_KEY` | — | service-account private key |
| `FCM_SERVER_KEY` | — | Firebase Cloud Messaging key for push |
| `GOOGLE_CLIENT_ID` | — | OAuth client ID (web) |
| `MIN_BET` | `5` | floor on stake |
| `DAILY_BONUS_COINS` | `10` | claim amount |
| `PREMIUM_DAILY_BONUS_COINS` | `20` | premium claim |
| `AD_BONUS_COINS` | `30` | watch-ad bonus |
| `AD_COOLDOWN_HOURS` | `6` | cooldown between ad claims |
| `REFERRAL_BONUS_COINS` | `5` | per-ancestor reward |
| `REFERRAL_GAMES_REQUIRED` | `3` | games before reward |
| `BOT_FILL_TIMEOUT_MS` | `30000` | matchmaking bot fill wait |
| `ADMIN_BOOTSTRAP_EMAIL` | `admin@durak.local` | first-run admin |
| `ADMIN_BOOTSTRAP_PASSWORD` | `changeme` | first-run admin password |

---

## Tests

```bash
cd backend && npm test
```

Includes unit tests for `deck.js` (deck integrity, beats logic) and `engine.js` (deal sizes, full round, viewFor masking, invalid attack rejection).

## Lint

```bash
cd backend && npm run lint
cd admin-panel && npm run lint
```

---

## Deploying to production

1. Set strong `JWT_SECRET` and admin password.
2. Use a managed Postgres (RDS / Cloud SQL / Supabase) and put its URL in `DATABASE_URL`.
3. Build & push the three Docker images (backend, web-client, admin-panel) — see `docs/DEPLOY.md`.
4. Front the web client with HTTPS (Cloudflare / nginx / ALB). The PWA service worker requires HTTPS to install.
5. Configure CORS via `CORS_ORIGIN` to match your client domain(s).

## External release setup

- **Real IAP receipts:** `/api/shop/verify-iap` validates through Google Play / App Store credentials when production env is configured.
- **Google Sign-In / Firebase Auth:** `google_id` and Firebase token verification are scaffolded in `services/auth.js`. Supply `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` in `.env` to activate.
- **Push notifications (FCM):** configure Firebase credentials before release.
- **AdMob rewarded video:** configure real `ADMOB_*` ids and block gambling/social casino categories in AdMob console.
- **Anti-cheat:** server-authoritative gameplay plus antibot scoring for speed, IP/device sharing, playtime, and repetitive patterns is included.
- **Card art / emoji PNGs.** Drop in real assets; the app references paths like `/emoji/pack_05/12.png`.

## License

MIT — see `LICENSE`.
