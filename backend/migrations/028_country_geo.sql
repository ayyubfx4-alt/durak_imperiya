-- Migration 028: GeoIP country tracking
-- Adds country_code column to users table for geographic analytics.
-- Uses 2-letter ISO 3166-1 alpha-2 codes (e.g. UZ, RU, US).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(2);

CREATE INDEX IF NOT EXISTS idx_users_country ON users (country_code)
  WHERE country_code IS NOT NULL;
