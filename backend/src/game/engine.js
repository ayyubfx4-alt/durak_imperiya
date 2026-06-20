import { dealInitial, beats, lowestTrump, cardId, parseCard, isValidCard, RANK_VALUE } from './deck.js';
import { uuid } from '../util/random.js';

/**
 * Durak game engine — pure state machine. Owns no I/O.
 *
 * Phases:
 *   - 'attacking'   : at least one attacker can play cards onto the table
 *   - 'defending'   : defender must beat the most recent attack card
 *   - 'ended'       : someone is durak (or draw)
 *
 * Round end:
 *   - Defender beats all → table goes to discard, next attacker = current defender
 *   - Defender takes → defender keeps cards in hand, next attacker = player after defender
 */

export function createGame({
  players,
  mode = 'classic',
  bluffEnabled = false,
  stake = 0,
  deckSize = 36,
  transferEnabled = false,
  throwInMode = 'all',
  allowDraw = true,
}) {
  // TOR §3: supported table sizes are 2 / 3 / 4 / 6 players.
  const ALLOWED_SIZES = [2, 3, 4, 6];
  if (!ALLOWED_SIZES.includes(players.length)) {
    throw new Error(`players must be one of ${ALLOWED_SIZES.join(', ')}`);
  }
  const normalizedDeckSize = [24, 36, 52].includes(Number(deckSize)) ? Number(deckSize) : 36;
  const { hands, deck, trumpCard, trumpSuit } = dealInitial(players.length, 6, normalizedDeckSize);

  // First attacker = player with lowest trump; tiebreak: earliest index
  let firstAttacker = 0;
  let bestTrump = null;
  hands.forEach((hand, i) => {
    const lt = lowestTrump(hand, trumpSuit);
    if (lt && (!bestTrump || lt.value < bestTrump.value)) {
      bestTrump = lt;
      firstAttacker = i;
    }
  });

  const state = {
    id: uuid(),
    mode,
    bluffEnabled,
    stake,
    deckSize: normalizedDeckSize,
    transferEnabled: !!transferEnabled,
    throwInMode: throwInMode === 'neighbor' ? 'neighbor' : 'all',
    allowDraw: allowDraw !== false,
    trumpSuit,
    trumpCard,
    deck,
    discard: [],
    players: players.map((p, i) => ({
      id: p.id,
      username: p.username,
      nickname: p.nickname || null,
      avatar_url: p.avatar_url || null,
      selected_avatar_frame: p.selected_avatar_frame || null,
      country_code: p.country_code || null,
      isBot: !!p.isBot,
      botLevel: p.botLevel || null,
      hand: hands[i],
      out: false,
      bluffsCaught: 0,
      bluffsMade: 0,
    })),
    table: [], // [{ attack: card, defense: card | null, faceDown?: boolean, claimedRank?: string }]
    attackerIdx: firstAttacker,
    defenderIdx: (firstAttacker + 1) % players.length,
    phase: 'attacking',
    pendingDoneFromAttackers: new Set(),
    winnerOrder: [], // ids in order they emptied hands
    durakId: null,
    history: [],
    startedAt: Date.now(),
    endedAt: null,
  };

  return state;
}

function nextAlive(state, fromIdx, step = 1) {
  const n = state.players.length;
  let idx = fromIdx;
  for (let i = 0; i < n; i++) {
    idx = (idx + step + n) % n;
    if (!state.players[idx].out) return idx;
  }
  return fromIdx;
}

/** Players who can throw in attack cards (everyone except defender, and not out, with cards). */
function attackerIndices(state) {
  if (state.throwInMode !== 'all') {
    const p = state.players[state.attackerIdx];
    return p && state.attackerIdx !== state.defenderIdx && !p.out && p.hand.length > 0
      ? [state.attackerIdx]
      : [];
  }
  return state.players
    .map((_, i) => i)
    .filter((i) => i !== state.defenderIdx && !state.players[i].out && state.players[i].hand.length > 0);
}

