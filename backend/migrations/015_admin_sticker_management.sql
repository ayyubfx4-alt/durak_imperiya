CREATE TABLE IF NOT EXISTS stickers (
  id BIGSERIAL PRIMARY KEY,
  unique_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  rarity TEXT NOT NULL DEFAULT 'rare',
  type TEXT NOT NULL DEFAULT 'static',
  status TEXT NOT NULL DEFAULT 'active',
  price_gold INTEGER NOT NULL DEFAULT 0,
  price_uzs BIGINT NOT NULL DEFAULT 0,
  sold_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stickers_rarity_chk CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  CONSTRAINT stickers_type_chk CHECK (type IN ('static', 'animated')),
  CONSTRAINT stickers_status_chk CHECK (status IN ('active', 'inactive')),
  CONSTRAINT stickers_price_gold_chk CHECK (price_gold >= 0),
  CONSTRAINT stickers_price_uzs_chk CHECK (price_uzs >= 0),
  CONSTRAINT stickers_sold_count_chk CHECK (sold_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stickers_name_search ON stickers USING gin (to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_stickers_rarity ON stickers (rarity);
CREATE INDEX IF NOT EXISTS idx_stickers_type ON stickers (type);
CREATE INDEX IF NOT EXISTS idx_stickers_status ON stickers (status);
CREATE INDEX IF NOT EXISTS idx_stickers_updated_at ON stickers (updated_at DESC);

CREATE TABLE IF NOT EXISTS system_stats (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  total_users BIGINT NOT NULL DEFAULT 0,
  total_revenue_uzs BIGINT NOT NULL DEFAULT 0,
  online_users BIGINT NOT NULL DEFAULT 0,
  server_status TEXT NOT NULL DEFAULT 'stable',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT system_stats_singleton_chk CHECK (id = 1),
  CONSTRAINT system_stats_status_chk CHECK (server_status IN ('stable', 'warning', 'down'))
);

INSERT INTO system_stats (id, total_users, total_revenue_uzs, online_users, server_status)
VALUES (1, 0, 0, 0, 'stable')
ON CONFLICT (id) DO NOTHING;

INSERT INTO stickers (unique_id, name, image_url, rarity, type, status, price_gold, price_uzs, sold_count)
VALUES
  ('STK_0001', 'Gold Skull', '/admin-stickers/gold-skull.svg', 'legendary', 'animated', 'active', 0, 0, 0),
  ('STK_0002', 'Red Dragon', '/admin-stickers/red-dragon.svg', 'epic', 'animated', 'active', 0, 0, 0),
  ('STK_0003', 'Neon Ninja', '/admin-stickers/neon-ninja.svg', 'rare', 'static', 'active', 0, 0, 0),
  ('STK_0004', 'Royal Lion', '/admin-stickers/royal-lion.svg', 'legendary', 'animated', 'active', 0, 0, 0),
  ('STK_0005', 'Joker', '/admin-stickers/joker.svg', 'epic', 'animated', 'inactive', 0, 0, 0)
ON CONFLICT (unique_id) DO NOTHING;
