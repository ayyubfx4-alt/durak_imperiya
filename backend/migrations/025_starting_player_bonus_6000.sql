-- New player welcome balance.
-- Existing player balances are intentionally left untouched.

ALTER TABLE users ALTER COLUMN coins SET DEFAULT 6000;
ALTER TABLE users ALTER COLUMN gold_coins SET DEFAULT 0;
