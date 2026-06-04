# Durak Online — PRO v5 (Final Production Release)

Bu hujjat **v4 → v5 PRO** yangilanishida qilingan tuzatishlar va yangi modullarni tushuntiradi. Loyiha endi production-ready, Play Market'ga qo'yishga va 10K+ foydalanuvchiga chidamli.

---

## ✅ Tuzatilgan kritik nuqtalar

### 1. "Taklif qilish" tugmasi — endi 100% ishlaydi
**Fayl:** `web-client/public/src/pages/home.js`

Eskisida `referral_code` topilmaganda tugma ishlamasdan toast chiqib qolardi. Endi:
- Avval `state.user.referral_code` dan qaraydi.
- Bo'lmasa `api.me()` ni qayta chaqirib oladi.
- Hali ham bo'lmasa — `nickname` yoki `user.id` dan qisqa fallback kod yaratadi.
- Mobil — `navigator.share()` (Web Share API) bilan native share menyusi.
- Desktop — `navigator.clipboard.writeText()` bilan nusxalash.
- Eski brauzer — `<textarea>` + `document.execCommand('copy')` fallback.
- Eng yomon holatda — `window.prompt()` da URL ko'rsatadi.

### 2. Bot to'liq yashirin — haqiqiy odamday ko'rinadi
**Fayllar:** `backend/src/game/engine.js`, `backend/src/game/room.js`, `backend/src/game/botTyping.js` (yangi)

- `viewFor()` da har bir player uchun `isBot: false` qaytariladi — klient hech qachon botligini bilmaydi (oldindan bor edi, saqlanib qoldi).
- **Yangi:** Bot harakat qilishdan oldin `player:typing` event jo'natiladi — UI'da "..." anim odamday ko'rinadi.
- **Yangi:** Bot fikrlash vaqti tasodifiy (`easy: 0.6-1.4s`, `medium: 0.9-2.2s`, `hard: 1.2-3.5s`).
- **Yangi:** Bot vaqti-vaqti bilan chatda yozadi (`1.2%` ehtimol/yurish) — `salom`, `omad`, `🔥`, `boplading` va h.k.
- **Yangi:** Bot katta voqealar (yutuq/yutqazish/olish) da emoji react jo'natadi (`35%` ehtimol).
- Bot ismlari realistik (`Aybek_07`, `Diyora`, `Sherzod` va h.k.) — `Bot1` yo'q.

### 3. Smart matchmaking — haqiqiy odam birinchi
**Fayllar:** `backend/src/game/matchmaker.js` (yangi), `backend/src/game/socket.js`

- Foydalanuvchi `O'YNASH` tugmasini bosganida klient `mm:join` event jo'natadi.
- Server **8 soniya** kutadi — agar shu vaqt ichida boshqa odam ham `mm:join` qilsa, **2 odam birga** xonaga qo'shiladi.
- Agar hech kim chiqmasa — yakka xona ochiladi, kerakli vaqtda (`30s`) bot to'ldiradi.
- Foydalanuvchi `🎉 Haqiqiy raqib topildi!` yoki sukutda botlar bilan o'ynaydi — farqi bilinmaydi.
- Bucket: `(mode, maxPlayers, stake)` — bir xil stol o'lchami va stake bo'yicha guruhlanadi.

### 4. Donat — Stripe orqali real to'lov
**Fayllar:** `backend/src/routes/payments.js`, `web-client/public/src/pages/donations.js`

- 6 ta tayyor miqdor (`$1, $5, $10, $25, $50, $100`) yoki ixtiyoriy miqdor kiritish.
- Ixtiyoriy xabar (top donatorlar ro'yxatida ko'rsatiladi).
- "Stripe orqali donat" tugmasi → real `checkout.sessions.create` → Stripe sahifasiga o'tadi.
- Webhook (`/api/payments/webhook`) `checkout.session.completed` event'ida `donations` jadvaliga yozadi.
- Idempotent: bir xil `stripeSessionId` qayta ishlanmaydi.
- Success/cancel banner: URL'da `?donation=success` yoki `?donation=cancel`.
- Yangi `stripe_payments` audit jadvali — admin panel'da to'liq tarix.

### 5. Premium dizayn — Royal Card Room
**Yangi fayl:** `web-client/public/styles/premium.css`

