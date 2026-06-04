# Durak Online — Bug Fix Pass

Tuzatilgan muammolar (15 ta). Hammasi backend testlari (`npm test` → 26/26) va
lint (`npm run lint` → 0 errors) bilan tasdiqlangan.

## KRITIK (4)

### 1. Login/Register route'lari yo'q edi
`backend/src/services/auth.js` da `register()`/`login()` funksiyalari yozilgan
edi, lekin `routes/auth.js` ulardan POST endpoint chiqarmagan. Endi:

* `POST /api/auth/register` — username/email/password ro'yxatdan o'tkazish
* `POST /api/auth/login` — username/email + password kirish

Ikkalasi ham `index.js` dagi `strictAuthLimiter` (15 daqiqada 10 urinish) bilan
himoyalangan. Fayllar: `backend/src/routes/auth.js`.

### 2. 6-player xona yaratib bo'lmasdi
Socket layer'da `Math.min(4, ...)` qattiq kodlangan edi — config va engine
qo'llab-quvvatlasa ham. Endi `Math.min(6, ...)` va engine/Room konstruktori
`config.game.allowedTableSizes` (2/3/4/6) bilan tasdiqlaydi. Fayl:
`backend/src/game/socket.js`.

### 3. Snapshot + finishGame INSERT duplicate key
Har 60 soniyada bo'ladigan snapshot allaqachon `INSERT ... ON CONFLICT DO
UPDATE` qilgan id'ni `finishGame()` ON CONFLICT'siz qayta INSERT qilgan →
duplicate_key. Natijada o'yin yakuni saqlanmagan. Tuzatildi: finishGame ham
endi `ON CONFLICT (id) DO UPDATE` qiladi (winner_id, loser_id, is_draw,
final_state, ended_at maydonlarini yangilaydi). Fayl:
`backend/src/game/room.js`.

### 4. Pot bot pullari bilan to'lganadigan edi
`pot = stake × players.length` (bot'lar bilan birga) hisoblanardi, lekin
stake faqat real foydalanuvchilardan olinardi. 2 inson + 2 bot, stake=1000 →
2 000 olib, 4 000 to'langan. Endi `pot = stake × allHumans.length`. Fayl:
`backend/src/game/room.js`.

## YUQORI (6)

### 5. passAttack deadlock
Agar barcha hujumchilar pass qilsa-yu stolda yutilmagan kartalar qolsa
(allDone=true, allBeaten=false), endRound chaqirilmasdi va o'yin
defender'ning 30s timer'iga qarab qotib qolardi. Endi bu holatda defender
avtomatik "oladi" (`endRound(state, { defenderTook: true })`). Fayl:
`backend/src/game/engine.js`.

### 6. Production API URL noto'g'ri
Web-client'ning `nginx.conf` da backend uchun proxy yo'q edi va `api.js`
to'g'ridan-to'g'ri `hostname:4000` ga ulanardi → port 4000 ochiq emas bo'lgan
deploymentlarda hech narsa ishlamasdi. Endi:

* `nginx.conf` da `/api/` va `/socket.io/` lokatsiyalari `backend:4000` ga
  proxy qiladi (WebSocket upgrade headers bilan).
* `api.js` defaultda same-origin path'larni ishlatadi (faqat `localhost`
  rejimida `http://localhost:4000`).
* `socket.js` API_BASE bo'sh bo'lsa `window.io()` ni argumentsiz chaqiradi.

Fayllar: `web-client/nginx.conf`, `web-client/public/src/api.js`,
`web-client/public/src/socket.js`.

### 7. `socket.user.coins` eskirgan edi
Socket ulanish vaqtidagi balans ishlatilardi → o'yindan keyin kirgan xona
eski balans bilan tekshiriladi. Endi `room:create` va `room:join`
DB'dan jonli balansni o'qiydi (`getCurrentCoins(userId)`). Fayl:
`backend/src/game/socket.js`.

### 8. `player:speech` server emit qilmasdi
Klient `player:speech` eventini tinglaydi (nutq balonchiklari), lekin server
hech qachon emit qilmasdi → animatsiyalar ko'rinmasdi. Endi `room.js` da
`emitSpeechFor(playerId, action)` har bir attack/defense/take/pass dan keyin
chaqiriladi va `kind: 'attack'|'defended'|'take'|'pass'` jo'natadi. Fayl:
`backend/src/game/room.js`.

