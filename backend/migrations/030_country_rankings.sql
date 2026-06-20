-- Country flag and global country ranking support.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(2);

CREATE INDEX IF NOT EXISTS idx_users_country_rank
  ON users (country_code, games_won DESC, rank_wins DESC)
  WHERE country_code IS NOT NULL;

CREATE OR REPLACE VIEW country_stats AS
SELECT
  country_code,
  COUNT(*)::int AS total_players,
  COALESCE(SUM(games_won), 0)::int AS total_wins,
  COALESCE(SUM(games_played), 0)::int AS total_games,
  ROUND(
    COALESCE(SUM(games_won), 0)::numeric
    / NULLIF(COALESCE(SUM(games_played), 0), 0)
    * 100,
    1
  ) AS win_rate
FROM users
WHERE country_code IS NOT NULL
  AND country_code ~ '^[A-Z]{2}$'
  AND is_banned = FALSE
  AND is_admin IS NOT TRUE
  AND is_bot IS NOT TRUE
GROUP BY country_code;
