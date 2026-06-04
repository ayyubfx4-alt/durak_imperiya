-- Real production launch cleanup and admin asset support.
-- This migration is intentionally non-destructive for users/games. Full data
-- reset is available from the authenticated admin maintenance endpoint.

ALTER TABLE users ALTER COLUMN coins SET DEFAULT 0;
ALTER TABLE users ALTER COLUMN gold_coins SET DEFAULT 0;

ALTER TABLE admin_items
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_admin_items_updated_at ON admin_items (updated_at DESC);

DELETE FROM stickers
 WHERE unique_id IN ('STK_0001', 'STK_0002', 'STK_0003', 'STK_0004', 'STK_0005')
   AND sold_count = 0
   AND price_gold = 0
   AND price_uzs = 0;

UPDATE system_stats
   SET total_users = COALESCE((SELECT COUNT(*) FROM users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE), 0),
       total_revenue_uzs = 0,
       online_users = 0,
       server_status = 'stable',
       updated_at = now()
 WHERE id = 1;
