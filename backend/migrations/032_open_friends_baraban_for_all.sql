-- Open customer-facing social and daily reward flows for every account.
-- Cooldowns and collectible gift rules remain enforced by the application.

INSERT INTO unlock_thresholds (feature, required_games, enabled)
VALUES
  ('friends', 0, TRUE),
  ('gift_system', 0, TRUE),
  ('baraban', 0, TRUE)
ON CONFLICT (feature) DO UPDATE
  SET required_games = 0,
      enabled = TRUE,
      updated_at = now();
