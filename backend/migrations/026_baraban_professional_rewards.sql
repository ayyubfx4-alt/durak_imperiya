-- 026_baraban_professional_rewards.sql
-- Professional wheel rewards:
-- - extra spin credits for reroll prizes
-- - persistent bonus rank points so stats resync does not erase wheel rewards

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS baraban_extra_spins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_rank_points INTEGER NOT NULL DEFAULT 0;
