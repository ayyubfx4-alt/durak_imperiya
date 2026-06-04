-- 009 — profile avatar frames.
-- Users can buy avatar/profile decorations and select one for display.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS selected_avatar_frame VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_item_type_chk'
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_item_type_chk
      CHECK (item_type IN ('emoji', 'card_skin', 'badge', 'sticker_pack', 'frame', 'avatar_frame'));
  END IF;
END$$;
