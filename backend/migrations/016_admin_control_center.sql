-- Professional admin control center support.
-- Keeps all changes idempotent so it can be applied on a live server safely.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_muted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS muted_reason TEXT,
  ADD COLUMN IF NOT EXISTS admin_role VARCHAR(32) NOT NULL DEFAULT 'player';

UPDATE users SET admin_role = 'super_admin' WHERE is_admin = TRUE AND admin_role = 'player';

CREATE INDEX IF NOT EXISTS idx_users_admin_role ON users (admin_role);
CREATE INDEX IF NOT EXISTS idx_users_muted ON users (is_muted, muted_until) WHERE is_muted = TRUE;

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role VARCHAR(32) PRIMARY KEY,
  permissions JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO admin_role_permissions (role, permissions)
VALUES
  ('owner', '["*"]'::jsonb),
  ('super_admin', '["users.manage","game.manage","tournaments.manage","economy.manage","shop.manage","reports.manage","voice.manage","security.manage","backup.manage","roles.manage","notifications.send"]'::jsonb),
  ('moderator', '["users.moderate","game.watch","reports.manage","voice.manage","security.view"]'::jsonb),
  ('support', '["users.view","reports.view","notifications.send","game.watch"]'::jsonb),
  ('player', '[]'::jsonb)
ON CONFLICT (role) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience VARCHAR(32) NOT NULL DEFAULT 'all',
  type VARCHAR(32) NOT NULL DEFAULT 'announcement',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_created ON admin_broadcasts (created_at DESC);

CREATE TABLE IF NOT EXISTS admin_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  backup_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'created',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_backups_created ON admin_backups (created_at DESC);