export function transferAttack(state, playerId, cardArg) {
  if (state.phase === 'ended') return { ok: false, error: 'game ended' };
  if (!state.transferEnabled) return { ok: false, error: 'transfer disabled' };
  const playerIdx = state.players.findIndex((p) => p.id === playerId);
  if (playerIdx === -1) return { ok: false, error: 'unknown player' };
  if (playerIdx !== state.defenderIdx) return { ok: false, error: 'not defender' };
  if (state.table.length === 0 || !state.table.every((t) => !t.defense)) {
    return { ok: false, error: 'cannot transfer now' };
  }
  if (state.table.length >= maxAttackCards(state)) return { ok: false, error: 'table full' };

  const card = typeof cardArg === 'string' ? parseCard(cardArg) : cardArg;
  if (!isValidCard(card)) return { ok: false, error: 'invalid card' };
  const ranks = tableRanks(state);
  if (!ranks.has(card.rank)) return { ok: false, error: 'transfer rank mismatch' };

  const player = state.players[playerIdx];
  const handIdx = findCardInHand(player, card);
  if (handIdx === -1) return { ok: false, error: 'card not in hand' };

  const nextDefender = nextAlive(state, state.defenderIdx);
  if (nextDefender === state.defenderIdx) return { ok: false, error: 'no next defender' };

  state.table.push({ attack: card, defense: null });
  player.hand.splice(handIdx, 1);
  state.attackerIdx = playerIdx;
  state.defenderIdx = nextDefender;
  state.phase = 'defending';
  state.pendingDoneFromAttackers.clear();
  state.history.push({ type: 'transfer', playerId, card, toPlayerId: state.players[nextDefender].id, ts: Date.now() });
  return { ok: true };
}

function tableRanks(state) {
  const set = new Set();
  for (const t of state.table) {
    if (t.attack) set.add(t.claimedRank || t.attack.rank);
    if (t.defense) set.add(t.defense.rank);
  }
  return set;
}

function unbeatenAttack(state) {
  for (let i = state.table.length - 1; i >= 0; i--) {
    if (!state.table[i].defense) return state.table[i];
  }
  return null;
}

/**
 * Maximum number of attack cards allowed in a round = defender's starting hand size, capped at 6.
 * Simpler approximation: cap at 6 always (standard "perevod" durak variants vary).
 */
function maxAttackCards(state) {
  const defenderHandStart = state.players[state.defenderIdx].hand.length + state.table.filter(t => t.defense).length;
  return Math.min(6, Math.max(1, defenderHandStart));
}

function findCardInHand(player, card) {
  if (!isValidCard(card)) return -1;
  const id = cardId(card);
  return player.hand.findIndex((c) => cardId(c) === id);
}

function validAttackCards(state, playerIdx) {
  const player = state.players[playerIdx];
  if (!player || player.out || playerIdx === state.defenderIdx) return [];
  if (state.table.length >= maxAttackCards(state)) return [];
  if (state.table.length === 0) return player.hand.slice();
  const ranks = tableRanks(state);
  return player.hand.filter((c) => ranks.has(c.rank));
}

function nextEligibleAttacker(state, fromIdx, { inclusive = false } = {}) {
  const n = state.players.length;
  for (let step = inclusive ? 0 : 1; step <= n; step++) {
    const idx = (fromIdx + step) % n;
    const player = state.players[idx];
    if (
      idx !== state.defenderIdx &&
      player &&
      !player.out &&
      player.hand.length > 0 &&
      !state.pendingDoneFromAttackers.has(player.id) &&
      validAttackCards(state, idx).length > 0
    ) {
      return idx;
    }
  }
  return -1;
}

/**
 * Attempt: attacker plays a card onto the table.
 * cardArg may be a card object or a card-id string ("AS", "TH"…).
 */
