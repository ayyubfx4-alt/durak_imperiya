// Tournament Engine — single-elimination bracket with auto-advance and
// prize distribution. Companion to routes/tournaments.js (registration)
// and routes/admin.js (manual settle for legacy data).
//
// Design:
//   1. `seedBracket(tournamentId)` is called by an admin (or scheduler)
//      once registration closes. We snapshot the entries, fill empty seats
//      with bots from `bot_pool`, shuffle, and create N/2 first-round
//      matches. Total rounds = ceil(log2(N)).
//   2. Each match creates a `tournament_matches` row. When the game ends,
//      `recordMatchResult({matchId, winnerEntryId})` advances the winner
//      into the next round's match slot. The final-round winner gets gold.
//   3. Prize distribution follows TOR §5: 1st = prize_first_gold_coins,
//      2nd = prize_second_gold_coins, semi-finalists share third place.
//   4. Idempotent: every state-changing call uses an advisory lock keyed
//      on the tournament id, so concurrent admin clicks don't double-pay.

import { withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { logger } from '../logger.js';

const MEDAL = { 1: 'gold', 2: 'silver', 3: 'bronze' };

/** Shuffle in place — Fisher-Yates. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Next power of two ≥ n (minimum 2). */
function nextPow2(n) {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/**
 * Fill empty slots with random bots from the global bot_pool. Idempotent —
 * does nothing once entry count == max_players.
 */
async function fillBotEntries(client, tournamentId, maxPlayers) {
  const c = await client.query(
    'SELECT count(*)::int AS c FROM tournament_entries WHERE tournament_id = $1',
    [tournamentId]
  );
  const missing = Math.max(0, Number(maxPlayers) - Number(c.rows[0]?.c || 0));
  if (!missing) return 0;
  const bots = await client.query(
    `SELECT id FROM bot_pool
       WHERE id NOT IN (
         SELECT bot_id FROM tournament_entries
          WHERE tournament_id = $1 AND bot_id IS NOT NULL
       )
       ORDER BY random()
       LIMIT $2`,
    [tournamentId, missing]
  );
  for (let i = 0; i < missing; i++) {
    const botId = bots.rows[i]?.id || `t-bot-${tournamentId}-${i}`;
    await client.query(
      `INSERT INTO tournament_entries (tournament_id, bot_id, seed)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [tournamentId, botId, 1000 + i]
    );
  }
  return missing;
}

/**
 * Seed a single-elimination bracket. Called once per tournament. After this
 * call, `current_round = 1`, all round-1 matches exist with status='pending',
 * and `bracket_rounds = log2(playerCount)`.
 */
export async function seedBracket(tournamentId) {
  let summary = null;
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bracket:${tournamentId}`]);
    const t = await client.query(
      `SELECT id, name, status, max_players, bracket_seeded
         FROM tournaments WHERE id = $1 FOR UPDATE`,
      [tournamentId]
    );
    if (!t.rows[0]) throw new HttpError(404, 'tournament not found');
    if (t.rows[0].bracket_seeded) throw new HttpError(409, 'bracket already seeded');

    const totalSlots = nextPow2(Number(t.rows[0].max_players) || 4);
    await fillBotEntries(client, tournamentId, totalSlots);

    const entries = await client.query(
      `SELECT id, user_id, bot_id
         FROM tournament_entries
        WHERE tournament_id = $1
        ORDER BY registered_at ASC`,
      [tournamentId]
    );
    const seats = shuffle(entries.rows.slice(0, totalSlots));
    const rounds = Math.log2(totalSlots);
    let matchNo = 1;
    for (let i = 0; i < seats.length; i += 2) {
      await client.query(
        `INSERT INTO tournament_matches
           (tournament_id, round_no, match_no, entry_a_id, entry_b_id, status)
         VALUES ($1, 1, $2, $3, $4, 'pending')`,
        [tournamentId, matchNo++, seats[i].id, seats[i + 1].id]
      );
    }
    await client.query(
      `UPDATE tournaments
          SET bracket_rounds = $1,
              current_round  = 1,
              bracket_seeded = TRUE,
              status         = 'running'
        WHERE id = $2`,
      [rounds, tournamentId]
    );
    summary = { tournamentId, rounds, slots: totalSlots, matches: seats.length / 2 };
  });
  logger.info('[bracket] seeded', summary);
  return summary;
}

/**
 * Record the result of a single match. The winner is propagated into the
 * paired match slot in round_no+1. If both entries in the next match are
 * filled, that match becomes playable. When the final round is won, we
 * call `payoutPlacements` to distribute Gold Coins and end the tournament.
 */
