-- 013_baraban_tournament_hardening.sql
-- Closes production gaps for feature 29/31:
-- - Baraban sticker/card prizes now record the exact granted inventory item.
-- - Tournament matches can track per-match live viewers.

ALTER TABLE baraban_spins
  ADD COLUMN IF NOT EXISTS prize_item_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS prize_item_id VARCHAR(96);

ALTER TABLE tournament_matches
  ADD COLUMN IF NOT EXISTS viewer_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tmatches_room_code
  ON tournament_matches (room_code)
  WHERE room_code IS NOT NULL;
