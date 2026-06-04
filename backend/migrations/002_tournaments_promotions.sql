-- Tournaments and promotions added in v3 hardening pass.

CREATE TABLE IF NOT EXISTS tournaments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(120) NOT NULL,
    starts_at    TIMESTAMPTZ,
    prize_coins  INTEGER NOT NULL DEFAULT 0,
    max_players  INTEGER NOT NULL DEFAULT 16,
    status       VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments (status);

CREATE TABLE IF NOT EXISTS promotions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(120) NOT NULL,
    bonus_coins   INTEGER NOT NULL DEFAULT 0,
    starts_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at       TIMESTAMPTZ NOT NULL,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions (active);
