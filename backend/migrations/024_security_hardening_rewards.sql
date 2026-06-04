-- Security hardening for rewards, IAP idempotency, and gift abuse controls.

CREATE TABLE IF NOT EXISTS admob_ssv_rewards (
  transaction_id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ad_unit TEXT,
  reward_amount INTEGER NOT NULL DEFAULT 0,
  reward_item TEXT,
  signature_key_id TEXT,
  raw_query TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admob_ssv_rewards_user
  ON admob_ssv_rewards (user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_iap_fingerprint
  ON transactions ((metadata->>'iapFingerprint'))
  WHERE metadata ? 'iapFingerprint';

CREATE INDEX IF NOT EXISTS idx_gold_transactions_iap_fingerprint
  ON gold_transactions ((metadata->>'iapFingerprint'))
  WHERE metadata ? 'iapFingerprint';

CREATE INDEX IF NOT EXISTS idx_transactions_admob_transaction
  ON transactions ((metadata->>'admobTransactionId'))
  WHERE metadata ? 'admobTransactionId';

CREATE INDEX IF NOT EXISTS idx_transactions_daily_coin_gifts
  ON transactions (user_id, created_at DESC)
  WHERE type = 'gift' AND amount < 0;
