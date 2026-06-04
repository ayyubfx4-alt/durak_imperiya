-- 007_tournament_brackets_inventory.sql
-- PRO additions: tournament bracket engine, achievement unlock queue,
-- inventory grouping, and Redis-backed presence projection.

-- Bracket: single-elimination tree. Each match links two entries
-- (entry_a / entry_b → winner). round_no=1 is the first round, then 2, 3 …
-- until log2(maxPlayers). NULL winner means pending.
CREATE TABLE IF NOT EXISTS tournament_matches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_no      INT  NOT NULL,
  match_no      INT  NOT NULL,
  entry_a_id    UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  entry_b_id    UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  winner_entry_id UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  room_code     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|live|done|bye
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, round_no, match_no)
);

CREATE INDEX IF NOT EXISTS idx_tmatches_tournament_round
  ON tournament_matches (tournament_id, round_no);
CREATE INDEX IF NOT EXISTS idx_tmatches_status
  ON tournament_matches (status);

-- Each tournament knows how many rounds and which round it is currently in.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS bracket_rounds   INT,
  ADD COLUMN IF NOT EXISTS current_round    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bracket_seeded   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS prize_pool_gold  INT;

-- Real-time achievement unlock queue: row inserted by services/achievements.js,
-- the socket layer broadcasts and then deletes it. Survives a restart so a
-- player who was offline when they hit the threshold still sees the popup.
CREATE TABLE IF NOT EXISTS achievement_inbox (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  delivered       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ach_inbox_user_pending
  ON achievement_inbox (user_id) WHERE delivered = FALSE;

-- Admin live event log (room monitor → economy events feed).
CREATE TABLE IF NOT EXISTS admin_events (
  id          BIGSERIAL PRIMARY KEY,
  level       TEXT NOT NULL DEFAULT 'info',
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_events_created ON admin_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_events_category ON admin_events (category, created_at DESC);
