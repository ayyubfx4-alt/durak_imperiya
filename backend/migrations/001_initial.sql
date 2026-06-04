-- Durak Online — initial schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(32) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE,
    password_hash   VARCHAR(255),
    google_id       VARCHAR(64) UNIQUE,
    avatar_url      TEXT,
    coins           BIGINT NOT NULL DEFAULT 0,
    rank_wins       INTEGER NOT NULL DEFAULT 0,
    games_played    INTEGER NOT NULL DEFAULT 0,
    games_won       INTEGER NOT NULL DEFAULT 0,
    games_lost      INTEGER NOT NULL DEFAULT 0,
    games_draw      INTEGER NOT NULL DEFAULT 0,
    win_streak      INTEGER NOT NULL DEFAULT 0,
    loss_streak     INTEGER NOT NULL DEFAULT 0,
    bluffs_caught   INTEGER NOT NULL DEFAULT 0,
    bluffs_made     INTEGER NOT NULL DEFAULT 0,
    premium_until   TIMESTAMPTZ,
    referral_code   VARCHAR(16) UNIQUE NOT NULL,
    referred_by     UUID REFERENCES users(id),
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
    banned_reason   TEXT,
    last_daily_at   TIMESTAMPTZ,
    last_ad_at      TIMESTAMPTZ,
    badges_showcase JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_skin   VARCHAR(64) NOT NULL DEFAULT 'default',
    locale          VARCHAR(8) NOT NULL DEFAULT 'en',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));
CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code);

CREATE TABLE IF NOT EXISTS games (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code       VARCHAR(16) NOT NULL,
    mode            VARCHAR(16) NOT NULL DEFAULT 'classic',
    bluff_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    stake           BIGINT NOT NULL DEFAULT 0,
    player_ids      UUID[] NOT NULL DEFAULT '{}',
    bot_slots       INTEGER NOT NULL DEFAULT 0,
    winner_id       UUID REFERENCES users(id),
    loser_id        UUID REFERENCES users(id),
    is_draw         BOOLEAN NOT NULL DEFAULT FALSE,
    final_state     JSONB,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_games_room ON games (room_code);
CREATE INDEX IF NOT EXISTS idx_games_started ON games (started_at DESC);

CREATE TABLE IF NOT EXISTS inventory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type       VARCHAR(32) NOT NULL,    -- 'emoji' | 'card_skin' | 'badge' | 'avatar_frame'
    item_id         VARCHAR(64) NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 1,
    obtained_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory (user_id);

CREATE TABLE IF NOT EXISTS transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount          BIGINT NOT NULL,            -- positive credit, negative debit
    type            VARCHAR(32) NOT NULL,        -- 'daily','ad','win','loss','referral','purchase','admin','gift'
    reference_id    UUID,                        -- game id, gift id, etc.
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS friends (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending', -- 'pending','accepted','blocked'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, friend_id),
    CHECK (user_id <> friend_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         VARCHAR(64) NOT NULL,
    sender_id       UUID NOT NULL REFERENCES users(id),
    content         TEXT NOT NULL,
    type            VARCHAR(16) NOT NULL DEFAULT 'text', -- 'text','emoji','image','video','system'
    meta            JSONB,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, sent_at);

CREATE TABLE IF NOT EXISTS achievements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_key VARCHAR(64) NOT NULL,
    unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, achievement_key)
);

CREATE TABLE IF NOT EXISTS referrals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referee_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level           SMALLINT NOT NULL,
    rewarded        BOOLEAN NOT NULL DEFAULT FALSE,
    rewarded_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (referrer_id, referee_id, level)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON referrals (referee_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        UUID REFERENCES users(id),
    action          VARCHAR(64) NOT NULL,
    target_id       UUID,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_log (admin_id, created_at DESC);

CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated ON users;
CREATE TRIGGER users_set_updated BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
