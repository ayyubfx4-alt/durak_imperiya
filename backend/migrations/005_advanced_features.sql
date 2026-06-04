-- Durak Online v4 — advanced features (TOR §11-§15)
-- Gold Coin perks in normal games, binary 32-generation referral tree,
-- player reports / time-limited bans, admin overrides for item prices and
-- fake-mode tuning, and per-friend item gifting.
--
-- Idempotent: every statement uses IF NOT EXISTS / DO NOTHING / etc.

-- §11 Gold Coin perks log ----------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_perks_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_code       VARCHAR(16),
    game_id         UUID,
    perk            VARCHAR(32) NOT NULL,   -- 'peek_opponents' | 'peek_next_card' | 'best_move_hint'
    gold_spent      INTEGER NOT NULL,
    metadata        JSONB,
    used_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_perks_log_user ON gold_perks_log (user_id, used_at DESC);

-- §12 Gift log (for item gifting between friends) ----------------------------
CREATE TABLE IF NOT EXISTS gifts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type       VARCHAR(32) NOT NULL,  -- 'coins' | 'gold' | 'emoji_pack' | 'card_skin' | 'badge' | 'emoji'
    item_id         VARCHAR(64),
    quantity        INTEGER NOT NULL DEFAULT 1,
    paid_coins      BIGINT NOT NULL DEFAULT 0,
    paid_gold       BIGINT NOT NULL DEFAULT 0,
    message         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gifts_recipient ON gifts (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gifts_sender ON gifts (sender_id, created_at DESC);

-- §13 Binary 32-generation referral tree -------------------------------------
-- Each user has at most two direct referees: a "left" hand and a "right"
-- hand. The chain depth is recorded by `level` (1..32). For backward
-- compatibility we keep the existing `referrals.level` column and just add
-- a `position` discriminator + cached lookup columns on `users`.
ALTER TABLE referrals
    ADD COLUMN IF NOT EXISTS position VARCHAR(8); -- 'left' | 'right' | NULL for legacy rows

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS referral_left_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS referral_right_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS referral_depth_max SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS referral_leader    BOOLEAN  NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_referral_leader ON users (referral_leader) WHERE referral_leader = TRUE;

-- §14 Player reports (shikoyat) ---------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_code       VARCHAR(16),
    game_id         UUID,
    reason          VARCHAR(64) NOT NULL,    -- 'cheating' | 'abuse' | 'spam' | 'other'
    details         TEXT,
    status          VARCHAR(16) NOT NULL DEFAULT 'open', -- 'open' | 'resolved' | 'dismissed'
    resolution      VARCHAR(64),             -- 'banned_1m' | 'banned_3m' | 'banned_6m' | 'banned_1y' | 'banned_permanent' | 'no_action' | 'warned'
    resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (reporter_id <> reported_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports (reported_id, created_at DESC);

-- §14 Time-limited bans ------------------------------------------------------
-- `is_banned` stays as the immediate gate; `banned_until` is the auto-expiry.
-- NULL `banned_until` while `is_banned = TRUE` means a permanent ban.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;

-- §15 Admin overrides for item prices ---------------------------------------
CREATE TABLE IF NOT EXISTS item_price_overrides (
    item_type       VARCHAR(32) NOT NULL,    -- 'emoji_pack' | 'card_skin' | 'badge' | 'gold_bundle'
    item_id         VARCHAR(64) NOT NULL,
    price_coins     BIGINT,                  -- Durak Dollars override (NULL = use code default)
    price_gold      BIGINT,                  -- Gold Coin override
    price_usd       NUMERIC(10,2),           -- For gold bundles
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (item_type, item_id)
);

-- §15 Per-instance items added by admin (extra packs/skins beyond code) -----
CREATE TABLE IF NOT EXISTS admin_items (
    id              VARCHAR(64) PRIMARY KEY,    -- e.g. 'admin_pack_001'
    item_type       VARCHAR(32) NOT NULL,       -- 'emoji_pack' | 'card_skin' | 'badge'
    name            VARCHAR(120) NOT NULL,
    icon            VARCHAR(32),
    rarity          VARCHAR(16) NOT NULL DEFAULT 'common',
    price_coins     BIGINT NOT NULL DEFAULT 0,
    price_gold      BIGINT NOT NULL DEFAULT 0,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_items_type ON admin_items (item_type, enabled);

-- §15 Admin runtime settings (fake-mode toggles, etc.) ----------------------
CREATE TABLE IF NOT EXISTS admin_settings (
    key             VARCHAR(64) PRIMARY KEY,
    value           JSONB NOT NULL,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- §15 Tournament winners (1/2/3 places) -------------------------------------
-- The base placement column already exists on tournament_entries; we add a
-- medal type so admins can decorate winners (gold/silver/bronze) and a
-- dedicated payout record for transparency.
CREATE TABLE IF NOT EXISTS tournament_payouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    placement       SMALLINT NOT NULL,
    medal           VARCHAR(16) NOT NULL,    -- 'gold' | 'silver' | 'bronze'
    gold_coins      BIGINT NOT NULL DEFAULT 0,
    awarded_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    awarded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, placement)
);
CREATE INDEX IF NOT EXISTS idx_tournament_payouts_user ON tournament_payouts (user_id, awarded_at DESC);
