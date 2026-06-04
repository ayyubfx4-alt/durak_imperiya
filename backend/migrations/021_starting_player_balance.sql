-- New player economy defaults.
-- Existing player balances are intentionally left untouched.

ALTER TABLE users ALTER COLUMN coins SET DEFAULT 0;
ALTER TABLE users ALTER COLUMN gold_coins SET DEFAULT 0;
