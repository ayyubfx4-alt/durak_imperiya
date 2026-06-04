-- Games-played progression and feature unlock system.
-- 016 is already used by the admin control center, so progression starts at 017.

ALTER TABLE users ADD COLUMN IF NOT EXISTS games_played INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS games_played_updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS feature_unlocks (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  games_played_at_unlock INT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_unlocks_user_feature
  ON feature_unlocks(user_id, feature);

CREATE INDEX IF NOT EXISTS idx_feature_unlocks_user
  ON feature_unlocks(user_id);

CREATE INDEX IF NOT EXISTS idx_feature_unlocks_feature
  ON feature_unlocks(feature);

CREATE TABLE IF NOT EXISTS unlock_thresholds (
  feature TEXT PRIMARY KEY,
  required_games INT NOT NULL CHECK (required_games >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO unlock_thresholds (feature, required_games) VALUES
  ('basic_play', 0),
  ('daily_reward', 3),
  ('profile_stats', 3),
  ('first_free_sticker', 3),
  ('inventory', 3),
  ('duplicate_cards', 5),
  ('gift_system', 5),
  ('friends', 5),
  ('card_collection', 5),
  ('voice_chat', 10),
  ('spectate', 10),
  ('online_status', 10),
  ('ranking', 15),
  ('achievements', 15),
  ('daily_missions', 15),
  ('win_streak', 15),
  ('tournament', 20),
  ('premium_tournament', 20),
  ('rare_rewards', 20),
  ('animated_rewards', 20),
  ('elite_rewards', 30),
  ('rare_animated_effects', 30),
  ('exclusive_profile_effects', 30),
  ('advanced_missions', 30)
ON CONFLICT (feature) DO NOTHING;
