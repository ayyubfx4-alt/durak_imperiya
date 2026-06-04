-- 012_production_readiness.sql
-- Production hardening for features 24-35.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_ip TEXT,
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tournament_tickets INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_last_ip
  ON users (last_ip)
  WHERE last_ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_device_id
  ON users (device_id)
  WHERE device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_chat_usage (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS tournament_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_id UUID REFERENCES tournament_matches(id) ON DELETE SET NULL,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_entry_id UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  item_type VARCHAR(32) NOT NULL,
  item_id VARCHAR(96) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tournament_gifts_tournament
  ON tournament_gifts (tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournament_gifts_recipient
  ON tournament_gifts (recipient_entry_id, created_at DESC);
