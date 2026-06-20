import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { query, withTransaction } from '../db.js';
import {
  giftCardSkin,
  giftStickerPack,
  recentGiftsForUser,
} from '../services/gifts.js';
import { isUserOnline, socketIdsForUser } from '../game/socket.js';
import { getRegistry } from '../game/socketRegistry.js';

export const friendsRouter = Router();

const COLLECTIBLE_GIFT_ONLY_ERROR = "Faqat ortiqcha sticker pack va tasodifiy tushgan ortiqcha karta sovg'a qilinadi";
const FRIEND_MESSAGE_LIMIT = 80;

function collectibleGiftOnly(_req, res) {
  return res.status(403).json({ error: COLLECTIBLE_GIFT_ONLY_ERROR });
}

friendsRouter.use(authRequired);

function cleanInviteQuery(value) {
  return String(value || '').trim().replace(/^@+/, '').slice(0, 64);
}

function mapInviteUser(row) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    country_code: row.country_code || null,
    avatar_url: row.avatar_url,
    rank_wins: row.rank_wins,
    status: row.status || null,
    online: isUserOnline(row.id),
  };
}

function dmRoomId(userId, friendId) {
  return `dm:${[String(userId), String(friendId)].sort().join(':')}`;
}

async function ensureAcceptedFriend(userId, friendId) {
  if (!friendId || friendId === userId) {
    throw Object.assign(new Error('invalid friend'), { statusCode: 400 });
  }
  const r = await query(
    `SELECT 1
       FROM friends
      WHERE user_id = $1
        AND friend_id = $2
        AND status = 'accepted'
      LIMIT 1`,
    [userId, friendId]
  );
  if (!r.rows[0]) {
    throw Object.assign(new Error("Faqat do'stlaringizga xabar yuborishingiz mumkin"), { statusCode: 403 });
  }
}

function mapFriendMessage(row, viewerId) {
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    content: row.content,
    type: row.type || 'text',
    sentAt: row.sent_at,
    mine: String(row.sender_id) === String(viewerId),
    senderUsername: row.sender_username || null,
    senderNickname: row.sender_nickname || null,
  };
}

function emitFriendMessage(recipientId, payload) {
  const { io } = getRegistry();
  if (!io) return;
  for (const socketId of socketIdsForUser(recipientId)) {
    io.to(socketId).emit('friend:message', payload);
  }
}

// Room invites are part of the table flow, so they must work even before the
// full Friends section is unlocked by progression.
friendsRouter.get('/room-invite/list', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT u.id, u.username, u.nickname, u.country_code, u.avatar_url, u.rank_wins, f.status
         FROM friends f
         JOIN users u ON u.id = f.friend_id
        WHERE f.user_id = $1
          AND f.status = 'accepted'
          AND u.is_banned = FALSE
          AND u.is_bot IS NOT TRUE
        ORDER BY u.username ASC
        LIMIT 100`,
      [req.user.id]
    );
    res.json(r.rows.map(mapInviteUser));
  } catch (err) { next(err); }
});

friendsRouter.get('/room-invite/search', async (req, res, next) => {
  try {
    const q = cleanInviteQuery(req.query.q || req.query.nick);
    if (q.length < 2) return res.json([]);

    const r = await query(
      `SELECT u.id, u.username, u.nickname, u.country_code, u.avatar_url, u.rank_wins, f.status
         FROM users u
         LEFT JOIN friends f
           ON f.user_id = $2
          AND f.friend_id = u.id
        WHERE u.id <> $2
          AND u.is_banned = FALSE
          AND u.is_bot IS NOT TRUE
          AND (
            lower(u.nickname) LIKE lower($1)
            OR lower(u.username) LIKE lower($1)
          )
        ORDER BY
          CASE WHEN f.status = 'accepted' THEN 0 ELSE 1 END,
          u.rank_wins DESC,
          u.username ASC
        LIMIT 20`,
      [`${q}%`, req.user.id]
    );
    res.json(r.rows.map(mapInviteUser));
  } catch (err) { next(err); }
});

friendsRouter.get('/list', authRequired, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT u.id, u.username, u.nickname, u.country_code, u.avatar_url, u.rank_wins, u.coins,
              u.premium_until, f.status, f.created_at
         FROM friends f JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = $1 ORDER BY f.created_at DESC`,
      [req.user.id]
    );
    res.json(r.rows.map((friend) => ({
      ...friend,
      online: isUserOnline(friend.id),
    })));
  } catch (err) { next(err); }
});