export function playAttack(state, playerId, cardArg, options = {}) {
  if (state.phase === 'ended') return { ok: false, error: 'game ended' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'unknown player' };
  if (player.out) return { ok: false, error: 'player out' };

  const attackerIdxs = attackerIndices(state);
  if (!attackerIdxs.includes(state.players.indexOf(player))) {
    return { ok: false, error: 'not your turn to attack' };
  }

  const card = typeof cardArg === 'string' ? parseCard(cardArg) : cardArg;
  if (!isValidCard(card)) return { ok: false, error: 'invalid card' };
  const handIdx = findCardInHand(player, card);
  if (handIdx === -1) return { ok: false, error: 'card not in hand' };

  const attackRank = options.bluff && state.bluffEnabled ? String(options.claimedRank || '').toUpperCase() : card.rank;
  if (options.bluff && state.bluffEnabled && !RANK_VALUE[attackRank]) {
    return { ok: false, error: 'invalid claimed rank' };
  }

  // First card of a round: any card/claim. Subsequent attacks must match a visible or claimed rank.
  if (state.table.length > 0) {
    const ranks = tableRanks(state);
    if (!ranks.has(attackRank)) return { ok: false, error: 'rank not on table' };
  }

  // Cap attack cards
  if (state.table.length >= maxAttackCards(state)) {
    return { ok: false, error: 'table full' };
  }

  // Bluff (face-down) play — optional
  if (options.bluff && state.bluffEnabled) {
    state.table.push({
      attack: card,
      defense: null,
      faceDown: true,
      claimedRank: attackRank,
      bluffer: player.id,
    });
    player.bluffsMade += 1;
  } else {
    state.table.push({ attack: card, defense: null });
  }
  player.hand.splice(handIdx, 1);
  state.pendingDoneFromAttackers.delete(player.id);
  state.phase = 'defending';
  state.history.push({ type: 'attack', playerId, card, ts: Date.now() });

  // If defender has no cards left somehow, end round immediately
  if (state.players[state.defenderIdx].hand.length === 0) {
    return endRound(state, { defenderTook: false });
  }
  return { ok: true };
}

/**
 * Defender plays a card to beat the most recent unbeaten attack.
 */
export function playDefense(state, playerId, cardArg) {
  if (state.phase === 'ended') return { ok: false, error: 'game ended' };
  const playerIdx = state.players.findIndex((p) => p.id === playerId);
  if (playerIdx === -1) return { ok: false, error: 'unknown player' };
  if (playerIdx !== state.defenderIdx) return { ok: false, error: 'not defender' };

  const player = state.players[playerIdx];
  const card = typeof cardArg === 'string' ? parseCard(cardArg) : cardArg;
  if (!isValidCard(card)) return { ok: false, error: 'invalid card' };
  const handIdx = findCardInHand(player, card);
  if (handIdx === -1) return { ok: false, error: 'card not in hand' };

  const open = unbeatenAttack(state);
  if (!open) return { ok: false, error: 'no attack to beat' };

  if (open.faceDown) {
    return { ok: false, error: 'must reveal/challenge bluff first' };
  }

  if (!beats(open.attack, card, state.trumpSuit)) {
    return { ok: false, error: 'card does not beat attack' };
  }

  open.defense = card;
  player.hand.splice(handIdx, 1);
  state.history.push({ type: 'defense', playerId, card, ts: Date.now() });

  // If all attacks beaten and defender has no cards → round ends with success
  const allBeaten = state.table.every((t) => t.defense);
  if (allBeaten && player.hand.length === 0) {
    return endRound(state, { defenderTook: false });
  }
  // Switch back to attacking phase if all beaten (attackers may add more)
  if (allBeaten) {
    const nextAttacker = nextEligibleAttacker(state, state.attackerIdx, { inclusive: true });
    if (nextAttacker === -1) {
      return endRound(state, { defenderTook: false });
    }
    state.attackerIdx = nextAttacker;
    state.pendingDoneFromAttackers.clear();
    state.phase = 'attacking';
  }
  return { ok: true };
}

/**
 * Defender chooses to take all cards on table.
 */
export function takeCards(state, playerId) {
  if (state.phase === 'ended') return { ok: false, error: 'game ended' };
  const playerIdx = state.players.findIndex((p) => p.id === playerId);
  if (playerIdx !== state.defenderIdx) return { ok: false, error: 'not defender' };
  return endRound(state, { defenderTook: true });
}

/**
 * An attacker signals "done" / pass. Round ends when all eligible attackers pass and table not empty.
 */
