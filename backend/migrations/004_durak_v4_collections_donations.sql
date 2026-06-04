-- Durak Online v4 — collections, donations, Uraven rank, monthly badges
-- TOR §6 (donations), §7 (collections), §8 (Uraven rank), §9 (monthly badges).

-- §6 Donations -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS donations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    display_name    VARCHAR(64) NOT NULL,
    amount_usd_cents BIGINT NOT NULL CHECK (amount_usd_cents > 0),
    currency        VARCHAR(8) NOT NULL DEFAULT 'USD',
    message         TEXT,
    is_fake         BOOLEAN NOT NULL DEFAULT FALSE,
    payment_ref     VARCHAR(128),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_donations_real_amount ON donations (is_fake, amount_usd_cents DESC);
CREATE INDEX IF NOT EXISTS idx_donations_user ON donations (user_id);

-- Aggregate column on users for donor leaderboards.
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_donated_cents BIGINT NOT NULL DEFAULT 0;

-- §8 Uraven rank ----------------------------------------------------------
-- 6 colour bands × (4 lines × 100 wins) × 3 "+" markers between bands.
-- These four columns together describe the current rank state. They are
-- derived from `rank_wins`, but cached for cheap profile / lobby reads.
ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_color   VARCHAR(16) NOT NULL DEFAULT 'white';
ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_lines   SMALLINT    NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_pluses  SMALLINT    NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_progress SMALLINT   NOT NULL DEFAULT 0;

-- §7 Collections ---------------------------------------------------------
-- A flag for catalog items that can only be obtained by completing a 32-deep
-- referral tree. Real catalog metadata lives in source files; the column is
-- here so admin tools can override gating per item if needed.
CREATE TABLE IF NOT EXISTS exclusive_items (
    item_type       VARCHAR(32) NOT NULL,        -- 'emoji_pack' | 'card_skin'
    item_id         VARCHAR(64) NOT NULL,
    required_referral_generations SMALLINT NOT NULL DEFAULT 32,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (item_type, item_id)
);

-- §9 Monthly "Makkor tulki" (Cunning Fox) ------------------------------
CREATE TABLE IF NOT EXISTS monthly_badges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_year     SMALLINT NOT NULL,
    period_month    SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    badge_key       VARCHAR(64) NOT NULL,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    metric_value    BIGINT,
    awarded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (period_year, period_month, badge_key)
);
