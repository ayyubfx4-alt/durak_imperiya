-- v61: store whole emoji pack ownership alongside individual emoji rows.
-- This keeps gifting/admin checks fast while preserving the per-emoji inventory
-- used by game chat.
ALTER TABLE inventory
  DROP CONSTRAINT IF EXISTS inventory_item_type_chk;

ALTER TABLE inventory
  ADD CONSTRAINT inventory_item_type_chk
  CHECK (item_type IN ('emoji', 'emoji_pack', 'card_skin', 'badge', 'sticker_pack', 'frame', 'avatar_frame'));
