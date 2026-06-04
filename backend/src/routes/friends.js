import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import {
  giftGold,
  giftEmojiPack,
  giftCardSkin,
  giftBadge,
  giftStickerPack,
  recentGiftsForUser,
} from '../services/gifts.js';
import { isUserOnline } from '../game/socket.js';
import { requireFeature } from '../services/progression.js';

export const friendsRouter = Router();

friendsRouter.use(authRequired);

function cleanInviteQuery(value) {
  return String(value || '').trim().replace(/^@+/, '').slice(0, 64);
}

function mapInviteUser(row) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatar_url: row.avatar_url,
    rank_wins: row.rank_wins,
    status: row.status || null,
    online: isUserOnline(row.id),
  };
}

// Room invites are part of the table flow, so they must work even before the
// full Friends section is unlocked by progression.
friendsRouter.get('/room-invite/list', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT u.id, u.username, u.nickname, u.avatar_url, u.rank_wins, f.status
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
      `SELECT u.id, u.username, u.nickname, u.avatar_url, u.rank_wins, f.status
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

friendsRouter.use(requireFeature('friends'));

friendsRouter.get('/list', authRequired, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT u.id, u.username, u.nickname, u.avatar_url, u.rank_wins, u.coins,
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

friendsRouter.post('/gift/coins', authRequired, requireFeature('gift_system'), async (req, res, next) => {
  try {
    const friendId = String(req.body?.friendId || '');
    const amount = Math.max(1, Math.min(Math.floor(Number(req.body?.amount) || 0), 1_000_000));
    if (!friendId || friendId === req.user.id) return res.status(400).json({ error: 'invalid friend' });
    const limit = Math.max(0, Number(config.game.friendCoinGiftDailyLimit || 0));
    const result = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`coin_gift:${req.user.id}`]);
      const fr = await client.query(
        "SELECT status FROM friends WHERE user_id = $1 AND friend_id = $2",
        [req.user.id, friendId]
      );
      if (!fr.rows[0] || fr.rows[0].status !== 'accepted') {
        return { status: 403, body: { error: 'not friends' } };
      }
      const recipient = await client.query(
        'SELECT id FROM users WHERE id = $1 AND is_banned = FALSE AND is_bot IS NOT TRUE',
        [friendId]
      );
      if (!recipient.rows[0]) return { status: 404, body: { error: 'friend not found' } };
      if (limit > 0) {
        const sent = await client.query(
          `SELECT COALESCE(SUM(-amount), 0)::bigint AS sent
             FROM transactions
            WHERE user_id = $1
              AND type = 'gift'
              AND amount < 0
              AND created_at >= date_trunc('day', now())`,
          [req.user.id]
        );
        const sentToday = Number(sent.rows[0]?.sent || 0);
        if (sentToday + amount > limit) {
          return {
            status: 429,
            body: {
              error: 'daily gift limit exceeded',
              dailyLimit: limit,
              sentToday,
              remaining: Math.max(0, limit - sentToday),
            },
          };
        }
      }

      const debit = await client.query(
        'UPDATE users SET coins = coins - $1 WHERE id = $2 AND coins >= $1 RETURNING coins',
        [amount, req.user.id]
      );
      if (!debit.rows[0]) return { status: 400, body: { error: 'insufficient coins' } };
      const credit = await client.query(
        'UPDATE users SET coins = coins + $1 WHERE id = $2 RETURNING coins',
        [amount, friendId]
      );
      if (!credit.rows[0]) throw Object.assign(new Error('friend not found'), { status: 404 });
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, reference_id, metadata)
         VALUES ($1, $2, 'gift', NULL, $3), ($4, $5, 'gift', NULL, $6)`,
        [
          req.user.id,
          -amount,
          { toId: friendId, dailyLimit: limit },
          friendId,
          amount,
          { fromId: req.user.id },
        ]
      );
      return {
        status: 200,
        body: {
          ok: true,
          amount,
          dailyLimit: limit,
          senderCoins: Number(debit.rows[0].coins),
          recipientCoins: Number(credit.rows[0].coins),
        },
      };
    });
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// TOR §12: Gold Coin / emoji / card skin / badge gifts between accepted
// friends. Paid items charge the sender; the recipient receives them in
// their inventory immediately.
friendsRouter.post('/gift/gold', authRequired, requireFeature('gift_system'), async (req, res, next) => {
  try {
    const r = await giftGold({
      senderId: req.user.id,
      recipientId: String(req.body?.friendId || ''),
      amount: req.body?.amount,
    });
    res.json(r);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

friendsRouter.post('/gift/emoji', authRequired, requireFeature('gift_system'), async (req, res, next) => {
  try {
    const r = await giftEmojiPack({
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

friendsRouter.post('/gift/skin', authRequired, requireFeature('gift_system'), async (req, res, next) => {
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

friendsRouter.post('/gift/badge', authRequired, requireFeature('gift_system'), async (req, res, next) => {
  try {
    const r = await giftBadge({
      senderId: req.user.id,
      recipientId: String(req.body?.friendId || ''),
      badgeId: String(req.body?.badgeId || ''),
      message: req.body?.message,
    });
    res.json(r);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

friendsRouter.post('/gift/sticker', authRequired, requireFeature('gift_system'), async (req, res, next) => {
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

friendsRouter.get('/search', authRequired, async (req, res, next) => {
  try {
    // Support ?nick=anvar (exact @nickname prefix) or legacy ?q=name (display name)
    const nick = String(req.query.nick || '').slice(0, 64);
    const q    = String(req.query.q    || '').slice(0, 64);

    if (!nick && q.length < 2) return res.json([]);

    let r;
    if (nick) {
      r = await query(
        `SELECT id, nickname, username, avatar_url, rank_wins
           FROM users
           WHERE lower(nickname) LIKE lower($1) AND id <> $2 AND is_banned = FALSE AND is_bot IS NOT TRUE
           ORDER BY rank_wins DESC LIMIT 20`,
        [`${nick.toLowerCase()}%`, req.user.id]
      );
    } else {
      r = await query(
        `SELECT id, nickname, username, avatar_url, rank_wins
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