### 9. `replaceWithBot` disconnect'da await'siz
Async funksiyani await'siz chaqirgani bot joy olishdan oldin o'yin davom
etsa muammoga olib keladi. Endi `await room.replaceWithBot(idx)` (errorni
ham log qiladi). Fayl: `backend/src/game/socket.js`.

### 10. Chat har xabarda DB so'rovi (premium tekshiruvi)
Har chat xabarida `SELECT premium_until` so'rovi → yuqori trafikda yuk.
Endi 60 soniyalik in-memory cache (`premiumCache: Map`) ishlatiladi.
Disconnect'da cache tozalanadi. Fayl: `backend/src/game/socket.js`.

## O'RTA (5)

### 11. JWT_SECRET production xavfi
`docker-compose.yml` da `${JWT_SECRET:-dev-secret-change-me}` fallback edi.
Endi `${JWT_SECRET:?...}` — set qilinmasa, deploy fail bo'ladi. Xuddi shu
narsa `ADMIN_BOOTSTRAP_PASSWORD` uchun ham. `config.js` allaqachon
production'da default secret bo'lsa o'lib qolardi (saqlangan), shuningdek
endi `CORS_ORIGIN='*'` haqida warning chiqaradi. Fayllar: `docker-compose.yml`,
`backend/src/config.js`, `.env.example`.

### 12. `isWinner` mantiqiy xatosi — draw holatida winner noto'g'ri
Durak draw bo'lganida `winners[0] === p.id` true bo'lib, ayni paytda
`isDrawer=true` ham bo'lardi → `games_won` ham, `games_draw` ham ortardi.
Endi `isDrawer` true bo'lsa `isWinner=false` va `isLoser=false`. Fayl:
`backend/src/game/room.js`.

### 13. Service worker main.js ni keshlardi
`fetch` eventda har qanday 200 javob keshga yozilardi → main.js, styles.css
yangilansa eski versiya yuklanardi. Endi:

* `CACHE = 'durak-v4'` (bump qilindi, eski cache'ni o'chirish uchun).
* `NETWORK_FIRST_PATHS` (`/styles.css`, `/src/`, `/i18n/`) — har doim
  tarmoqdan, faqat offline fallback.
