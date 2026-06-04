import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired, adminRequired, hasAdminPermission } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';

export const supportRouter = Router();

const CATEGORIES = new Set(['game', 'payment', 'account', 'technical', 'abuse', 'other']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const STATUSES = new Set(['open', 'pending', 'answered', 'closed']);
const MAX_ATTACHMENT_DATA_URL = 950000;

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function cleanText(value, max = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanBody(value) {
  return String(value ?? '').trim().slice(0, 4000);
}

function cleanAttachment(value) {
  if (!value || typeof value !== 'object') return null;
  const type = cleanText(value.type, 20).toLowerCase();
  const dataUrl = String(value.dataUrl || '');
  const mime = cleanText(value.mime, 40).toLowerCase();
  if (type !== 'image' || !dataUrl) return null;
  if (dataUrl.length > MAX_ATTACHMENT_DATA_URL) throw new HttpError(413, 'image too large');
  if (!/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(dataUrl)) {
    throw new HttpError(400, 'invalid image');
  }
  return {
    type: 'image',
    name: cleanText(value.name || 'support-image.jpg', 90),
    mime: mime || 'image/jpeg',
    size: Math.max(0, Math.min(Number(value.size || 0), 800000)),
    dataUrl,
  };
}

function intParam(value, fallback, min = 0, max = 100) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function validOr(value, allowed, fallback) {
  const v = cleanText(value, 32).toLowerCase();
  return allowed.has(v) ? v : fallback;
}

function categoryLabel(category) {
  return {
    game: "O'yin",
    payment: "To'lov",
    account: 'Akkaunt',
    technical: 'Texnik',
    abuse: 'Shikoyat',
    other: 'Boshqa',
  }[category] || "O'yin";
}

function normalizeSubject(value, body, category) {
  const direct = cleanText(value, 140);
  if (direct.length >= 3) return direct;
  const fromBody = cleanText(body, 80);
  if (fromBody.length >= 3) return fromBody;
  return `${categoryLabel(category)} ticket`.slice(0, 140);
}

function senderRole(user) {
  if (user?.admin_role === 'support') return 'support';
  if (user?.is_admin) return 'admin';
  return 'user';
}

function ticket(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    nickname: row.nickname,
    email: row.email,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    assignedAdminId: row.assigned_admin_id,
    assignedNickname: row.assigned_nickname,
    assignedUsername: row.assigned_username,
    metadata: row.metadata || {},
    unreadByUser: Number(row.unread_by_user || 0),
    unreadByStaff: Number(row.unread_by_staff || 0),
    lastMessageAt: row.last_message_at,
    lastUserMessageAt: row.last_user_message_at,
    lastStaffMessageAt: row.last_staff_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message || '',
    messageCount: Number(row.message_count || 0),
  };
}

function message(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    senderId: row.sender_id,
    senderRole: row.sender_role,
    senderName: row.sender_nickname || row.sender_username || row.sender_email || row.sender_role,
    body: row.body,
    metadata: row.metadata || {},
    isInternal: !!row.is_internal,
    createdAt: row.created_at,
  };
}

async function getTicketForUser(ticketId, userId) {
  const r = await query(
    `SELECT t.*, u.username, u.nickname, u.email,
            au.username AS assigned_username, au.nickname AS assigned_nickname,
            lm.body AS last_message,
            mc.message_count
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN users au ON au.id = t.assigned_admin_id
       LEFT JOIN LATERAL (
         SELECT body FROM support_ticket_messages
          WHERE ticket_id = t.id AND is_internal = FALSE
          ORDER BY created_at DESC LIMIT 1
       ) lm ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS message_count FROM support_ticket_messages
          WHERE ticket_id = t.id AND is_internal = FALSE
       ) mc ON TRUE
      WHERE t.id = $1 AND t.user_id = $2`,
    [ticketId, userId]
  );
  return r.rows[0] || null;
}

