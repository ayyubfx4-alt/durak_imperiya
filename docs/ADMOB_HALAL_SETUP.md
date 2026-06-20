# AdMob Rewarded Video Production Setup

Durak Imperia uses Rewarded Video only. Do not enable Banner, Interstitial,
Rewarded Interstitial, or App Open units for the first Play Market release.

## Required AdMob Values

Create these in Google AdMob and put them in the production `.env`:

- `ADMOB_ANDROID_APP_ID`: Android app id, format `ca-app-pub-...~...`
- `ADMOB_REWARDED_ANDROID_ID`: Android rewarded unit id, format `ca-app-pub-.../...`
- `ADMOB_IOS_APP_ID`: optional, only when iOS is released
- `ADMOB_REWARDED_IOS_ID`: optional, only when iOS is released
- `ADMOB_HALAL_CATEGORIES_BLOCKED=1`: set only after category blocking is complete

Never commit real AdMob ids into source code. Docker injects them into
`/runtime-config.js` at container start, and Android release builds write the
same values into the bundled `runtime-config.js`.

## Server-Side Verification

Reward coins are not granted by the client. Google must call the backend SSV
callback after the user earns the reward:

`https://YOUR_DOMAIN/api/admob/ssv`

In AdMob, enable server-side verification for the rewarded ad unit and set the
callback URL above. The Capacitor bridge sends:

- `userId`: the Durak user UUID
- `customData`: JSON with the same `userId`

The backend verifies Google's signature, checks the ad unit id, rejects duplicate
`transaction_id` values, enforces cooldown/balance cap, and then credits coins.

## Halal / Safe Ads

In AdMob console:

1. Open `Blocking controls`.
2. Select the Durak Imperia app.
3. Open `Sensitive categories`.
4. Block `Gambling & Betting`.
5. Block `Social Casino Games`.
6. Review general categories and block alcohol, adult, betting, casino, and
   other unsafe content.
7. Set `ADMOB_HALAL_CATEGORIES_BLOCKED=1` in production only after this is done.

## Release Check

Run:

`node scripts/release-check.mjs`

Then check the live endpoint:

`GET /api/production/readiness`

The release is not AdMob-ready until real AdMob ids are present and
`ADMOB_HALAL_CATEGORIES_BLOCKED=1` is set.