export async function recordMatchResult({ matchId, winnerEntryId }) {
  if (!matchId || !winnerEntryId) {
    throw new HttpError(400, 'matchId and winnerEntryId required');
  }
  let result = null;
  await withTransaction(async (client) => {
    const m = await client.query(
      `SELECT id, tournament_id, round_no, match_no, entry_a_id, entry_b_id, winner_entry_id, status
         FROM tournament_matches WHERE id = $1 FOR UPDATE`,
      [matchId]
    );
    if (!m.rows[0]) throw new HttpError(404, 'match not found');
    if (m.rows[0].status === 'done') {
      return; // idempotent re-call
    }
    if (![m.rows[0].entry_a_id, m.rows[0].entry_b_id].includes(winnerEntryId)) {
      throw new HttpError(400, 'winner must be one of the match participants');
    }
    const loserEntryId = m.rows[0].entry_a_id === winnerEntryId
      ? m.rows[0].entry_b_id
      : m.rows[0].entry_a_id;
    const tournamentId = m.rows[0].tournament_id;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bracket:${tournamentId}`]);

    await client.query(
      `UPDATE tournament_matches
          SET winner_entry_id = $1, status = 'done', finished_at = now()
        WHERE id = $2`,
      [winnerEntryId, matchId]
    );
    if (loserEntryId) {
      await client.query(
        `UPDATE tournament_entries
            SET eliminated_at = COALESCE(eliminated_at, now())
          WHERE id = $1`,
        [loserEntryId]
      );
    }

    const t = await client.query(
      'SELECT bracket_rounds, current_round FROM tournaments WHERE id = $1 FOR UPDATE',
      [tournamentId]
    );
    const isFinal = m.rows[0].round_no >= Number(t.rows[0].bracket_rounds || 0);

    if (!isFinal) {
      const nextRound = m.rows[0].round_no + 1;
      const nextMatchNo = Math.ceil(m.rows[0].match_no / 2);
      const sideA = (m.rows[0].match_no % 2 === 1);
      const existing = await client.query(
        `SELECT id, entry_a_id, entry_b_id
           FROM tournament_matches
          WHERE tournament_id = $1 AND round_no = $2 AND match_no = $3
          FOR UPDATE`,
        [tournamentId, nextRound, nextMatchNo]
      );
      if (existing.rows[0]) {
        const col = sideA ? 'entry_a_id' : 'entry_b_id';
        await client.query(
          `UPDATE tournament_matches SET ${col} = $1 WHERE id = $2`,
          [winnerEntryId, existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO tournament_matches
             (tournament_id, round_no, match_no, entry_a_id, entry_b_id, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [tournamentId, nextRound, nextMatchNo, sideA ? winnerEntryId : null, sideA ? null : winnerEntryId]
        );
      }
      // Advance the round counter when all current-round matches are done.
      const pending = await client.query(
        `SELECT count(*)::int AS c FROM tournament_matches
          WHERE tournament_id = $1 AND round_no = $2 AND status <> 'done'`,
        [tournamentId, m.rows[0].round_no]
      );
      if (Number(pending.rows[0].c) === 0) {
        await client.query('UPDATE tournaments SET current_round = $1 WHERE id = $2', [nextRound, tournamentId]);
      }
      result = { matchId, advancedTo: { round: nextRound, match: nextMatchNo } };
    } else {
      // Champion crowned — pay everyone.
      const payouts = await payoutPlacementsInternal(client, tournamentId);
      result = { matchId, championEntry: winnerEntryId, payouts };
    }
  });
  return result;
}

/**
 * Inspect the tournament tree, derive 1st/2nd/3rd-4th placements from match
 * results, and credit Gold Coins. Called automatically when the final match
 * finishes. Idempotent — uses ON CONFLICT on (tournament_id, placement).
 */
async function payoutPlacementsInternal(client, tournamentId) {
  const t = await client.query(
    `SELECT id, name, bracket_rounds, prize_first_gold_coins,
            prize_second_gold_coins, prize_third_gold_coins
       FROM tournaments WHERE id = $1`,
    [tournamentId]
  );
  if (!t.rows[0]) throw new HttpError(404, 'tournament not found');
  const finalRow = await client.query(
    `SELECT entry_a_id, entry_b_id, winner_entry_id
       FROM tournament_matches
      WHERE tournament_id = $1 AND round_no = $2`,
    [tournamentId, t.rows[0].bracket_rounds]
  );
  const finalMatch = finalRow.rows[0];
  if (!finalMatch || !finalMatch.winner_entry_id) {
    throw new HttpError(400, 'final match not finished');
  }
  const champion = finalMatch.winner_entry_id;
  const runnerUp = finalMatch.entry_a_id === champion ? finalMatch.entry_b_id : finalMatch.entry_a_id;
  const semiLosers = await client.query(
    `SELECT
        CASE WHEN entry_a_id = winner_entry_id THEN entry_b_id ELSE entry_a_id END AS loser
       FROM tournament_matches
      WHERE tournament_id = $1 AND round_no = $2 AND winner_entry_id IS NOT NULL`,
    [tournamentId, t.rows[0].bracket_rounds - 1]
  );
  const thirdPair = semiLosers.rows.map((r) => r.loser).filter(Boolean);

  const prizes = [
    Number(t.rows[0].prize_first_gold_coins) || 0,
    Number(t.rows[0].prize_second_gold_coins) || 0,
    Number(t.rows[0].prize_third_gold_coins) || 0,
  ];

  const placements = [
    { entryId: champion, place: 1, gold: prizes[0] },
    { entryId: runnerUp, place: 2, gold: prizes[1] },
    ...thirdPair.map((eid) => ({ entryId: eid, place: 3, gold: prizes[2] })),
  ].filter((p) => !!p.entryId);

  const paid = [];
  for (const p of placements) {
    const e = await client.query(
      'SELECT user_id, bot_id FROM tournament_entries WHERE id = $1',
      [p.entryId]
    );
    const userId = e.rows[0]?.user_id;
    await client.query(
      `UPDATE tournament_entries SET placement = $1, eliminated_at = COALESCE(eliminated_at, now())
        WHERE id = $2`,
      [p.place, p.entryId]
    );
    if (!userId) { paid.push({ ...p, userId: null, bot: true }); continue; } // bot
    const ins = await client.query(
      `INSERT INTO tournament_payouts (tournament_id, user_id, placement, medal, gold_coins)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tournament_id, placement) DO NOTHING
       RETURNING id`,
      [tournamentId, userId, p.place, MEDAL[p.place], p.gold]
    );
    if (!ins.rows[0]) continue;
    if (p.gold > 0) {
      await client.query('UPDATE users SET gold_coins = gold_coins + $1 WHERE id = $2', [p.gold, userId]);
      await client.query(
        `INSERT INTO gold_transactions (user_id, amount, type, reference_id, metadata)
         VALUES ($1, $2, 'tournament_prize', $3, $4)`,
        [userId, p.gold, tournamentId, { tournamentName: t.rows[0].name, placement: p.place, medal: MEDAL[p.place], auto: true }]
      );
    }
    paid.push({ ...p, userId });
  }
  await client.query("UPDATE tournaments SET status = 'finished' WHERE id = $1", [tournamentId]);
  return paid;
}

/** Public entry — wraps the internal payout call in a transaction. Used
 *  by admin /tournaments/:id/auto-settle for tournaments where matches
 *  were resolved manually. */
export async function payoutPlacements(tournamentId) {
  let result;
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bracket:${tournamentId}`]);
    result = await payoutPlacementsInternal(client, tournamentId);
  });
  return result;
}

