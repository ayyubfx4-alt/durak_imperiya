# Play Market Release Pack

## Store Identity

- Official app name: `Durak Imperia`
- Package name: `com.durakimperia.game`
- Search keywords: `Durak`, `Online`, `Card Game`, `Imperia`

## Short Description

Durak Imperia - online Durak card game with tournaments, fair play, rewards, and private tables.

## Full Description

Durak Imperia is an online Durak card game focused on fair play, clean design, and competitive multiplayer.

Features:

- Online Durak tables with private rooms
- Tournament system with brackets and live viewing
- Rewarded video bonuses only, no forced ads
- Daily baraban rewards after 10 played games
- Voice chat in 1v1 games after unlock
- Cosmetic shop for card skins, stickers, and emoji
- AI helper for rules, strategy, shop, tournaments, referrals, and baraban
- Antibot checks and admin moderation

The game uses only virtual in-game currency for play. There is no real-money betting.

## Data Safety Notes

The app may process:

- Account identifier and nickname
- Gameplay statistics
- Purchases and virtual inventory
- Optional avatar image
- Device/IP signals for antibot protection
- Voice chat signaling metadata when voice chat is used

The app does not sell user data.

## Required Before Upload

1. Create production HTTPS domain and set `PUBLIC_APP_URL`.
2. Publish privacy policy and set `PRIVACY_POLICY_URL`.
3. Create Android release keystore, back it up safely, then set `ANDROID_RELEASE_KEYSTORE_READY=1`.
4. Build Android with target SDK 35+ and Billing Library 8+ compatible purchase plugin.
5. Configure Google Play Billing products:
   - `gold_55`
   - `gold_165`
   - `gold_560`
   - `gold_1900`
   - `gold_6800`
   - `premium_month`
   - `premium_quarter`
   - `premium_year`
6. Add Google service account JSON to `GOOGLE_SERVICE_ACCOUNT_JSON`.
7. Configure AdMob Rewarded Video only.
8. Block `Gambling & Betting` and `Social Casino Games`.
9. Run `GET /api/production/readiness` and release only when `ok=true`.
