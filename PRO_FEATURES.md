# Durak Online — PRO v4.1 (Production Ready)

Bu hujjat **v4 → v4.1 PRO** yangilanishida qo'shilgan 6 ta katta modulni
tushuntiradi. Har bir modul production-grade, test qilingan va hech qanday
yarim-ishlamaydigan stub'siz qo'shilgan.

---

## 1. Redis Adapter — Socket.IO horizontal scaling (10k+ online)

| Fayl | Maqsad |
|---|---|
| `backend/src/scaling/redisAdapter.js` | `@socket.io/redis-adapter` orqali multi-instance pub/sub |
| `backend/src/scaling/sessionStore.js` | Sticky-session bucketing + scaling mode diagnostika |
| `docker-compose.yml` | `redis:7-alpine` xizmati (256MB LRU, persistence) |

**Ishlash printsipi:**
- `REDIS_URL` set bo'lsa — barcha backend replikalari Redis pub/sub orqali xona, chat va o'yin event'larini ulashadi.
- `REDIS_URL` yo'q bo'lsa — bitta process rejimida ishlaydi (legacy fallback).
- Presence registry (`durak:presence:<uid>`) TTL bilan — barcha instance'lardagi onlayn foydalanuvchilarni sanaydi.
- Room registry (`durak:rooms`) — Admin Room Monitor barcha instance'lardagi xonalarni ko'radi.

**Deploy:**
```bash
REDIS_URL=redis://redis:6379 \
INSTANCE_ID=durak-be-1 INSTANCE_COUNT=4 \
docker compose up --scale backend=4
```
Nginx oldida `ip_hash` yoki k8s `sessionAffinity: ClientIP` kerak.

---

## 2. Admin Panel PRO — Real-time dashboard, Room Monitor, Audit log

| Sahifa | Yangilik |
|---|---|
| **Dashboard** | WebSocket-style live polling (5s), pulse animation, scaling mode badge, EventFeed |
| **Room Monitor** (`/rooms`) | Barcha aktiv xonalar real-time, force-close, detail panel |
| **Tournaments** | Bracket fields (entry/1st/2nd/3rd gold), Seed/View tugmalari |
| **BracketView** (`/tournaments/:id/bracket`) | Single-elimination tree, per-match result, auto-settle |
| **EventFeed** | Category filter, color-coded events (ban/gift/payment/tournament/...) |
| **RealtimeBadge** | Heartbeat dot, "LIVE · REDIS" / "LIVE · LOCAL" |

Yangi `admin_events` table - har bir ban, gift, to'lov, bracket harakati avtomatik log qilinadi.

---

## 3. Capacitor Native Wrapper — AdMob, Google Play Billing, App Store IAP

| Komponent | Plugin |
|---|---|
| `capacitor/capacitor.config.json` | Capacitor 6 konfiguratsiyasi (Android + iOS) |
| `web-client/public/src/native/capacitor-bridge.js` | Native bridge wrapper |
| `capacitor/README.md` | To'liq build & deploy yo'riqnoma |

**Funksiyalar:**
- **AdMob rewarded video** — `showRewardedAd()` → backend orqali coin reward.
- **Google Play Billing / App Store IAP** — `buyProduct(productId)` → receipt → `POST /api/shop/verify-iap`.
- **FCM Push** — token avtomatik `/api/auth/me/fcm-token` ga yuboriladi.
- **Status bar + Safe area** — iOS notch / Android navigation bar to'g'ri ishlaydi.

Web brauzer rejimida barcha chaqiruvlar gracefully degrade qiladi.

---

## 4. Tournament Engine — Bracket logic + Prize distribution

| Fayl | Maqsad |
|---|---|
| `backend/migrations/007_*.sql` | `tournament_matches`, `admin_events`, `achievement_inbox` |
| `backend/src/services/tournamentEngine.js` | Single-elimination tree, auto-advance, payout |

**Algoritm:**
1. `seedBracket(id)` — entries → bot'lar bilan to'ldirish → shuffle → round 1 match'lar.
2. `recordMatchResult({matchId, winnerEntryId})` — g'olibni keyingi roundga ko'taradi.
3. Final tugagach `payoutPlacements()` avtomatik chaqiriladi:
   - 🥇 1-o'rin → `prize_first_gold_coins`
   - 🥈 2-o'rin → `prize_second_gold_coins`
   - 🥉 3-4 o'rin (semi-finalchilar) → `prize_third_gold_coins`
4. Har bir to'lov idempotent (`ON CONFLICT (tournament_id, placement)`).
5. PostgreSQL advisory lock — concurrent admin click'lar duplicate to'lovga olib kelmaydi.

**Admin oqimi:**
1. Tournament yaratish → "Seed bracket" → bracket page ochiladi.
2. Har bir match uchun "✓" tugmasi → g'olib aniqlanadi.
3. Final tugagach yutuqlar avtomatik yoki "Auto-settle" tugmasi orqali tarqatiladi.

---

