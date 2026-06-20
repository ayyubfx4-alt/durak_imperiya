# Durak Imperia Capacitor Native Shell

This folder builds the Android and optional iOS native wrapper for the PWA.

## Services

| Service | Plugin | Backend endpoint |
|---|---|---|
| Rewarded Video only | `@capacitor-community/admob` | `POST /api/users/me/ad-bonus` |
| Google Play Billing | `cordova-plugin-purchase` | `POST /api/shop/verify-iap` |
| App Store IAP | StoreKit-compatible purchases plugin | `POST /api/shop/verify-iap` |
| Push notifications | `@capacitor/push-notifications` | app auth/device endpoints |

## AdMob Rules

Only Rewarded Video is allowed for the first release.

Do not add:

- Interstitial ads
- App open ads
- Banner ads

Production env must provide:

- `ADMOB_ANDROID_APP_ID`
- `ADMOB_REWARDED_ANDROID_ID`
- `ADMOB_IOS_APP_ID` and `ADMOB_REWARDED_IOS_ID` only when `RELEASE_PLATFORMS` includes `ios`

AdMob console must block:

- `Gambling & Betting`
- `Social Casino Games`

After blocking those categories, set:

```bash
ADMOB_HALAL_CATEGORIES_BLOCKED=1
```

## Billing Products

Create these product ids in Google Play Console:

| Product ID | Type | Price / status |
|---|---|---|
| `gold_55` | consumable | 1 USD |
| `gold_165` | consumable | 3 USD |
| `gold_560` | consumable | 10 USD |
| `gold_1900` | consumable | 40 USD |
| `gold_6800` | consumable | 100 USD |
| `premium_month` | subscription | final price approved later |
| `premium_quarter` | subscription | final price approved later |
| `premium_year` | subscription | final price approved later |

Production verification needs:

- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_PLAY_PACKAGE_NAME=com.durakimperia.game`
- `APPLE_SHARED_SECRET` only for iOS release

## Build

### Android Build
```powershell
npm run android:tools
npm run android:build
```

`npm run android:build` creates a local signed AAB and may use the Google sample AdMob app id while real monetization is not configured.

Store-ready builds require a real AdMob Android app id. This command intentionally fails if the sample id is still present:

```powershell
$env:PUBLIC_APP_URL="https://your-production-domain.example"
$env:ADMOB_ANDROID_APP_ID="ca-app-pub-REAL~APP_ID"
$env:ADMOB_REWARDED_ANDROID_ID="ca-app-pub-REAL/REWARDED_ID"
$env:ANDROID_KEYSTORE_BASE64="BASE64_OF_RELEASE_KEYSTORE"
$env:ANDROID_KEYSTORE_PASSWORD="CHANGE_ME"
$env:ANDROID_KEY_ALIAS="durak"
$env:ANDROID_KEY_PASSWORD="CHANGE_ME"
npm run android:build:store
```

Final release also requires a backed-up Android release keystore and:

```bash
ANDROID_RELEASE_KEYSTORE_READY=1
```

### iOS Build (macOS with Xcode Required)
To prepare a release for the iOS platform, verify you are running on macOS, then execute the release script:

```bash
export PUBLIC_APP_URL="https://your-production-domain.example"
export ADMOB_IOS_APP_ID="ca-app-pub-REAL~APP_ID"
export ADMOB_REWARDED_IOS_ID="ca-app-pub-REAL/REWARDED_ID"
./scripts/build-ios-release.sh
```

This will prepare the Capacitor web configuration, inject variables, run `cap sync ios`, and open the Xcode workspace where you can run the final Archive command.

Before publishing, backend readiness must return `ok=true` for both active platforms:

```bash
curl https://YOUR_DOMAIN/api/production/readiness
```