async function getTicketForStaff(ticketId) {
  const r = await query(
    `SELECT t.*, u.username, u.nickname, u.email,
            au.username AS assigned_username, au.nickname AS assigned_nickname,
            lm.body AS last_message,
            mc.message_count
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN users au ON au.id = t.assigned_admin_id
       LEFT JOIN LATERAL (
         SELECT body FROM support_ticket_messages
          WHERE ticket_id = t.id
          ORDER BY created_at DESC LIMIT 1
       ) lm ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS message_count FROM support_ticket_messages
          WHERE ticket_id = t.id
       ) mc ON TRUE
      WHERE t.id = $1`,
    [ticketId]
  );
  return r.rows[0] || null;
}

async function listMessages(ticketId, { staff = false } = {}) {
  const r = await query(
    `SELECT m.*, u.username AS sender_username, u.nickname AS sender_nickname, u.email AS sender_email
       FROM support_ticket_messages m
       LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.ticket_id = $1
        ${staff ? '' : 'AND m.is_internal = FALSE'}
      ORDER BY m.created_at ASC`,
    [ticketId]
  );
  return r.rows.map(message);
}

function requireSupportPermission(req, res, next) {
  if (hasAdminPermission(req.user, ['support.manage', 'reports.manage', 'users.moderate'])) return next();
  return res.status(403).json({ error: 'permission denied', required: ['support.manage'] });
}

supportRouter.use(authRequired);

supportRouter.get('/tickets', asyncRoute(async (req, res) => {
  const limit = intParam(req.query.limit, 30, 1, 60);
  const r = await query(
    `SELECT t.*, u.username, u.nickname, u.email,
            au.username AS assigned_username, au.nickname AS assigned_nickname,
            lm.body AS last_message,
            mc.message_count
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN users au ON au.id = t.assigned_admin_id
       LEFT JOIN LATERAL (
         SELECT body FROM support_ticket_messages
          WHERE ticket_id = t.id AND is_internal = FALSE
          ORDER BY created_at DESC LIMIT 1
       ) lm ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS message_count FROM support_ticket_messages
          WHERE ticket_id = t.id AND is_internal = FALSE
       ) mc ON TRUE
      WHERE t.user_id = $1
      ORDER BY t.last_message_at DESC
      LIMIT $2`,
    [req.user.id, limit]
  );
  res.json({ tickets: r.rows.map(ticket) });
}));