export async function tournamentRemainingCount(client, tournamentId) {
  const r = await client.query(
    `SELECT count(*)::int AS c
       FROM tournament_entries
      WHERE tournament_id = $1
        AND eliminated_at IS NULL`,
    [tournamentId]
  );
  return Number(r.rows[0]?.c || 0);
}

export async function canBroadcastTournament(client, tournamentId, threshold = 32) {
  const t = await client.query(
    `SELECT id, status, bracket_seeded
       FROM tournaments
      WHERE id = $1`,
    [tournamentId]
  );
  if (!t.rows[0]) return { exists: false, allowed: false, remaining: 0 };
  const remaining = await tournamentRemainingCount(client, tournamentId);
  const allowed = !!t.rows[0].bracket_seeded && remaining > 0 && remaining <= threshold;
  return { exists: true, allowed, remaining };
}

/** Convenience for the admin panel: full bracket snapshot. */
export async function bracketSnapshot(client, tournamentId) {
  const q = (sql, params) => client.query(sql, params);
  const t = await q(
    `SELECT id, name, status, bracket_rounds, current_round, bracket_seeded,
            prize_first_gold_coins, prize_second_gold_coins, prize_third_gold_coins
       FROM tournaments WHERE id = $1`,
    [tournamentId]
  );
  if (!t.rows[0]) return null;
  const matches = await q(
    `SELECT m.id, m.round_no, m.match_no, m.status, m.winner_entry_id, m.room_code, m.viewer_count,
            m.entry_a_id, m.entry_b_id, m.started_at, m.finished_at,
            ea.user_id AS a_user, ea.bot_id AS a_bot,
            eb.user_id AS b_user, eb.bot_id AS b_bot,
            ua.username AS a_username, ub.username AS b_username,
            ba.username AS a_bot_name, bb.username AS b_bot_name
       FROM tournament_matches m
       LEFT JOIN tournament_entries ea ON ea.id = m.entry_a_id
       LEFT JOIN tournament_entries eb ON eb.id = m.entry_b_id
       LEFT JOIN users ua ON ua.id = ea.user_id
       LEFT JOIN users ub ON ub.id = eb.user_id
       LEFT JOIN bot_pool ba ON ba.id = ea.bot_id
       LEFT JOIN bot_pool bb ON bb.id = eb.bot_id
      WHERE m.tournament_id = $1
      ORDER BY m.round_no, m.match_no`,
    [tournamentId]
  );
  return { tournament: t.rows[0], matches: matches.rows };
}