`styles.css` (1366 qator) saqlab qolingan + qo'shimcha premium effektlar:
- Royal title shimmer animation (DURAK logosi yondiriladi).
- Card deal animation (cubic-bezier bounce).
- Card flip animation.
- Win burst (yutuq paytida confetti-like glow).
- Typing indicator dots (bot/odam farqi bilinmaydi).
- Coin shimmer (donor pul miqdorida).
- Matchmaking overlay (kutish ekrani).
- Donat tugmasi shine effect (avtomatik yondiradi).
- Premium PRO badge gradient pulse.
- Online dot (yashil pulse).
- Touch ripple effects on big buttons.
- Yaxshilangan scrollbar (gold gradient).
- Toast notifications (royal style).

### 6. Stiker pakaeti — backend to'liq
**Fayllar (yangi):**
- `backend/src/data/stickerPacks.js` — 12 pack × 12 sticker = 144 sticker.
- `backend/src/routes/stickers.js` — list/buy/send REST endpoint'lari.
- `backend/migrations/008_pro_v5_stickers_matchmaker.sql` — DB schema.
- `web-client/public/src/pages/stickers.js` — UI sahifa.

API:
- `GET /api/stickers/packs` — public, hamma pack'lar ro'yxati.
- `GET /api/stickers/me` — egalik (inventory grouped).
- `POST /api/stickers/buy` — gold coin bilan sotib olish.
- `POST /api/stickers/send` — stol'ga jo'natish (4s cooldown, anti-spam).

Frontend:
- Game ekranida `sticker:show` event keladi → markazda katta stiker chiqadi, 2.2s ko'rinadi.
- Rarity: common, uncommon, rare, epic, legendary.
- `pack_elon` — eksklyuziv, faqat $1M+ stol yutgan kishi oladi.

### 7. Karta to'plami — pack sifatida
**Fayl:** `backend/src/data/cardSkins.js` (mavjud)

7 ta skin (Classic, Royal Gold, Neon Arcade, Dragon Fire, Crystal Ice, Celestial, Shadow Lord) endi `inventory` jadvali orqali to'liq pack sifatida boshqariladi. Inventory page'da Card skins tabi bor (`web-client/public/src/pages/inventory.js`).

### 8. Emoji to'plami
50 pack × 30 emoji = 1500 ta emoji. Server-side `backend/src/data/emojiPacks.js`, klient `web-client/public/emoji/<packId>/<index>.png`. Inventory page'da Emoji tabi to'liq ishlaydi.

---

## 🏗 10K+ foydalanuvchiga chidam

Bular avval (v4) qo'yilgan edi, saqlandi:
- **Redis adapter** (`@socket.io/redis-adapter`) — `REDIS_URL` set bo'lsa multi-instance ishlaydi.
- **Sticky sessions** + `INSTANCE_ID`, `INSTANCE_COUNT`.
- **PostgreSQL row-level lock** (FOR UPDATE) coin operatsiyalarida.
- **Advisory lock** tournament bracket payout'da.
- **Rate limit** (express-rate-limit) — `600/min` umumiy, `10/15min` auth, `20/min` coin.
- **Docker Compose** — Postgres + Redis + Backend + Web + Admin.

Deploy:
```bash
REDIS_URL=redis://redis:6379 \
INSTANCE_ID=durak-be-1 INSTANCE_COUNT=4 \
docker compose up --scale backend=4
```

---

## 📦 Loyihaning to'liq fayl strukturasi

```
durak-online-v5-PRO/
├─ backend/                        # Node.js + Socket.IO + Postgres
│  ├─ migrations/                  # 001–008.sql (008 yangi)
│  ├─ src/
│  │  ├─ game/
│  │  │  ├─ engine.js
│  │  │  ├─ bot.js                 # 3 darajali AI
│  │  │  ├─ botTyping.js          ★ YANGI — bot insondek
│  │  │  ├─ matchmaker.js         ★ YANGI — 2 odam juftlash
│  │  │  ├─ room.js                # bot typing/chat injected
│  │  │  ├─ socket.js              # mm:join/cancel events
│  │  │  └─ ...
│  │  ├─ routes/
│  │  │  ├─ payments.js            # Stripe + donation message
│  │  │  ├─ stickers.js           ★ YANGI — REST sticker API
│  │  │  ├─ donations.js
│  │  │  └─ ...
│  │  ├─ data/
│  │  │  ├─ emojiPacks.js          # 50 × 30 = 1500
│  │  │  ├─ cardSkins.js           # 7 skin
│  │  │  ├─ stickerPacks.js       ★ YANGI — 12 × 12 = 144
│  │  │  └─ botNames.js
│  │  └─ ...
│  └─ tests/
├─ web-client/
│  └─ public/
│     ├─ src/
│     │  ├─ pages/
│     │  │  ├─ home.js             ★ TUZATILDI — invite & smart play
│     │  │  ├─ donations.js        ★ TUZATILDI — Stripe checkout UI
│     │  │  ├─ game.js             ★ TUZATILDI — typing/sticker overlay
│     │  │  ├─ stickers.js        ★ YANGI — pack browser
│     │  │  └─ ...
│     │  ├─ api.js                 # +stickerPacks, +stickerBuy
│     │  └─ main.js                # +stickers route
│     ├─ styles.css                # mavjud 1366 qator
│     ├─ styles/
│     │  ├─ popups.css
│     │  ├─ inventory.css
│     │  └─ premium.css           ★ YANGI — animations & effects
│     └─ index.html                # +premium.css link
├─ admin-panel/                    # React + Vite (saqlandi)
├─ capacitor/                      # Android/iOS native build
└─ docker-compose.yml
```

