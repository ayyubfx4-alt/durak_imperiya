-- 011_voice_chat_baraban_antibot.sql
-- Feature 30: Voice Chat (1v1 only, after 20 games, mutual consent)
-- Feature 31: Baraban spin wheel (24h cooldown, jackpot once/year)
-- Feature 32: Antibot scoring system

-- ── VOICE CHAT ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS voice_chat_sessions (
  id              BIGSERIAL PRIMARY KEY,
  room_code       TEXT        NOT NULL,
  user_a          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_voice_room ON voice_chat_sessions (room_code);

-- Track how many voice sessions a user has used today (free limit = 3/day)
CREATE TABLE IF NOT EXISTS user_daily_voice (
  user_id   UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       DATE    NOT NULL DEFAULT CURRENT_DATE,
  count     INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- ── BARABAN (SPIN WHEEL) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS baraban_spins (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prize_type   TEXT        NOT NULL, -- 'empty','coins','gold_coin','sticker','card','tournament_ticket','jackpot'
  prize_amount INT         NOT NULL DEFAULT 0,
  multiplier   SMALLINT    NOT NULL DEFAULT 1, -- 1, 2, or 5
  is_jackpot   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_baraban_user ON baraban_spins (user_id, created_at DESC);

-- Track jackpot granted year to enforce once-per-year rule
CREATE TABLE IF NOT EXISTS baraban_jackpot_grants (
  user_id   UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year      SMALLINT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year)
);

-- ── ANTIBOT SCORING ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS antibot_scores (
  user_id      UUID        NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score        SMALLINT    NOT NULL DEFAULT 0,          -- 0–100
  category     TEXT        NOT NULL DEFAULT 'clean',    -- clean|watch|suspicious|bot
  details      JSONB       NOT NULL DEFAULT '{}',       -- per-factor breakdown
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_antibot_category ON antibot_scores (category) WHERE category <> 'clean';
