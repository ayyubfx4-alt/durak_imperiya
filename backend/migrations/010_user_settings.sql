-- 010_user_settings.sql
-- Persist client settings such as sound/vibration/action buttons per account.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS settings_json JSONB NOT NULL DEFAULT '{}'::jsonb;
