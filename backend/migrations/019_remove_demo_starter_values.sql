-- Remove demo starter economy values.
-- Real players should earn, buy, or receive admin/reward grants through the
-- ledger, not start with pre-filled Durak Dollars or Gold Coins.

ALTER TABLE users ALTER COLUMN coins SET DEFAULT 0;
ALTER TABLE users ALTER COLUMN gold_coins SET DEFAULT 0;

UPDATE users u
   SET coins = 0
 WHERE u.is_bot IS NOT TRUE
   AND u.coins = 10000
   AND u.games_played = 0
   AND u.games_won = 0
   AND u.games_lost = 0
   AND u.games_draw = 0
   AND NOT EXISTS (
         SELECT 1 FROM transactions t
          WHERE t.user_id = u.id
            AND t.type NOT IN ('demo_cleanup')
       );

UPDATE users u
   SET gold_coins = 0
 WHERE u.is_bot IS NOT TRUE
   AND u.gold_coins = 250
   AND NOT EXISTS (
         SELECT 1 FROM gold_transactions g
          WHERE g.user_id = u.id
       )
   AND NOT EXISTS (
         SELECT 1 FROM stripe_payments p
          WHERE p.user_id = u.id
            AND p.status = 'completed'
       );

DELETE FROM donations WHERE is_fake = TRUE;

UPDATE system_stats
   SET total_users = (SELECT COUNT(*) FROM users WHERE is_bot IS NOT TRUE),
       total_revenue_uzs = 0,
       online_users = 0,
       updated_at = now()
 WHERE id = 1
   AND (total_users = 128450 OR total_revenue_uzs = 2450000000 OR online_users = 4256);

UPDATE stickers
   SET sold_count = 0,
       updated_at = now()
 WHERE unique_id IN ('STK_0001', 'STK_0002', 'STK_0003', 'STK_0004', 'STK_0005')
   AND price_gold = 0
   AND price_uzs = 0;