supportRouter.post('/tickets', asyncRoute(async (req, res) => {
  const body = cleanBody(req.body?.body || req.body?.message);
  const attachment = cleanAttachment(req.body?.attachment);
  const category = validOr(req.body?.category, CATEGORIES, 'game');
  const subject = normalizeSubject(req.body?.subject, body, category);
  const priority = validOr(req.body?.priority, PRIORITIES, 'normal');
  const context = typeof req.body?.context === 'object' && req.body.context ? req.body.context : {};
  if (body.length < 3 && !attachment) throw new HttpError(400, 'message required');
  const storedBody = body || 'Rasm yuborildi';

  const created = await withTransaction(async (client) => {
    const t = await client.query(
      `INSERT INTO support_tickets
        (user_id, subject, category, priority, status, metadata, unread_by_staff, last_message_at, last_user_message_at)
       VALUES ($1, $2, $3, $4, 'open', $5, 1, now(), now())
       RETURNING *`,
      [req.user.id, subject, category, priority, JSON.stringify({
        context,
        createdFrom: 'web-client',
        userAgent: req.headers['user-agent'] || '',
        ip: req.ip,
      })]
    );
    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_role, body, metadata)
       VALUES ($1, $2, 'user', $3, $4)`,
      [t.rows[0].id, req.user.id, storedBody, JSON.stringify({ context, attachment })]
    );
    return t.rows[0];
  });

  const full = await getTicketForUser(created.id, req.user.id);
  res.status(201).json({ ticket: ticket(full), messages: await listMessages(created.id) });
}));

supportRouter.get('/tickets/:id', asyncRoute(async (req, res) => {
  const row = await getTicketForUser(req.params.id, req.user.id);
  if (!row) throw new HttpError(404, 'ticket not found');
  await query('UPDATE support_tickets SET unread_by_user = 0, updated_at = now() WHERE id = $1', [req.params.id]);
  res.json({ ticket: ticket({ ...row, unread_by_user: 0 }), messages: await listMessages(req.params.id) });
}));

supportRouter.post('/tickets/:id/messages', asyncRoute(async (req, res) => {
  const body = cleanBody(req.body?.body || req.body?.message);
  const attachment = cleanAttachment(req.body?.attachment);
  if (body.length < 1 && !attachment) throw new HttpError(400, 'message required');
  const storedBody = body || 'Rasm yuborildi';
  const row = await getTicketForUser(req.params.id, req.user.id);
  if (!row) throw new HttpError(404, 'ticket not found');

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_role, body, metadata)
       VALUES ($1, $2, 'user', $3, $4)`,
      [req.params.id, req.user.id, storedBody, JSON.stringify({ source: 'web-client', attachment })]
    );
    await client.query(
      `UPDATE support_tickets
          SET status = CASE WHEN status = 'closed' THEN 'open' ELSE 'open' END,
              unread_by_staff = unread_by_staff + 1,
              unread_by_user = 0,
              last_message_at = now(),
              last_user_message_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [req.params.id]
    );
  });

  const full = await getTicketForUser(req.params.id, req.user.id);
  res.json({ ticket: ticket(full), messages: await listMessages(req.params.id) });
}));

supportRouter.post('/tickets/:id/close', asyncRoute(async (req, res) => {
  const row = await getTicketForUser(req.params.id, req.user.id);
  if (!row) throw new HttpError(404, 'ticket not found');
  await query(
    `UPDATE support_tickets
        SET status = 'closed', unread_by_user = 0, updated_at = now()
      WHERE id = $1`,
    [req.params.id]
  );
  const full = await getTicketForUser(req.params.id, req.user.id);
  res.json({ ticket: ticket(full) });
}));

supportRouter.use('/admin', adminRequired, requireSupportPermission);

supportRouter.get('/admin/stats', asyncRoute(async (_req, res) => {
  const r = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'open')::int AS open,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'answered')::int AS answered,
       COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
       COALESCE(SUM(unread_by_staff), 0)::int AS unread_staff,
       COUNT(*) FILTER (WHERE priority IN ('high', 'urgent') AND status <> 'closed')::int AS urgent
     FROM support_tickets`
  );
  res.json(r.rows[0] || {});
}));

