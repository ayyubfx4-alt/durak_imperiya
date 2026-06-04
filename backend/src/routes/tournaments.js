import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';
import { bracketSnapshot, canBroadcastTournament } from '../services/tournamentEngine.js';
import { getIo, getRoomManager } from '../game/socketRegistry.js';
import { requireFeature } from '../services/progression.js';

export const tournamentsRouter = Router();

const medalFor = { 1: 'gold', 2: 'silver', 3: 'bronze' };
const PUBLIC_TOURNAMENT_FILTER = `
        WHERE status IN ('scheduled','running')
          AND (
            status = 'running'
            OR starts_at IS NULL
            OR starts_at >= now() - INTERVAL '1 day'
          )`;

async function fillBotEntries(client, tournamentId, maxPlayers) {
  const count = await client.query(
    'SELECT count(*)::int AS c FROM tournament_entries WHERE tournament_id = $1',
    [tournamentId]
  );
  const missing = Math.max(0, Number(maxPlayers) - Number(count.rows[0]?.c || 0));
  if (!missing) return 0;

  const bots = await client.query(
    `SELECT id FROM bot_pool
      WHERE id NOT IN (
        SELECT bot_id FROM tournament_entries WHERE tournament_id = $1 AND bot_id IS NOT NULL
      )
      ORDER BY random()
      LIMIT $2`,
    [tournamentId, missing]
  );
  for (let i = 0; i < missing; i++) {
    const botId = bots.rows[i]?.id || `tournament-bot-${tournamentId}-${i + 1}`;
    await client.query(
      `INSERT INTO tournament_entries (tournament_id, bot_id, seed)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [tournamentId, botId, i + 1]
    );
  }
  return missing;
}

async function settlePlacements({ tournamentId, placements, adminId }) {
  if (!Array.isArray(placements) || placements.length === 0) {
    throw new HttpError(400, 'placements array required');
  }

  const paid = [];
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament:${tournamentId}`]);
    const t = await client.query(
      `SELECT id, name, status, max_players,
              prize_first_gold_coins, prize_second_gold_coins, prize_third_gold_coins
         FROM tournaments
        WHERE id = $1
        FOR UPDATE`,
      [tournamentId]
    );
    if (!t.rows[0]) throw new HttpError(404, 'tournament not found');
    await fillBotEntries(client, tournamentId, t.rows[0].max_players);

    const prizes = [
      Number(t.rows[0].prize_first_gold_coins || 0),
      Number(t.rows[0].prize_second_gold_coins || 0),
      Number(t.rows[0].prize_third_gold_coins || 0),
    ];

    for (const row of placements) {
      const place = Math.floor(Number(row.place ?? row.placement));
      const userId = String(row.userId || '');
      if (!userId || ![1, 2, 3].includes(place)) continue;

      await client.query(
        `UPDATE tournament_entries
            SET placement = $1, eliminated_at = COALESCE(eliminated_at, now())
          WHERE tournament_id = $2 AND user_id = $3`,
        [place, tournamentId, userId]
      );

      const prize = prizes[place - 1] || 0;
      const payout = await client.query(
        `INSERT INTO tournament_payouts (tournament_id, user_id, placement, medal, gold_coins, awarded_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tournament_id, placement) DO NOTHING
         RETURNING id`,
        [tournamentId, userId, place, medalFor[place], prize, adminId]
      );
      if (!payout.rows[0]) continue;

      if (prize > 0) {
        await client.query('UPDATE users SET gold_coins = gold_coins + $1 WHERE id = $2', [prize, userId]);
        await client.query(
          `INSERT INTO gold_transactions (user_id, amount, type, reference_id, metadata)
           VALUES ($1, $2, 'tournament_prize', $3, $4)`,
          [userId, prize, tournamentId, { tournamentName: t.rows[0].name, place, medal: medalFor[place] }]
        );
      }
      paid.push({ userId, placement: place, goldCoins: prize, medal: medalFor[place] });
    }

    await client.query("UPDATE tournaments SET status = 'finished' WHERE id = $1", [tournamentId]);
  });
  return paid;
}