friendsRouter.post('/request', authRequired, async (req, res, next) => {
  try {
    const friendId = String(req.body?.friendId || '');
    if (!friendId || friendId === req.user.id) return res.status(400).json({ error: 'invalid friend' });
    const exists = await query('SELECT id FROM users WHERE id = $1', [friendId]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'user not found' });
    await withTransaction(async (client) => {
      await client.query(
        "INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING",
        [req.user.id, friendId]
      );
      await client.query(
        "INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING",
        [friendId, req.user.id]
      );
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

friendsRouter.post('/accept', authRequired, async (req, res, next) => {
  try {
    const friendId = String(req.body?.friendId || '');
    await withTransaction(async (client) => {
      await client.query("UPDATE friends SET status = 'accepted' WHERE user_id = $1 AND friend_id = $2", [req.user.id, friendId]);
      await client.query("UPDATE friends SET status = 'accepted' WHERE user_id = $1 AND friend_id = $2", [friendId, req.user.id]);
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

friendsRouter.post('/remove', authRequired, async (req, res, next) => {
  try {
    const friendId = String(req.body?.friendId || '');
    await withTransaction(async (client) => {
      await client.query('DELETE FROM friends WHERE user_id = $1 AND friend_id = $2', [req.user.id, friendId]);
      await client.query('DELETE FROM friends WHERE user_id = $1 AND friend_id = $2', [friendId, req.user.id]);
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

friendsRouter.post('/gift/coins', authRequired, collectibleGiftOnly);

// Money, gold, emoji, and badge gifts are closed. Only extra collectible
// sticker packs and random card skin copies can be sent between friends.
friendsRouter.post('/gift/gold', authRequired, collectibleGiftOnly);

friendsRouter.post('/gift/emoji', authRequired, collectibleGiftOnly);

friendsRouter.post('/gift/skin', authRequired, async (req, res, next) => {
  try {
    const r = await giftCardSkin({
      senderId: req.user.id,
      recipientId: String(req.body?.friendId || ''),
      skinId: String(req.body?.skinId || ''),
      message: req.body?.message,
      quantity: req.body?.quantity,
    });
    res.json(r);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

friendsRouter.post('/gift/badge', authRequired, collectibleGiftOnly);

friendsRouter.post('/gift/sticker', authRequired, async (req, res, next) => {
  try {
    const r = await giftStickerPack({
      senderId: req.user.id,
      recipientId: String(req.body?.friendId || ''),
      packId: String(req.body?.packId || ''),
      message: req.body?.message,
    });
    res.json(r);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

friendsRouter.get('/gifts/inbox', authRequired, async (req, res, next) => {
  try {
    const rows = await recentGiftsForUser(req.user.id, req.query.limit);
    res.json(rows);
  } catch (err) { next(err); }
});

friendsRouter.get('/messages/unread', authRequired, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS unread
         FROM messages
        WHERE room_id LIKE 'dm:%'
          AND meta->>'recipientId' = $1
          AND COALESCE((meta->>'read')::boolean, FALSE) = FALSE`,
      [req.user.id]
    );
    res.json({ unread: Number(r.rows[0]?.unread || 0) });
  } catch (err) { next(err); }
});

friendsRouter.get('/messages/:friendId', authRequired, async (req, res, next) => {
  try {
    const friendId = String(req.params.friendId || '');
    await ensureAcceptedFriend(req.user.id, friendId);
    const roomId = dmRoomId(req.user.id, friendId);
    await query(
      `UPDATE messages
          SET meta = COALESCE(meta, '{}'::jsonb) || '{"read":true}'::jsonb
        WHERE room_id = $1
          AND meta->>'recipientId' = $2`,
      [roomId, req.user.id]
    );
    const limit = Math.min(FRIEND_MESSAGE_LIMIT, Math.max(1, Number(req.query.limit || FRIEND_MESSAGE_LIMIT)));
    const r = await query(
      `SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.sent_at,
              u.username AS sender_username, u.nickname AS sender_nickname
         FROM messages m
         JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1
        ORDER BY m.sent_at DESC
        LIMIT $2`,
      [roomId, limit]
    );
    res.json(r.rows.reverse().map((row) => mapFriendMessage(row, req.user.id)));
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

friendsRouter.post('/messages/:friendId', authRequired, async (req, res, next) => {
  try {
    const friendId = String(req.params.friendId || '');
    const content = String(req.body?.content || '').trim().slice(0, 1000);
    if (!content) return res.status(400).json({ error: 'Xabar matnini kiriting' });
    await ensureAcceptedFriend(req.user.id, friendId);
    const roomId = dmRoomId(req.user.id, friendId);
    const r = await query(
      `INSERT INTO messages (room_id, sender_id, content, type, meta)
       VALUES ($1, $2, $3, 'text', $4)
       RETURNING id, room_id, sender_id, content, type, sent_at`,
      [roomId, req.user.id, content, { recipientId: friendId, read: false }]
    );
    const message = mapFriendMessage({
      ...r.rows[0],
      sender_username: req.user.username,
      sender_nickname: req.user.nickname,
    }, req.user.id);
    emitFriendMessage(friendId, { ...message, mine: false, friendId: req.user.id });
    res.json({ ok: true, message });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

friendsRouter.get('/search', authRequired, async (req, res, next) => {
  try {
    // Support ?nick=anvar (exact @nickname prefix) or legacy ?q=name (display name)
    const nick = String(req.query.nick || '').slice(0, 64);
    const q    = String(req.query.q    || '').slice(0, 64);

    if (!nick && q.length < 2) return res.json([]);

    let r;
    if (nick) {
      r = await query(
        `SELECT id, nickname, username, country_code, avatar_url, rank_wins
           FROM users
           WHERE lower(nickname) LIKE lower($1) AND id <> $2 AND is_banned = FALSE AND is_bot IS NOT TRUE
           ORDER BY rank_wins DESC LIMIT 20`,
        [`${nick.toLowerCase()}%`, req.user.id]
      );
    } else {
      r = await query(
        `SELECT id, nickname, username, country_code, avatar_url, rank_wins
           FROM users
           WHERE (lower(username) LIKE lower($1) OR lower(nickname) LIKE lower($1))
             AND id <> $2 AND is_banned = FALSE AND is_bot IS NOT TRUE
           ORDER BY rank_wins DESC LIMIT 20`,
        [`%${q}%`, req.user.id]
      );
    }
    res.json(r.rows);
  } catch (err) { next(err); }
});
