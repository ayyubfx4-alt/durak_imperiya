# Durak Online — REST API

All requests use JSON. Authenticated endpoints require `Authorization: Bearer <jwt>`.

## Auth

### `POST /api/auth/google` — *Google Sign-In*
**Body:** `{ idToken }` (Firebase `id_token` from the client SDK)
**Response:** `{ user: { id, nickname, displayName, avatarUrl, coins, ... }, token, isNewUser }`

If `isNewUser` is `true` the client must redirect to the **nickname selection screen** before entering the game.

### `GET /api/auth/nickname/check?nick=anvar`
Returns `{ available: true }` or `{ available: false }`. No auth required.

### `POST /api/auth/nickname` *(auth, new-user only)*
**Body:** `{ nickname }` — sets the unique @nickname on first login. Returns 409 if already taken.

### `GET /api/auth/me` *(auth)*
Returns the current user including `nickname`, `avatarUrl`, `locale`, `coins`, stats, `premium_until`, `badges_showcase`, `selected_skin`.

### `POST /api/auth/me/locale` *(auth)*
**Body:** `{ locale: "uz" | "ru" | "en" }` — saves the user's language preference.

### `POST /api/auth/me/fcm-token` *(auth)*
**Body:** `{ token, platform: "android" | "ios" | "web" }` — registers / refreshes the FCM push token.

### `POST /api/auth/me/skin` *(auth)*
**Body:** `{ skin: "default" | "neon_arcade" | ... }` — must be owned in inventory.

### `POST /api/auth/me/badges` *(auth)*
**Body:** `{ badges: ["streak_win_10", ...] }` (max 3)

## Users

### `GET /api/users/leaderboard?limit=50`
Top players by `rank_wins`.

### `GET /api/users/profile/:id`
Public profile of any user.

### `POST /api/users/me/daily-bonus` *(auth)*
Claims daily bonus. Returns 429 if cooldown active.
Premium users get double.

### `POST /api/users/me/ad-bonus` *(auth)*
Claims ad bonus. 6h cooldown by default.

## Inventory & catalog

### `GET /api/inventory/me` *(auth)*
List of owned items: `{ item_type, item_id, quantity, obtained_at }[]`.

### `GET /api/inventory/catalog`
Full list of all 50 emoji packs and 7 card skins with rarity/premium flags.

### `GET /api/inventory/catalog/emoji-pack/:id`
Returns the 30 emoji of a pack including image paths.

## Shop

### `GET /api/shop/coin-bundles`
Returns coin-purchase tiers (mock IAP).

### `GET /api/shop/premium-tiers`
Returns premium subscription tiers.

### `POST /api/shop/buy/emoji-pack` *(auth)*
**Body:** `{ packId }` — debits coins (price by rarity), grants all 30 emoji to inventory.

### `POST /api/shop/buy/card-skin` *(auth)*
**Body:** `{ skinId }` — debits coins (price by rarity).

### `POST /api/shop/buy/coin-bundle` *(auth)*
**Body:** `{ bundleId }` — credits coins. Requires successful receipt verification (see `/api/shop/verify-iap`).

### `POST /api/shop/buy/premium` *(auth)*
**Body:** `{ tierId }` — extends `premium_until`. Requires successful receipt verification.

### `POST /api/shop/verify-iap` *(auth)*
**Body:** `{ platform: "android" | "ios", receipt, productId }`
Verifies the purchase receipt via **Google Play Developer API** (Android) or **App Store Server API** (iOS), then credits the appropriate coins / premium days. Returns `{ ok, credited }`. Never call ship without this verification.

## Friends

### `GET /api/friends/list` *(auth)*
Friends with `status` (`pending` / `accepted`).

### `GET /api/friends/search?nick=anvar` *(auth)*
Search by `@nickname` (case-insensitive prefix match). Also accepts `?q=name` for display-name fallback.

### `POST /api/friends/request` *(auth)*
**Body:** `{ friendId }`

### `POST /api/friends/accept` *(auth)*
**Body:** `{ friendId }`

### `POST /api/friends/remove` *(auth)*

### `POST /api/friends/gift/coins` *(auth)*
**Body:** `{ friendId, amount }` — atomic transfer; both parties must be `accepted` friends.

## Games

### `GET /api/games/me/recent` *(auth)*
Last 25 games of the current user.

### `GET /api/games/me/achievements` *(auth)*
Unlocked achievement keys + timestamps.

## Admin *(admin only)*

### `GET /api/admin/stats`
**Response:** `{ users, games, activeGames, coinsPurchased, onlineApprox }`

### `GET /api/admin/users?q=&limit=50&offset=0`

### `POST /api/admin/users/:id/ban` — body `{ reason }`
### `POST /api/admin/users/:id/unban`
### `POST /api/admin/users/:id/coins` — body `{ amount }` (positive credit, negative debit)
### `POST /api/admin/users/:id/premium` — body `{ days }`
### `GET /api/admin/games?limit=50`
### `GET /api/admin/audit?limit=100`

All admin actions are logged to `audit_log` with admin id, action, target, and metadata.

---

## WebSocket protocol

Connect to the same backend host with `Authorization` via Socket.IO `auth.token`.

```js
const socket = io("https://api.example.com", { auth: { token: "<jwt>" } });
socket.emit("rooms:list");
socket.on("rooms:list", (rooms) => { /* ... */ });
socket.emit("room:create", { maxPlayers: 2, stake: 5 }, (resp) => {
  if (resp.ok) socket.emit("room:ready", { code: resp.code, ready: true });
});
socket.on("game:start", (snapshot) => { /* render */ });
socket.on("game:move", (snapshot) => { /* re-render */ });
socket.emit("game:action", { code, action: "attack", payload: { card: "AS" } });
```

### State snapshot shape (per-viewer)

```ts
{
  id: string,
  trumpSuit: 'S'|'H'|'D'|'C',
  trumpCard: { rank, suit, value },
  deckSize: number,
  discardSize: number,
  phase: 'attacking'|'defending'|'ended',
  attackerIdx: number,
  defenderIdx: number,
  table: [{ attack: Card | { faceDown: true }, defense: Card | null, claimedRank?: string }],
  players: [{
    id: string,
    username: string,
    isBot: boolean,
    handSize: number,
    hand?: Card[],     // present only for the viewer
    out: boolean,
    bluffsCaught: number,
  }],
  winnerOrder: string[],
  durakId: string | null,
}
```

Cards: `{ rank: '6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A', suit: 'S'|'H'|'D'|'C', value: 6..14 }`.

Card IDs (used in `game:action` payloads): rank + suit, e.g. `"AS"`, `"TH"`, `"6C"`.
