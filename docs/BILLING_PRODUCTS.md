# Billing Products

Configure these product ids in Google Play Console. The backend uses these ids for verified IAP receipt handling.

## Gold Coin Products

| Product ID | Price | Grant |
|---|---:|---:|
| `gold_55` | 1 USD | 55 Gold Coin, 10 000 virtual dollars equivalent |
| `gold_165` | 3 USD | 165 Gold Coin, 30 000 virtual dollars equivalent |
| `gold_560` | 10 USD | 560 Gold Coin, 101 800 virtual dollars equivalent |
| `gold_1900` | 40 USD | 1 900 Gold Coin, 345 500 virtual dollars equivalent |
| `gold_6800` | 100 USD | 6 800 Gold Coin, 1 236 000 virtual dollars equivalent |

## Premium Products

Premium products exist by id, but final prices must be approved before release:

| Product ID | Duration |
|---|---:|
| `premium_month` | 1 month |
| `premium_quarter` | 3 months |
| `premium_year` | 1 year |

Set these only after final business approval:

- `PREMIUM_MONTHLY_USD`
- `PREMIUM_QUARTERLY_USD`
- `PREMIUM_YEARLY_USD`
- `PREMIUM_PRICES_APPROVED=1`

## Verification

Production must set:

- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_PLAY_PACKAGE_NAME=com.durakimperia.game`

Without those values, production purchase verification must stay red in `/api/production/readiness`.
