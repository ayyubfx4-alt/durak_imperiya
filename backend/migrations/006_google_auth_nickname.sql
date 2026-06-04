-- 006_google_auth_nickname.sql
-- Adds Google OAuth, unique nickname, avatar, and FCM push token support.

-- Google account identifier (Firebase UID)
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;

-- Unique @nickname chosen on first Google login
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT UNIQUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_lower ON users (lower(nickname));

-- Google profile picture URL
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Firebase Cloud Messaging token for push notifications
ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- Mark users who have completed nickname selection
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_set BOOLEAN NOT NULL DEFAULT FALSE;

-- Allow null password_hash for Google-only accounts
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