tournamentsRouter.get('/', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT id, name, starts_at, status, max_players, entry_gold_coins,
              prize_first_gold_coins, prize_second_gold_coins, prize_third_gold_coins,
              table_size, bluff_enabled, created_at,
              (SELECT count(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entries,
              (SELECT count(*) FROM tournament_entries e WHERE e.tournament_id = t.id AND e.eliminated_at IS NULL) AS remaining,
              bracket_seeded
         FROM tournaments t
        ${PUBLIC_TOURNAMENT_FILTER}
        ORDER BY coalesce(starts_at, created_at) ASC
        LIMIT 50`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

tournamentsRouter.get('/hall-of-fame', async (_req, res, next) => {
  try {
    const r = await query(
      `SELECT p.tournament_id, p.user_id, p.placement, p.medal, p.gold_coins, p.awarded_at,
              t.name AS tournament_name, t.starts_at,
              u.username, u.nickname, u.avatar_url, u.rank_wins
         FROM tournament_payouts p
         JOIN tournaments t ON t.id = p.tournament_id
         LEFT JOIN users u ON u.id = p.user_id
        ORDER BY date_trunc('month', COALESCE(t.starts_at, p.awarded_at)) DESC,
                 p.placement ASC, p.awarded_at DESC
        LIMIT 200`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

tournamentsRouter.get('/overview', async (_req, res, next) => {
  try {
    const [active, topPlayers, hall] = await Promise.all([
      query(
        `SELECT id, name, starts_at, status, max_players, entry_gold_coins,
                prize_first_gold_coins, prize_second_gold_coins, prize_third_gold_coins,
                table_size, bluff_enabled, created_at,
                (SELECT count(*) FROM tournament_entries e WHERE e.tournament_id = t.id)::int AS entries,
                (SELECT count(*) FROM tournament_entries e WHERE e.tournament_id = t.id AND e.eliminated_at IS NULL)::int AS remaining,
                bracket_seeded
           FROM tournaments t
          ${PUBLIC_TOURNAMENT_FILTER}
          ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END,
                   coalesce(starts_at, created_at) ASC
          LIMIT 10`
      ),
      query(
        `SELECT id, username, nickname, avatar_url, rank_wins, gold_coins, games_won
           FROM users
          WHERE is_banned = FALSE
            AND is_admin IS NOT TRUE
            AND is_bot IS NOT TRUE
          ORDER BY games_won DESC, gold_coins DESC, username ASC
          LIMIT 10`
      ),
      query(
        `SELECT p.tournament_id, p.user_id, p.placement, p.medal, p.gold_coins, p.awarded_at,
                t.name AS tournament_name,
                u.username, u.nickname, u.avatar_url
           FROM tournament_payouts p
           JOIN tournaments t ON t.id = p.tournament_id
           LEFT JOIN users u ON u.id = p.user_id
          ORDER BY p.awarded_at DESC, p.placement ASC
          LIMIT 12`
      ),
    ]);
    const featured = active.rows[0] || null;
    res.json({
      featured,
      tournaments: active.rows,
      topPlayers: topPlayers.rows,
      hall: hall.rows,
      entry: {
        goldCoins: config.game.tournament.entryGoldCoins,
        ticketAccepted: true,
      },
      prizes: featured ? [
        { place: '1', goldCoins: Number(featured.prize_first_gold_coins || config.game.tournament.prizeFirstGoldCoins), dollars: 500 },
        { place: '2', goldCoins: Number(featured.prize_second_gold_coins || config.game.tournament.prizeSecondGoldCoins), dollars: 250 },
        { place: '3', goldCoins: Number(featured.prize_third_gold_coins || config.game.tournament.prizeThirdGoldCoins), dollars: 150 },
        { place: '4 - 10', goldCoins: 75_000, dollars: 75 },
        { place: '11 - 32', goldCoins: 25_000, dollars: 25 },
      ] : [],
      broadcastThreshold: config.game.tournament.broadcastThreshold,
    });
  } catch (err) { next(err); }
});

tournamentsRouter.post('/:id/register', authRequired, requireFeature('tournament'), async (req, res, next) => {
  try {
    const tournamentId = req.params.id;
    let result;
    await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament:${tournamentId}`]);
      const t = await client.query(
        `SELECT id, name, status, max_players, entry_gold_coins
           FROM tournaments
          WHERE id = $1
          FOR UPDATE`,
        [tournamentId]
      );
      if (!t.rows[0]) throw new HttpError(404, 'tournament not found');
      if (t.rows[0].status !== 'scheduled') throw new HttpError(400, 'registration closed');

      const existing = await client.query(
        'SELECT id FROM tournament_entries WHERE tournament_id = $1 AND user_id = $2',
        [tournamentId, req.user.id]
      );
      if (existing.rows[0]) {
        result = { ok: true, entryId: existing.rows[0].id, alreadyRegistered: true };
        return;
      }

      const slots = await client.query(
        'SELECT count(*)::int AS c FROM tournament_entries WHERE tournament_id = $1',
        [tournamentId]
      );
      if (Number(slots.rows[0].c) >= Number(t.rows[0].max_players)) throw new HttpError(409, 'tournament full');

      const cost = Number(t.rows[0].entry_gold_coins) || config.game.tournament.entryGoldCoins;
      const lock = await client.query('SELECT gold_coins, tournament_tickets FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      if (!lock.rows[0]) throw new HttpError(404, 'user not found');
      const useTicket = Number(lock.rows[0].tournament_tickets || 0) > 0 && req.body?.payWith !== 'gold';
      if (useTicket) {
        await client.query('UPDATE users SET tournament_tickets = tournament_tickets - 1 WHERE id = $1', [req.user.id]);
      } else {
        if (Number(lock.rows[0].gold_coins) < cost) throw new HttpError(400, 'insufficient gold coins');
        await client.query('UPDATE users SET gold_coins = gold_coins - $1 WHERE id = $2', [cost, req.user.id]);
        await client.query(
          `INSERT INTO gold_transactions (user_id, amount, type, reference_id, metadata)
           VALUES ($1, $2, 'tournament_entry', $3, $4)`,
          [req.user.id, -cost, tournamentId, { tournamentName: t.rows[0].name }]
        );
      }
      const ins = await client.query(
        'INSERT INTO tournament_entries (tournament_id, user_id) VALUES ($1, $2) RETURNING id',
        [tournamentId, req.user.id]
      );
      result = { ok: true, entryId: ins.rows[0].id, debitedGoldCoins: useTicket ? 0 : cost, usedTicket: useTicket };
    });
    res.json(result);
  } catch (err) { next(err); }
});