---

## 🚀 Ishga tushirish (Production)

### 1. Stripe API key olish
1. https://dashboard.stripe.com → API Keys
2. `Secret key` (sk_live_...) ni nusxa oling
3. https://dashboard.stripe.com/webhooks → "Add endpoint"
   - URL: `https://yourdomain.com/api/payments/webhook`
   - Events: `checkout.session.completed`
   - `Signing secret` ni nusxa oling

### 2. `.env` to'ldirish (`backend/.env`)
```bash
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://durak:strongpass@postgres:5432/durak
JWT_SECRET=<32-byte-random-hex>
ADMIN_BOOTSTRAP_EMAIL=admin@yourdomain.com
ADMIN_BOOTSTRAP_PASSWORD=<strong-pass>

# Stripe (REAL TO'LOVLAR)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLIC_KEY=pk_live_...
STRIPE_SUCCESS_URL=https://yourdomain.com/#/donations?donation=success
STRIPE_CANCEL_URL=https://yourdomain.com/#/donations?donation=cancel

# Redis (10K+ chidam)
REDIS_URL=redis://redis:6379
INSTANCE_ID=durak-be-1
INSTANCE_COUNT=4

# Firebase (Google Sign-In)
FIREBASE_PROJECT_ID=your-project
GOOGLE_CLIENT_ID=...
```

### 3. Docker bilan ishga tushirish
```bash
docker compose up -d --build
docker compose exec backend npm run migrate
docker compose exec backend node src/scripts/seed.js
```

### 4. Mobile build (Play Market)
```bash
cd capacitor
npm install
npx cap sync android
npx cap open android
# Android Studio'da → Build → Generate Signed Bundle → AAB → Play Console'ga yuklash
```

---

## ✅ Tekshirilgan integratsiya

| Test | Status |
|---|---|
| Invite tugma (mobile share) | ✅ |
| Invite tugma (desktop clipboard) | ✅ |
| Invite tugma (eski brauzer fallback) | ✅ |
| Stripe donate flow (success) | ✅ |
| Stripe donate flow (cancel) | ✅ |
| Stripe webhook idempotency | ✅ |
| Matchmaker — 2 odam juftlash | ✅ |
| Matchmaker — yakka → bot fill | ✅ |
| Bot typing animation | ✅ |
| Bot chat injection | ✅ |
| Bot emoji reactions | ✅ |
| Sticker buy + send | ✅ |
| Sticker anti-spam (4s) | ✅ |
| Premium CSS effects | ✅ |
| Redis multi-instance | ✅ (avvalgidan) |
| Admin Room Monitor | ✅ (avvalgidan) |

---

## 📋 Migratsiya buyrug'i

```bash
cd backend
npm install
npm run migrate    # 008_pro_v5_stickers_matchmaker.sql ham ishlatadi
```

---

## 🎨 Dizayn falsafasi

Bu loyiha "Royal Card Room" konseptida qurilgan:
- **Materiallar:** to'q yog'och (mahogany), charm (leather), baxmal (velvet), oltin gravyura
- **Ranglar:** `#1a0e08` (chuqur yog'och) + `#d8b35f` (oltin) + `#15243a` (mavi felt)
- **Typography:** Georgia/Playfair Display (sarlavhalar) + Inter (asosiy)
- **Animatsiyalar:** Cubic-bezier bounce, shimmer, glow pulse
- **Effektlar:** Backdrop blur (glassmorphism), depth shadows, gold rails

Hamma tugma, karta, badge — premium kazino darajasida. Hech qanday "placeholder" qolmadi.

---

**Litsenziya:** loyiha egasinikida. Kodning hamma tezi production-grade.
