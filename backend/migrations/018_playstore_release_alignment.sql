-- 018_playstore_release_alignment.sql
-- Final release-hardening compatibility layer for the Play Store prompt.
-- Everything is idempotent so it is safe on an existing live database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admin_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject VARCHAR(200) NOT NULL DEFAULT 'User message',
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_inbox_created ON admin_inbox (created_at DESC);

ALTER TABLE admin_items
  ALTER COLUMN id TYPE VARCHAR(96),
  ALTER COLUMN rarity TYPE VARCHAR(24);

ALTER TABLE gold_transactions
  ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason TEXT;
CREATE INDEX IF NOT EXISTS idx_gold_tx_admin ON gold_transactions (admin_id, created_at DESC);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_baraban_spin TIMESTAMPTZ;

INSERT INTO unlock_thresholds (feature, required_games, enabled)
VALUES
  ('baraban', 10, TRUE),
  ('voice_chat', 10, TRUE)
ON CONFLICT (feature) DO UPDATE
  SET required_games = EXCLUDED.required_games,
      enabled = EXCLUDED.enabled,
      updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'progression_thresholds'
      AND n.nspname = 'public'
  ) THEN
    CREATE VIEW progression_thresholds AS
      SELECT feature, required_games, enabled, updated_at
        FROM unlock_thresholds;
  END IF;
END$$;