tournamentsRouter.get('/:id/bracket', async (req, res, next) => {
  try {
    const snap = await bracketSnapshot({ query }, req.params.id);
    if (!snap) throw new HttpError(404, 'tournament not found');
    const broadcast = await canBroadcastTournament({ query }, req.params.id, config.game.tournament.broadcastThreshold);
    if (!broadcast.allowed) {
      throw new HttpError(403, `bracket opens when ${config.game.tournament.broadcastThreshold} players remain`);
    }
    res.json({ ...snap, remaining: broadcast.remaining, viewers: await liveViewerCount(req.params.id), gifts: await recentGifts(req.params.id) });
  } catch (err) { next(err); }
});

tournamentsRouter.post('/:id/matches/:matchId/room', authRequired, requireFeature('tournament'), async (req, res, next) => {
  try {
    const manager = getRoomManager();
    if (!manager) throw new HttpError(503, 'game server is not ready');
    const tournamentId = req.params.id;
    const matchId = req.params.matchId;
    let payload;
    await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament-match:${matchId}`]);
      const m = await client.query(
        `SELECT m.id, m.tournament_id, m.round_no, m.match_no, m.status, m.room_code,
                m.entry_a_id, m.entry_b_id,
                ea.user_id AS a_user_id, ea.bot_id AS a_bot_id,
                eb.user_id AS b_user_id, eb.bot_id AS b_bot_id
           FROM tournament_matches m
           LEFT JOIN tournament_entries ea ON ea.id = m.entry_a_id
           LEFT JOIN tournament_entries eb ON eb.id = m.entry_b_id
          WHERE m.id = $1 AND m.tournament_id = $2
          FOR UPDATE`,
        [matchId, tournamentId]
      );
      const match = m.rows[0];
      if (!match) throw new HttpError(404, 'match not found');
      if (match.status === 'done') throw new HttpError(400, 'match already finished');
      if (!match.entry_a_id || !match.entry_b_id) throw new HttpError(400, 'match participants are not ready');
      const userEntryIds = [match.a_user_id, match.b_user_id].filter(Boolean);
      if (!userEntryIds.includes(req.user.id)) throw new HttpError(403, 'only match participant can open this room');
      if (match.room_code && manager.get(match.room_code)) {
        payload = { roomCode: match.room_code, alreadyLive: true };
        return;
      }
      const room = manager.createRoom({
        maxPlayers: 2,
        stake: 0,
        mode: 'tournament',
        bluffEnabled: false,
        isPrivate: false,
        deckSize: 36,
        turnSeconds: 30,
        transferEnabled: true,
        throwInMode: 'neighbor',
        allowDraw: true,
        botLevel: 'hard',
        host: { id: req.user.id, username: req.user.username },
        tournamentMatch: {
          tournamentId,
          matchId,
          entries: [
            { entryId: match.entry_a_id, userId: match.a_user_id, botId: match.a_bot_id },
            { entryId: match.entry_b_id, userId: match.b_user_id, botId: match.b_bot_id },
          ],
        },
      });
      await client.query(
        `UPDATE tournament_matches
            SET room_code = $1, status = 'live', started_at = COALESCE(started_at, now())
          WHERE id = $2`,
        [room.code, matchId]
      );
      payload = { roomCode: room.code, alreadyLive: false };
    });
    res.json({ ok: true, ...payload });
  } catch (err) { next(err); }
});

tournamentsRouter.post('/:id/gift', authRequired, requireFeature('tournament'), requireFeature('gift_system'), async (req, res, next) => {
  try {
    const tournamentId = req.params.id;
    const recipientEntryId = String(req.body?.recipientEntryId || '');
    const allowedTypes = new Set(['emoji', 'sticker_pack', 'card_skin', 'badge']);
    const itemType = String(req.body?.itemType || 'emoji');
    const itemId = String(req.body?.itemId || '');
    const quantity = Math.max(1, Math.min(3, Number(req.body?.quantity) || 1));
    if (!recipientEntryId || !allowedTypes.has(itemType) || !itemId) throw new HttpError(400, 'invalid gift');

    let gift;
    await withTransaction(async (client) => {
      const t = await client.query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
      if (!t.rows[0]) throw new HttpError(404, 'tournament not found');
      const rec = await client.query(
        'SELECT id, user_id FROM tournament_entries WHERE id = $1 AND tournament_id = $2',
        [recipientEntryId, tournamentId]
      );
      if (!rec.rows[0]) throw new HttpError(404, 'recipient not found');
      const inv = await client.query(
        `UPDATE inventory
            SET quantity = quantity - $4
          WHERE user_id = $1 AND item_type = $2 AND item_id = $3 AND quantity >= $4
          RETURNING id`,
        [req.user.id, itemType, itemId, quantity]
      );
      if (!inv.rows[0]) throw new HttpError(400, 'gift item not available');
      await client.query('DELETE FROM inventory WHERE user_id = $1 AND item_type = $2 AND item_id = $3 AND quantity <= 0', [req.user.id, itemType, itemId]);
      if (rec.rows[0].user_id) {
        await client.query(
          `INSERT INTO inventory (user_id, item_type, item_id, quantity)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, item_type, item_id)
           DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity`,
          [rec.rows[0].user_id, itemType, itemId, quantity]
        );
      }
      const ins = await client.query(
        `INSERT INTO tournament_gifts
          (tournament_id, sender_id, recipient_user_id, recipient_entry_id, item_type, item_id, quantity, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, tournament_id, sender_id, recipient_user_id, recipient_entry_id, item_type, item_id, quantity, message, created_at`,
        [tournamentId, req.user.id, rec.rows[0].user_id, recipientEntryId, itemType, itemId, quantity, String(req.body?.message || '').slice(0, 120)]
      );
      gift = ins.rows[0];
    });
    getIo()?.emit('tournament:gift', gift);
    res.json({ ok: true, gift });
  } catch (err) { next(err); }
});

tournamentsRouter.get('/:id/entries', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT e.id, e.user_id, e.bot_id, e.placement, e.eliminated_at, e.registered_at,
              u.username, u.avatar_url, b.username AS bot_username
         FROM tournament_entries e
         LEFT JOIN users u ON u.id = e.user_id
         LEFT JOIN bot_pool b ON b.id = e.bot_id
        WHERE e.tournament_id = $1
        ORDER BY e.placement NULLS LAST, e.registered_at ASC`,
      [req.params.id]
    );
    res.json(r.rows.map((row) => ({ ...row, username: row.username || row.bot_username })));
  } catch (err) { next(err); }
});

async function recentGifts(tournamentId) {
  const r = await query(
    `SELECT g.id, g.item_type, g.item_id, g.quantity, g.message, g.created_at,
            su.username AS sender_name, ru.username AS recipient_name
       FROM tournament_gifts g
       LEFT JOIN users su ON su.id = g.sender_id
       LEFT JOIN users ru ON ru.id = g.recipient_user_id
      WHERE g.tournament_id = $1
      ORDER BY g.created_at DESC
      LIMIT 20`,
    [tournamentId]
  );
  return r.rows;
}

async function liveViewerCount(tournamentId) {
  const io = getIo();
  const roomName = `tournament:${tournamentId}`;
  if (!io) return 0;
  const sockets = await io.in(roomName).fetchSockets().catch(() => []);
  return sockets.length;
}

tournamentsRouter.post('/:id/settle', authRequired, async (req, res, next) => {
  try {
    if (!req.user.is_admin) throw new HttpError(403, 'admin only');
    const payouts = await settlePlacements({
      tournamentId: req.params.id,
      placements: req.body?.placements || [],
      adminId: req.user.id,
    });
    res.json({ ok: true, payouts });
  } catch (err) { next(err); }
});

export { settlePlacements };