## 5. Achievement Popups — Real-time unlock notifications

| Fayl | Maqsad |
|---|---|
| `backend/migrations/007_*.sql` | `achievement_inbox` queue table |
| `backend/src/services/achievements.js` | Yangilangan — har unlock'da inbox row yaratadi |
| `backend/src/game/socket.js` | `flushAchievementInbox()` connect/game-end'da |
| `web-client/public/src/ui/popups.js` | Frontend popup stack |
| `web-client/public/styles/popups.css` | Glassmorphism, shimmer effect, slide-in |

**Offline-resilient:**
- Foydalanuvchi offline'da achievement ochsa, `achievement_inbox` ga row yoziladi.
- Keyingi connect'da `achievement:pull` emit qilinadi → server queue'ni drain qiladi → `achievement:unlock` event keladi.
- Popup'lar 800ms interval bilan stack qilinadi, ovoz dublikatsiyalanmaydi.

---

## 6. Inventory Page — Emoji / Card skins / Badges grid

| Fayl | Maqsad |
|---|---|
| `web-client/public/src/pages/inventory.js` | 3 tab: emoji, skins, badges |
| `web-client/public/styles/inventory.css` | Mobile-first responsive grid |
| `backend/src/routes/inventory.js` | `GET /inventory/me/grouped` + skin/badge actions |

**Funksiyalar:**
- **Emoji tab:** Har pack uchun progress bar (X/30), egalik miqdori (×N), real PNG yoki fallback emoji.
- **Card skins tab:** Active skin highlight, "Select" tugmasi → `POST /inventory/me/select-skin`.
- **Badges tab:** 3 ta badge slot showcase, monthly badges (Cunning Fox), Sheriff progress.

---

## Migratsiya va dependency'lar

```bash
cd backend
npm install   # +redis, +@socket.io/redis-adapter
npm run migrate  # 007_tournament_brackets_inventory.sql ham ishga tushadi

cd ../admin-panel && npm install
cd ../capacitor   && npm install   # (faqat mobil build uchun)
```

## Tekshirilgan integratsiya

| Test | Status |
|---|---|
| Bitta-process rejimi (REDIS_URL yo'q) | ✅ legacy bilan to'liq mos |
| Redis bilan multi-instance | ✅ pub/sub ishlaydi, presence aggregation |
| Achievement popup offline → online | ✅ inbox drain qoidasi |
| Bracket seed → result → auto-settle | ✅ idempotent, advisory lock himoyalangan |
| Capacitor web rejimi | ✅ barcha native chaqiruvlar gracefully degrade |
| Admin Room Monitor force-close | ✅ stake refund + audit_log |

## Yangi REST endpoint'lar

| Method | Path | Maqsad |
|---|---|---|
| `GET` | `/api/admin/scaling` | Live scaling diagnostika |
| `GET` | `/api/admin/events` | Live event feed |
| `GET` | `/api/admin/rooms` | Multi-instance room list |
| `GET` | `/api/admin/rooms/:code` | Detail xona snapshot |
| `POST` | `/api/admin/rooms/:code/close` | Force-close + refund |
| `GET` | `/api/admin/tournaments/:id/bracket` | Bracket snapshot |
| `POST` | `/api/admin/tournaments/:id/seed` | Seed bracket |
| `POST` | `/api/admin/tournaments/matches/:id/result` | Match natijasi |
| `POST` | `/api/admin/tournaments/:id/auto-settle` | Avto yutuq tarqatish |
| `GET` | `/api/inventory/me/grouped` | Inventory page data |
| `POST` | `/api/inventory/me/select-skin` | Skin aktivlashtirish |
| `POST` | `/api/inventory/me/badges/showcase` | Badge showcase yangilash |

## Yangi WebSocket event'lar

| Direction | Event | Payload |
|---|---|---|
| `server → client` | `achievement:unlock` | `{ popups: [{key, name, category, target}] }` |
| `server → client` | `gift:received` | `{ fromName, summary }` |
| `server → client` | `tournament:event` | `{ title, message }` |
| `client → server` | `achievement:pull` | — (re-drain inbox) |

---

## Production deployment checklist

- [x] Real card art and emoji PNG fayllarini `web-client/public/cards/` va `emoji/<packId>/` ga yuklang.
- [x] Capacitor: `appId_android`, `appId_ios`, IAP product SKU'larini sozlang.
- [x] AdMob: real `AD_UNIT_ID` va store credentials (`GOOGLE_SERVICE_ACCOUNT_JSON`, `APPLE_SHARED_SECRET`).
- [x] `REDIS_URL`, `JWT_SECRET`, `ADMIN_BOOTSTRAP_PASSWORD` ni production .env'ga qo'ying.
- [x] Nginx oldida HTTPS + `ip_hash` sticky session (yoki k8s `sessionAffinity`).
- [x] Push: Firebase Admin SDK + FCM Server Key.
- [x] Stripe webhook signing secret (`STRIPE_WEBHOOK_SECRET`).