export function passAttack(state, playerId) {
  if (state.phase === 'ended') return { ok: false, error: 'game ended' };
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx === -1) return { ok: false, error: 'unknown player' };
  if (idx === state.defenderIdx) return { ok: false, error: 'defender cannot pass' };
  if (state.phase !== 'attacking') return { ok: false, error: 'cannot pass during defense' };
  if (state.table.length === 0) return { ok: false, error: 'cannot pass empty table' };

  state.pendingDoneFromAttackers.add(playerId);

  const attackerIdxs = attackerIndices(state).filter((i) => validAttackCards(state, i).length > 0);
  const allDone = attackerIdxs.every((i) => state.pendingDoneFromAttackers.has(state.players[i].id));
  const allBeaten = state.table.every((t) => t.defense);

  if (allDone && allBeaten) {
    return endRound(state, { defenderTook: false });
  }
  // Safety net: if every eligible attacker has signalled done but unbeaten
  // cards remain (e.g. face-down bluffs, or any state where the defender
  // is the only one with cards left to act on), force the defender to take
  // so the table doesn't deadlock waiting for nobody. Without this the
  // game stalls until the defender's 30 s turn timer auto-forfeits them,
  // which mid-round feels like a hang to the player.
  if (allDone && !allBeaten) {
    return endRound(state, { defenderTook: true });
  }
  const nextAttacker = nextEligibleAttacker(state, idx);
  if (nextAttacker !== -1) state.attackerIdx = nextAttacker;
  return { ok: true };
}

/**
 * Challenge a face-down bluff card on the table (peer reveal).
 * If claimedRank matches actual → bluff was truthful → challenger picks up the card.
 * If not → bluffer takes the card back + penalty (auto-take their attack).
 */
export function challengeBluff(state, challengerId, tableIdx) {
  if (state.phase === 'ended') return { ok: false, error: 'game ended' };
  if (!state.bluffEnabled) return { ok: false, error: 'bluff not enabled' };

  // Validate challengerId and that the challenger is still in the game.
  const challenger = state.players.find((p) => p.id === challengerId);
  if (!challenger) return { ok: false, error: 'unknown challenger' };
  if (challenger.out) return { ok: false, error: 'challenger is already out' };

  // Validate tableIdx — must be a valid index, never negative or out-of-range.
  if (
    typeof tableIdx !== 'number' ||
    !Number.isInteger(tableIdx) ||
    tableIdx < 0 ||
    tableIdx >= state.table.length
  ) {
    return { ok: false, error: 'invalid table index' };
  }

  const t = state.table[tableIdx];
  if (!t || !t.faceDown) return { ok: false, error: 'no face-down card at index' };

  // A player cannot challenge their own bluff.
  if (t.bluffer === challengerId) return { ok: false, error: 'cannot challenge your own bluff' };

  const truthful = t.attack.rank === t.claimedRank;
  t.faceDown = false;
  if (truthful) {
    // challenger must accept — give them the card
    challenger.hand.push(t.attack);
    state.table.splice(tableIdx, 1);
    state.history.push({ type: 'bluff_truth', challengerId, ts: Date.now() });
  } else {
    // bluffer caught — return card to bluffer, increment caught counter
    const bluffer = state.players.find((p) => p.id === t.bluffer);
    if (bluffer) bluffer.hand.push(t.attack);
    challenger.bluffsCaught += 1;
    state.table.splice(tableIdx, 1);
    state.history.push({ type: 'bluff_caught', challengerId, blufferId: t.bluffer, ts: Date.now() });
  }
  return { ok: true, truthful };
}


function endRound(state, { defenderTook }) {
  // Move table cards
  if (defenderTook) {
    const defender = state.players[state.defenderIdx];
    for (const t of state.table) {
      defender.hand.push(t.attack);
      if (t.defense) defender.hand.push(t.defense);
    }
  } else {
    for (const t of state.table) {
      state.discard.push(t.attack);
      if (t.defense) state.discard.push(t.defense);
    }
  }
  state.table = [];
  state.pendingDoneFromAttackers.clear();

  // Refill hands: attacker first, then in order, defender last
  const order = [];
  let idx = state.attackerIdx;
  for (let i = 0; i < state.players.length; i++) {
    if (idx !== state.defenderIdx && !state.players[idx].out) order.push(idx);
    idx = (idx + 1) % state.players.length;
  }
  if (!state.players[state.defenderIdx].out) order.push(state.defenderIdx);

  for (const pidx of order) {
    const p = state.players[pidx];
    while (p.hand.length < 6 && state.deck.length > 0) {
      p.hand.push(state.deck.pop());
    }
  }

  // Mark players who emptied hand AND deck is empty as "out" (winners)
  for (const p of state.players) {
    if (!p.out && p.hand.length === 0 && state.deck.length === 0) {
      p.out = true;
      if (!state.winnerOrder.includes(p.id)) state.winnerOrder.push(p.id);
    }
  }

  // Determine if game ended
  const remaining = state.players.filter((p) => !p.out);
  if (remaining.length <= 1) {
    state.phase = 'ended';
    state.endedAt = Date.now();
    state.durakId = remaining.length === 1
      ? remaining[0].id
      : (state.allowDraw ? null : state.players[state.defenderIdx]?.id || null);
    return { ok: true, ended: true };
  }

  // Pick next attacker / defender
  if (defenderTook) {
    // Skip defender — next attacker is player after defender
    state.attackerIdx = nextAlive(state, state.defenderIdx, 1);
    state.defenderIdx = nextAlive(state, state.attackerIdx, 1);
  } else {
    // Defender successfully defended → becomes attacker
    state.attackerIdx = state.defenderIdx;
    state.defenderIdx = nextAlive(state, state.attackerIdx, 1);
  }
  if (state.attackerIdx === state.defenderIdx) {
    state.defenderIdx = nextAlive(state, state.attackerIdx, 1);
  }
  state.phase = 'attacking';
  return { ok: true, ended: false };
}

