-- Migration 031: add last_used_at to bot_pool for fair bot rotation.
ALTER TABLE bot_pool ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bot_pool_rotation
  ON bot_pool (busy, last_used_at ASC NULLS FIRST, created_at ASC);
