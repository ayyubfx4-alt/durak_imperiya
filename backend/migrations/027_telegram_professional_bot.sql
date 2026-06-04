ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_command TEXT,
  ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE telegram_users
   SET is_admin = (telegram_id::text IN ('8324791195', '8396560736')),
       last_seen_at = COALESCE(last_seen_at, last_start_at, updated_at, created_at)
 WHERE last_seen_at IS NULL
    OR telegram_id::text IN ('8324791195', '8396560736');

CREATE INDEX IF NOT EXISTS idx_telegram_users_seen ON telegram_users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_users_admin ON telegram_users (is_admin) WHERE is_admin = TRUE;

CREATE TABLE IF NOT EXISTS telegram_bot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  telegram_id BIGINT,
  chat_id BIGINT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_bot_events_created ON telegram_bot_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_bot_events_type ON telegram_bot_events (event_type, created_at DESC);