/**
 * Forfeit — TOR §2: a player who fails to act within their turn budget
 * (30 s by default) loses automatically.
 *
 *   • In a 1v1, the forfeiter becomes the durak and the game ends.
 *   • In 3-/4-/6-player games the forfeiter is marked durak and removed; the
 *     remaining players are treated as winners (handles "coins shared"
 *     payout in the caller — see room.finishGame).
 *
 * Returns `{ ok, ended }` analogous to the other engine entry points.
 */
export function forfeit(state, playerId, reason = 'timeout') {
  if (state.phase === 'ended') return { ok: false, error: 'game ended' };
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx === -1) return { ok: false, error: 'unknown player' };
  const player = state.players[idx];
  if (player.out) return { ok: false, error: 'player already out' };

  state.history.push({ type: 'forfeit', playerId, reason, ts: Date.now() });
  state.phase = 'ended';
  state.endedAt = Date.now();
  state.durakId = playerId;
  player.out = true;
  // Everyone else who has not already been recorded as a winner becomes one,
  // in their current seat order. The first surviving player to the
  // forfeiter's left is treated as the "first winner" for prize purposes.
  let walker = (idx + 1) % state.players.length;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[walker];
    if (p.id !== playerId && !state.winnerOrder.includes(p.id)) {
      state.winnerOrder.push(p.id);
    }
    walker = (walker + 1) % state.players.length;
  }
  return { ok: true, ended: true };
}

/** Sanitize state for a specific viewer (hides other hands and face-down cards). */
export function viewFor(state, viewerId) {
  return {
    id: state.id,
    mode: state.mode,
    bluffEnabled: state.bluffEnabled,
    stake: state.stake,
    configuredDeckSize: state.deckSize || 36,
    transferEnabled: !!state.transferEnabled,
    throwInMode: state.throwInMode || 'neighbor',
    allowDraw: state.allowDraw !== false,
    trumpSuit: state.trumpSuit,
    trumpCard: state.trumpCard,
    deckRemaining: state.deck.length,
    discardSize: state.discard.length,
    phase: state.phase,
    attackerIdx: state.attackerIdx,
    defenderIdx: state.defenderIdx,
    table: state.table.map((t) => ({
      attack: t.faceDown && (!viewerId || viewerId !== t.bluffer) ? { faceDown: true } : t.attack,
      defense: t.defense,
      claimedRank: t.faceDown ? t.claimedRank : undefined,
    })),
    players: state.players.map((p) => ({
      id: p.id,
      username: p.username,
      nickname: p.nickname || null,
      avatar_url: p.avatar_url || null,
      selected_avatar_frame: p.selected_avatar_frame || null,
      // We deliberately don't reveal bot identity to clients (TOR §3 says
      // bots must be indistinguishable). The bot flag stays at the room
      // layer only; the game snapshot reports every player as a normal one.
      country_code: p.country_code || null,
      isBot: false,
      handSize: p.hand.length,
      hand: p.id === viewerId ? p.hand : undefined,
      out: p.out,
      bluffsCaught: p.bluffsCaught,
    })),
    winnerOrder: state.winnerOrder,
    durakId: state.durakId,
    forfeit: state.forfeit || null,
    payoutShares: state.payoutShares || [],
    pot: state.pot || 0,
  };
}

export const _internal = { tableRanks, unbeatenAttack, attackerIndices, maxAttackCards, RANK_VALUE };