supportRouter.get('/admin/tickets', asyncRoute(async (req, res) => {
  const limit = intParam(req.query.limit, 40, 1, 100);
  const offset = intParam(req.query.offset, 0, 0, 100000);
  const status = cleanText(req.query.status, 24).toLowerCase();
  const q = cleanText(req.query.q, 80);
  const params = [];
  const where = [];
  if (STATUSES.has(status)) {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(t.subject ILIKE $${params.length} OR u.username ILIKE $${params.length} OR u.nickname ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, offset);
  const r = await query(
    `SELECT t.*, u.username, u.nickname, u.email,
            au.username AS assigned_username, au.nickname AS assigned_nickname,
            lm.body AS last_message,
            mc.message_count,
            COUNT(*) OVER()::int AS total_count
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN users au ON au.id = t.assigned_admin_id
       LEFT JOIN LATERAL (
         SELECT body FROM support_ticket_messages
          WHERE ticket_id = t.id
          ORDER BY created_at DESC LIMIT 1
       ) lm ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS message_count FROM support_ticket_messages
          WHERE ticket_id = t.id
       ) mc ON TRUE
       ${whereSql}
      ORDER BY
        CASE WHEN t.status = 'open' THEN 0 WHEN t.status = 'pending' THEN 1 WHEN t.status = 'answered' THEN 2 ELSE 3 END,
        t.last_message_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ tickets: r.rows.map(ticket), total: Number(r.rows[0]?.total_count || 0) });
}));

supportRouter.get('/admin/tickets/:id', asyncRoute(async (req, res) => {
  const row = await getTicketForStaff(req.params.id);
  if (!row) throw new HttpError(404, 'ticket not found');
  await query('UPDATE support_tickets SET unread_by_staff = 0, updated_at = now() WHERE id = $1', [req.params.id]);
  res.json({ ticket: ticket({ ...row, unread_by_staff: 0 }), messages: await listMessages(req.params.id, { staff: true }) });
}));

supportRouter.post('/admin/tickets/:id/messages', asyncRoute(async (req, res) => {
  const body = cleanBody(req.body?.body || req.body?.message);
  const attachment = cleanAttachment(req.body?.attachment);
  const internal = !!req.body?.internal;
  if (body.length < 1 && !attachment) throw new HttpError(400, 'message required');
  const storedBody = body || 'Rasm yuborildi';
  const row = await getTicketForStaff(req.params.id);
  if (!row) throw new HttpError(404, 'ticket not found');

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_role, body, metadata, is_internal)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, req.user.id, senderRole(req.user), storedBody, JSON.stringify({ source: 'admin-panel', attachment }), internal]
    );
    await client.query(
      `UPDATE support_tickets
          SET status = CASE WHEN $2 = TRUE THEN status ELSE 'answered' END,
              assigned_admin_id = COALESCE(assigned_admin_id, $3),
              unread_by_user = unread_by_user + CASE WHEN $2 = TRUE THEN 0 ELSE 1 END,
              unread_by_staff = 0,
              last_message_at = now(),
              last_staff_message_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [req.params.id, internal, req.user.id]
    );
    await client.query(
      'INSERT INTO audit_log (admin_id, action, target_id, metadata) VALUES ($1, $2, $3, $4)',
      [req.user.id, internal ? 'support_note' : 'support_reply', req.params.id, JSON.stringify({ internal })]
    ).catch(() => {});
  });

  const full = await getTicketForStaff(req.params.id);
  res.json({ ticket: ticket(full), messages: await listMessages(req.params.id, { staff: true }) });
}));

supportRouter.put('/admin/tickets/:id/status', asyncRoute(async (req, res) => {
  const status = validOr(req.body?.status, STATUSES, '');
  const priority = req.body?.priority === undefined ? null : validOr(req.body?.priority, PRIORITIES, '');
  if (!status && !priority) throw new HttpError(400, 'status or priority required');
  const row = await getTicketForStaff(req.params.id);
  if (!row) throw new HttpError(404, 'ticket not found');

  const set = [];
  const params = [];
  if (status) {
    params.push(status);
    set.push(`status = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    set.push(`priority = $${params.length}`);
  }
  params.push(req.params.id);
  await query(
    `UPDATE support_tickets SET ${set.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
    params
  );
  await query(
    'INSERT INTO audit_log (admin_id, action, target_id, metadata) VALUES ($1, $2, $3, $4)',
    [req.user.id, 'support_status', req.params.id, JSON.stringify({ status, priority })]
  ).catch(() => {});
  const full = await getTicketForStaff(req.params.id);
  res.json({ ticket: ticket(full) });
}));

supportRouter.post('/admin/tickets/:id/assign', asyncRoute(async (req, res) => {
  const adminId = cleanText(req.body?.adminId, 80) || req.user.id;
  const row = await getTicketForStaff(req.params.id);
  if (!row) throw new HttpError(404, 'ticket not found');
  await query(
    `UPDATE support_tickets
        SET assigned_admin_id = $2, status = CASE WHEN status = 'closed' THEN 'pending' ELSE status END, updated_at = now()
      WHERE id = $1`,
    [req.params.id, adminId]
  );
  await query(
    'INSERT INTO audit_log (admin_id, action, target_id, metadata) VALUES ($1, $2, $3, $4)',
    [req.user.id, 'support_assign', req.params.id, JSON.stringify({ assignedAdminId: adminId })]
  ).catch(() => {});
  const full = await getTicketForStaff(req.params.id);
  res.json({ ticket: ticket(full) });
}));
