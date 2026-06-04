// TOR §11 — Gold Coin in-game perks (normal rooms only, never in
// tournaments). Three perks are supported:
//
//   • peek_opponents : reveal every opponent's hand for N ms     (3 GC)
//   • peek_next_card : reveal the top card of the deck for N ms  (1 GC)
//   • best_move_hint : ask the bot AI for the best move          (1 GC)
//
// The reveal data is computed server-side from the live `gameState` and
// returned via socket ack. The client only receives data it just paid for
// — we never broadcast another player's hand to the room.
import { withTransaction } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';
import { botDecide } from '../game/bot.js';

const PERKS = {
  peek_opponents: 'peekOpponents',
  peek_next_card: 'peekNextCard',
  best_move_hint: 'bestMoveHint',
};

function perkConfigFor(perk) {
  switch (perk) {
    case 'peek_opponents':
      return {
        cost: config.game.perks.peekOpponentsCostGold,
        revealMs: config.game.perks.peekOpponentsRevealMs,
      };
    case 'peek_next_card':
      return {
        cost: config.game.perks.peekNextCardCostGold,
        revealMs: config.game.perks.peekNextCardRevealMs,
      };
    case 'best_move_hint':
      return {
        cost: config.game.perks.bestMoveHintCostGold,
        revealMs: 0,
      };
    default:
      throw new HttpError(400, 'unknown perk');
  }
}

function peekOpponents(state, viewerId) {
  return state.players
    .filter((p) => p.id !== viewerId)
    .map((p) => ({
      id: p.id,
      username: p.username,
      hand: p.hand.map((c) => ({ rank: c.rank, suit: c.suit, value: c.value })),
    }));
}

function peekNextCard(state) {
  if (!state.deck || state.deck.length === 0) return null;
  // engine.js pulls cards via state.deck.pop(), so the very last entry is
  // the next card to be drawn after a round.
  const next = state.deck[state.deck.length - 1];
  return { rank: next.rank, suit: next.suit, value: next.value };
}

function bestMoveHint(state, viewerId) {
  const idx = state.players.findIndex((p) => p.id === viewerId);
  if (idx === -1) return null;
  const player = state.players[idx];
  if (player.out) return null;
  const isMyAttack = state.phase === 'attacking' && state.attackerIdx === idx;
  const isMyDefense = state.phase === 'defending' && state.defenderIdx === idx;
  if (!isMyAttack && !isMyDefense) return { advice: 'wait_for_turn' };
  const decision = botDecide(state, idx, 'hard');
  return {
    action: decision.action,
    card: decision.card ? { rank: decision.card.rank, suit: decision.card.suit } : null,
    tableIdx: decision.tableIdx ?? null,
  };
}

/**
 * Apply a perk. Throws `HttpError` on bad input; debits Gold Coins inside
 * a single transaction so a crash mid-payment cannot leak balance.
 */
export async function applyPerk({ user, perk, room }) {
  if (!PERKS[perk]) throw new HttpError(400, 'unknown perk');
  if (!room) throw new HttpError(404, 'room not found');
  if (room.mode === 'tournament') throw new HttpError(403, 'perks disabled in tournaments');
  if (!room.gameState || room.gameState.phase === 'ended') {
    throw new HttpError(400, 'no active game');
  }
  const state = room.gameState;
  if (!state.players.some((p) => p.id === user.id)) {
    throw new HttpError(403, 'not seated at this table');
  }
  const cfg = perkConfigFor(perk);
  if (cfg.cost <= 0) throw new HttpError(400, 'perk disabled');

  await withTransaction(async (client) => {
    const lock = await client.query(
      'SELECT gold_coins FROM users WHERE id = $1 FOR UPDATE',
      [user.id]
    );
    if (!lock.rows[0]) throw new HttpError(404, 'user not found');
    if (Number(lock.rows[0].gold_coins) < cfg.cost) {
      throw new HttpError(400, 'insufficient gold coins');
    }
    await client.query(
      'UPDATE users SET gold_coins = gold_coins - $1 WHERE id = $2',
      [cfg.cost, user.id]
    );
    await client.query(
      `INSERT INTO gold_transactions (user_id, amount, type, metadata)
       VALUES ($1, $2, 'perk', $3)`,
      [user.id, -cfg.cost, { perk, roomCode: room.code }]
    );
    await client.query(
      `INSERT INTO gold_perks_log (user_id, room_code, game_id, perk, gold_spent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, room.code, state.id || null, perk, cfg.cost, { revealMs: cfg.revealMs }]
    );
  });

  let payload;
  if (perk === 'peek_opponents') payload = { opponents: peekOpponents(state, user.id) };
  else if (perk === 'peek_next_card') payload = { card: peekNextCard(state) };
  else if (perk === 'best_move_hint') payload = { hint: bestMoveHint(state, user.id) };

  return {
    ok: true,
    perk,
    cost: cfg.cost,
    revealMs: cfg.revealMs,
    ...payload,
  };
}

export const PERK_KINDS = Object.keys(PERKS);
