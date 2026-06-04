-- 008 — PRO v5: Sticker packs + matchmaker telemetry.
-- Idempotent: every statement is safe to re-run.

-- Sticker packs inventory uses the same `inventory` table (item_type='sticker_pack').
-- We just ensure the item_type column allows it (TEXT already, so this is a no-op
-- for schema, but we add a CHECK constraint for safety if not present).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_item_type_chk'
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_item_type_chk
      CHECK (item_type IN ('emoji', 'card_skin', 'badge', 'sticker_pack', 'frame', 'avatar_frame'));
  END IF;
END$$;

-- Matchmaker history (optional analytics — admin dashboard)
CREATE TABLE IF NOT EXISTS mm_history (
  id           BIGSERIAL PRIMARY KEY,
  user_a_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  user_b_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  stake        INTEGER NOT NULL,
  max_players  INTEGER NOT NULL,
  paired_real  BOOLEAN NOT NULL DEFAULT FALSE,
  wait_ms      INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mm_history_created_at ON mm_history (created_at DESC);

-- Stripe payment audit (separate from transactions/gold_transactions for fast joins)
CREATE TABLE IF NOT EXISTS stripe_payments (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  stripe_session TEXT UNIQUE NOT NULL,
  product_type   TEXT NOT NULL,       -- 'donation' | 'gold_bundle' | 'premium'
  product_id     TEXT,
  amount_cents   INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'completed',
  metadata       JSONB DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_user ON stripe_payments (user_id, created_at DESC);

-- Bot "typing" presence is in-memory only; no DB table needed.

-- Refresh referral_code for any user that somehow lacks one (legacy safety).
UPDATE users
   SET referral_code = SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 10)
 WHERE referral_code IS NULL OR referral_code = '';
