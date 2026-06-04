-- Real support center: player tickets, admin/support replies and role permission.

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject VARCHAR(140) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'game',
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  assigned_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  unread_by_user INTEGER NOT NULL DEFAULT 0,
  unread_by_staff INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_user_message_at TIMESTAMPTZ,
  last_staff_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (category IN ('game', 'payment', 'account', 'technical', 'abuse', 'other')),
  CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CHECK (status IN ('open', 'pending', 'answered', 'closed'))
);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_role VARCHAR(16) NOT NULL DEFAULT 'user',
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sender_role IN ('user', 'admin', 'support', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_last
  ON support_tickets (status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_last
  ON support_tickets (user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_last
  ON support_tickets (assigned_admin_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
  ON support_ticket_messages (ticket_id, created_at ASC);

WITH roles_to_patch AS (
  SELECT role, permission
  FROM (VALUES
    ('super_admin', 'support.manage'),
    ('moderator', 'support.manage'),
    ('support', 'support.manage')
  ) AS v(role, permission)
)
UPDATE admin_role_permissions arp
SET permissions = (
  SELECT jsonb_agg(DISTINCT value)
  FROM (
    SELECT jsonb_array_elements_text(arp.permissions) AS value
    UNION ALL
    SELECT permission FROM roles_to_patch WHERE role = arp.role
  ) s
),
updated_at = now()
WHERE arp.role IN (SELECT role FROM roles_to_patch)
  AND NOT (arp.permissions ? (SELECT permission FROM roles_to_patch WHERE role = arp.role LIMIT 1));
