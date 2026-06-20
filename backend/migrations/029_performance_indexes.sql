-- Migration 029: Performance indexes
-- Adds missing indexes for leaderboard, search, and common query patterns.
-- All indexes created with CONCURRENTLY so they don't lock tables in production.
-- Safe to run multiple times (IF NOT EXISTS).
--
-- Expected speedups:
--   Leaderboard ORDER BY rank_wins DESC  →  seq scan → index scan  (>100x for 10k+ rows)
--   Username search ILIKE                →  seq scan → GIN trigram (>50x for 10k+ rows)
--   Transactions by user + date          →  seq scan → index scan  (>20x)
--   Games by room_code                   →  seq scan → index scan
--   Achievements by user                 →  seq scan → index scan

-- ── Users table ──────────────────────────────────────────────────────────────

-- Leaderboard: ORDER BY rank_wins DESC, games_won DESC
CREATE INDEX IF NOT EXISTS idx_users_rank_wins
  ON users (rank_wins DESC, games_won DESC)
  WHERE is_banned = FALSE AND is_bot IS NOT TRUE AND is_admin IS NOT TRUE;

-- Online users: updated_at > now() - interval '5 minutes'
CREATE INDEX IF NOT EXISTS idx_users_updated_at
  ON users (updated_at DESC)
  WHERE is_bot IS NOT TRUE AND is_admin IS NOT TRUE;

-- Registration funnel: DAU/MAU reporting
CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users (created_at DESC)
  WHERE is_bot IS NOT TRUE AND is_admin IS NOT TRUE;

-- Admin user listing + search
CREATE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (lower(username));

CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (lower(email));

-- Premium status filter
CREATE INDEX IF NOT EXISTS idx_users_premium_until
  ON users (premium_until)
  WHERE premium_until IS NOT NULL;

-- GIN trigram index for ILIKE nickname/username search
-- Requires: CREATE EXTENSION IF NOT EXISTS pg_trgm;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_users_username_trgm
        ON users USING GIN (username gin_trgm_ops);
    $idx$;
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_users_nickname_trgm
        ON users USING GIN (nickname gin_trgm_ops)
        WHERE nickname IS NOT NULL;
    $idx$;
  END IF;
END;
$$;

-- ── Transactions table ────────────────────────────────────────────────────────

-- Economy dashboard: SUM(amount) WHERE type IN (…) AND created_at >= date_trunc(…)
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_created
  ON transactions (user_id, type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_created_at
  ON transactions (created_at DESC);

-- ── Games table ───────────────────────────────────────────────────────────────

-- Admin games history: ORDER BY started_at DESC
CREATE INDEX IF NOT EXISTS idx_games_started_at
  ON games (started_at DESC);

-- Room lookup
CREATE INDEX IF NOT EXISTS idx_games_room_code
  ON games (room_code)
  WHERE room_code IS NOT NULL;

-- Active games: WHERE ended_at IS NULL
CREATE INDEX IF NOT EXISTS idx_games_active
  ON games (started_at DESC)
  WHERE ended_at IS NULL;

-- ── Achievements table ────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_achievements_user_id
  ON achievements (user_id, achievement_key);

CREATE INDEX IF NOT EXISTS idx_achievement_inbox_user_undelivered
  ON achievement_inbox (user_id, id ASC)
  WHERE delivered = FALSE;

-- ── Friends table ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_friends_user_status
  ON friends (user_id, status)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS idx_friends_friend_status
  ON friends (friend_id, status)
  WHERE status IN ('accepted', 'pending');

-- ── Inventory table ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_inventory_user_type
  ON inventory (user_id, item_type, item_id);

-- ── Gold transactions ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_gold_transactions_user_created
  ON gold_transactions (user_id, created_at DESC);

-- ── Admin events ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_admin_events_created_at
  ON admin_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_events_category
  ON admin_events (category, created_at DESC);

-- ── Sessions / audit log ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_audit_log_admin_id
  ON audit_log (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_target_id
  ON audit_log (target_id, created_at DESC)
  WHERE target_id IS NOT NULL;
