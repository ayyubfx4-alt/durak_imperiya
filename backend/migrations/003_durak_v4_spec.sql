-- Durak Online v4 — TOR-aligned schema additions.
--
-- This migration brings the existing v3 schema in line with the v4 technical
-- specification (TOR):
--   * Two-currency economy: Durak Dollars ($) — the existing `coins` column,
--     repurposed to represent virtual $ — and Gold Coins (premium currency
--     bought with real money).
--   * Tournaments paid for in Gold Coins with first / second / third prizes.
--   * A global bot pool of 100 bots with rank-based avatar metadata.
--   * Sheriff badge counters + Elon Musk sticker collection tracking.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS gold_coins      BIGINT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS elon_stickers   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sheriff_marks   INTEGER NOT NULL DEFAULT 0;

-- Treat the existing `last_daily_at` column as deprecated; the v4 TOR removes
-- the daily-bonus mechanic. We leave the column in place so old transactions
-- and admin reports continue to work, but no code path writes to it anymore.

-- Tournaments — extend with Gold Coin entry & prize tiers.
ALTER TABLE tournaments
    ADD COLUMN IF NOT EXISTS entry_gold_coins         INTEGER NOT NULL DEFAULT 35,
    ADD COLUMN IF NOT EXISTS prize_first_gold_coins   INTEGER NOT NULL DEFAULT 150,
    ADD COLUMN IF NOT EXISTS prize_second_gold_coins  INTEGER NOT NULL DEFAULT 75,
    ADD COLUMN IF NOT EXISTS prize_third_gold_coins   INTEGER NOT NULL DEFAULT 35,
    ADD COLUMN IF NOT EXISTS table_size               INTEGER NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS bluff_enabled            BOOLEAN NOT NULL DEFAULT FALSE;

-- Tournament registration / standings.
CREATE TABLE IF NOT EXISTS tournament_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    bot_id          VARCHAR(64),
    seed            INTEGER,
    placement       INTEGER,
    eliminated_at   TIMESTAMPTZ,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, user_id),
    CHECK (user_id IS NOT NULL OR bot_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_tournament ON tournament_entries (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_user ON tournament_entries (user_id);

-- Global bot pool — 100 bots with rank-based avatar metadata. Populated by
-- the migrate/seed script so it's deterministic.
CREATE TABLE IF NOT EXISTS bot_pool (
    id              VARCHAR(64) PRIMARY KEY,
    username        VARCHAR(32) NOT NULL UNIQUE,
    rank_wins       INTEGER NOT NULL DEFAULT 0,
    avatar_color    VARCHAR(16) NOT NULL DEFAULT 'gray',   -- gray | white | gold | red | black
    avatar_lines    INTEGER NOT NULL DEFAULT 0,            -- 0..3 white lines
    avatar_pluses   INTEGER NOT NULL DEFAULT 0,            -- 0..n + symbols
    bot_level       VARCHAR(16) NOT NULL DEFAULT 'medium', -- easy | medium | hard
    busy            BOOLEAN NOT NULL DEFAULT FALSE,        -- currently seated at a room
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_pool_busy ON bot_pool (busy);

-- Gold Coin ledger. We mirror the `transactions` table conventions but keep
-- the audit trail separate so it's trivial to reconcile premium revenue.
CREATE TABLE IF NOT EXISTS gold_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount          BIGINT NOT NULL,            -- positive credit, negative debit
    type            VARCHAR(32) NOT NULL,        -- 'iap','tournament_entry','tournament_prize','convert_to_dollars','admin'
    reference_id    UUID,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gold_tx_user ON gold_transactions (user_id, created_at DESC);

-- 1 000 000 $ winners get an Elon Musk sticker pack as a collectible. We
-- track grants here so the achievements UI can render the collection.
CREATE TABLE IF NOT EXISTS elon_sticker_grants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id         UUID,
    stake           BIGINT NOT NULL,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elon_grants_user ON elon_sticker_grants (user_id, granted_at DESC);
