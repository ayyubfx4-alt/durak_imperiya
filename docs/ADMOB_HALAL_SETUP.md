# AdMob Rewarded Video Setup

Durak Imperia must use Rewarded Video only. Do not enable Interstitial, App Open, or Banner units for the first release.

## Create Ad Units

1. Open AdMob.
2. Create or open the app: `Durak Imperia`.
3. Android app id must be copied to `ADMOB_ANDROID_APP_ID`.
4. Create one Rewarded ad unit for Android and copy it to `ADMOB_REWARDED_ANDROID_ID`.
5. If iOS is released later, copy the iOS app id and rewarded unit id to `ADMOB_IOS_APP_ID` and `ADMOB_REWARDED_IOS_ID`.

## Block Haram / Gambling Categories

In AdMob console:

1. Go to `Blocking controls`.
2. Choose the Durak Imperia app.
3. Open `Sensitive categories`.
4. Block `Gambling & Betting`.
5. Block `Social Casino Games`.
6. Review general categories and block anything showing alcohol, adult content, betting, casino, or other card-game ads.
7. Set `ADMOB_HALAL_CATEGORIES_BLOCKED=1` only after this is done.

## Code Policy

The web/native bridge contains only Rewarded Video logic. Production refuses to use Google sample ad IDs. If real IDs are missing, the readiness endpoint stays red:

`GET /api/production/readiness`

Reward amount is fixed in backend config:

- Cooldown: 6 hours
- Reward: 800 in-game dollars
- No app open, interstitial, or banner units