* `/api/`, `/socket.io/` — keshlanmaydi.
* Static shell (icon'lar, manifest, /) — cache-first.

Fayl: `web-client/public/service-worker.js`.

### 14. Ad bonus cap juda past
Capping balans 1 000 $ bo'lgan edi → bitta o'yin yutgan ham (minBet=100,
g'olib 200+ oladi) cap'dan oshib ad bonus ololmaydi. Endi default 50 000 $.
`AD_BALANCE_CAP` env bilan o'zgartirsa bo'ladi. Test ham yangilandi.
Fayllar: `backend/src/config.js`, `backend/tests/v4_spec.test.js`.

### 15. CORS origin default `*`
Production'da `'*'` xavfsizlik muammosi. `config.js` warning chiqaradi va
`docker-compose.yml` da default `http://localhost:8080` ga o'zgartirildi.
Fayllar: `backend/src/config.js`, `docker-compose.yml`.

## Audit pass — qo'shimcha tuzatishlar (post-15)

Yuqoridagi 15 ta bug tuzatilgandan keyin loyiha to'liq audit qilindi.
Quyidagi qo'shimcha xavfsizlik / barqarorlik kamchiliklari topildi va
tuzatildi:

### 16. Real-pul endpoint'lari production'da blok qilindi
`POST /api/shop/buy/coin-bundle` va `/buy/gold-bundle` test maqsadida
to'lovsiz coin/oltin berardi — bu production'da bepul pul kanali edi.
Endi `ALLOW_DEV_PURCHASES=1` va `NODE_ENV!=production` bo'lmasa 403
qaytaradi. Real to'lov `POST /api/shop/verify-iap` (verified IAP) yoki
Stripe webhook orqali bo'ladi. Xuddi shu sababdan `POST /api/donations/`
ham gate qilindi. Fayllar: `backend/src/routes/shop.js`,
`backend/src/routes/donations.js`.

### 17. Ad bonus race condition (atomic claim)
Eski mantiq: `SELECT last_ad_at` → JS'da tekshirish → `UPDATE`. Ikki
parallel so'rov bir vaqtda o'tishi mumkin edi (bonus ikki marta). Endi
bitta `UPDATE … WHERE cooldown_passed AND balance_under_cap` atomik —
ikkinchi so'rov noma'lum natijasiz to'xtaydi. Fayl:
`backend/src/routes/users.js`.

### 18. transferCoins deadlock
Concurrent A→B va B→A o'tkazmalar PostgreSQL deadlock'ga olib kelardi.
Endi har ikkala satr `SELECT … WHERE id IN ($1,$2) ORDER BY id FOR UPDATE`
bilan deterministik ID tartibida bloklanadi. Self-transfer ham bloklandi.
Fayl: `backend/src/services/coins.js`.

### 19. Stripe webhook duplikatsiya
Stripe non-2xx javobda webhook'ni qayta yuboradi. Eski kod har safar
coins berib qoyardi. Endi `transactions.metadata.stripeSessionId` orqali
duplikat tekshiriladi va premium grant ham idempotency uchun ledger
yozuvini saqlaydi. Fayl: `backend/src/routes/payments.js`.

### 20. CSP va xavfsizlik header'lari (frontend)
Backend `helmet` bilan API javoblarni himoyalaydi, lekin nginx orqali
beriladigan statika (index.html, manifest, JS bundle) o'z header'larisiz
edi. Endi `nginx.conf` da `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` va to'liq CSP qo'shildi
(jsdelivr, gstatic, Google Fonts CDN'lariga ruxsat berilgan). Fayl:
`web-client/nginx.conf`.

### 21. Test xatoligi (flaky)
`engine: invalid attack rank rejected` testi `attacker.hand[0]` ga splice
qilingandan keyin murojaat qilardi — natija deterministik emas edi.
Endi karta splice oldidan kapture qilinadi. Fayl: `backend/tests/engine.test.js`.

### 22. Lint preexisting warning'lari tozalandi
`eslint.config.js` ga `caughtErrorsIgnorePattern` va
`destructuredArrayIgnorePattern` qo'shildi (`_` va `err` ga ruxsat).
`bot.js`, `googleAuth.js`, `engine.test.js` da ishlatilmagan o'zgaruvchilar
olib tashlandi. `config.js` da kerakli `// eslint-disable` direktivlari
soddalashtirildi. Natija: **0 errors, 0 warnings**.

## Texnik tasdiq

| Test                            | Status              |
|---------------------------------|---------------------|
| `cd backend && npm test`        | **26/26 pass**      |
| `cd backend && npm run lint`    | **0 errors, 0 warnings** |
| `grep -r TODO\|FIXME\|XXX src/` | **0 matches**       |
| Backend `console.log` (user code) | **0** (faqat `logger.*` ishlatiladi) |
| Frontend `console.log` (user code) | **0** (faqat `console.error` legitimate error handling) |

## Dizayn (rasmlar 1-8) haqida

Yuborilgan UI rasmlar — Settings (Til/Preferences/Account), Do'kon
(Emoji/Premium/Dollar/Gold), Profil, Stol yaratish, Stollar lobby, Bosh menyu,
O'yin stoli — bularning HTML/CSS versiyasi mavjud sahifalarda allaqachon bor
(`web-client/public/src/pages/{settings,shop,profile,room,lobby,home,game}.js`).
Ammo rasmlarda ko'rinadigan to'liq native-mobil ko'rinish (oltin ramkalar,
yog'och teksturalar, dekorativ shtrihlar) bu sessiyaning scope'idan tashqari
— bu menyu/HUD redesign katta vizual ish va ehtimol Phaser/Cordova native
shell, asset paketlari, mobil layout tunings talab qiladi. Hozir 15 ta kod
bug'i tuzatildi; vizual redesign alohida vazifa sifatida amalga oshirilishi
kerak.
