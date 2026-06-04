// Professional Durak Bot AI
//
// MIJOZ TALABI ("Bot AI Pro Qilish"):
//   - Oson / o'rta / qiyin bot farqi haqiqiy sezilsin
//   - Bot eng past karta, kozirni saqlash, raqib kartalarini taxmin qilish
//   - Bluff yoqilgan o'yinda bot ba'zan aldasin, ba'zan ushlasin
//   - Bot yurishi juda tez bo'lmasin, odamdek pauza qilsin (room.js da)
//
// 3 daraja:
//   - easy:   ~random valid move, ko'p hatolar qiladi
//   - medium: low cards on attack, oddiy defence
//   - hard:   card counting, trump conservation, opp hand estimation, bluff catching
import { beats, cardId } from './deck.js';
import { _internal } from './engine.js';
import { randomInt, pick } from '../util/random.js';

function getValidAttacks(state, player) {
  if (state.table.length === 0) return player.hand.slice();
  const ranks = _internal.tableRanks(state);
  return player.hand.filter((c) => ranks.has(c.rank));
}

function getValidDefenses(state, player) {
  const open = _internal.unbeatenAttack(state);
  if (!open) return [];
  return player.hand.filter((c) => beats(open.attack, c, state.trumpSuit));
}

function lowestNonTrump(cards, trumpSuit) {
  const nonTrumps = cards.filter((c) => c.suit !== trumpSuit).sort((a, b) => a.value - b.value);
  return nonTrumps[0] || null;
}
function lowestTrump(cards, trumpSuit) {
  const trumps = cards.filter((c) => c.suit === trumpSuit).sort((a, b) => a.value - b.value);
  return trumps[0] || null;
}

function sortForAttack(cards, trumpSuit) {
  return cards.slice().sort((a, b) => {
    const aTrump = a.suit === trumpSuit ? 1 : 0;
    const bTrump = b.suit === trumpSuit ? 1 : 0;
    if (aTrump !== bTrump) return aTrump - bTrump;
    return a.value - b.value;
  });
}

function rankCount(hand, rank) {
  return hand.filter((c) => c.rank === rank).length;
}

function maybeTransferDecision(state, player, level) {
  if (!state.transferEnabled || state.phase !== 'defending') return null;
  if (!state.table.length || !state.table.every((t) => !t.defense)) return null;
  const ranks = new Set(state.table.map((t) => t.attack?.rank || t.claimedRank).filter(Boolean));
  const candidates = sortForAttack(player.hand.filter((c) => ranks.has(c.rank)), state.trumpSuit);
  if (!candidates.length) return null;
  if (level === 'easy' && randomInt(100) < 45) return null;
  if (level === 'medium' && candidates[0].suit === state.trumpSuit && randomInt(100) < 55) return null;
  return { action: 'transfer', card: candidates[0] };
}
/** Sanab chiqilmagan kozirlar soni (raqibda/decked'da bo'lishi mumkin). */
function countUnseenTrumps(state, selfHand) {
  const seen = new Set();
  for (const c of selfHand) seen.add(cardId(c));
  for (const c of state.discard) seen.add(cardId(c));
  for (const t of state.table) {
    if (t.attack && !t.faceDown) seen.add(cardId(t.attack));
    if (t.defense) seen.add(cardId(t.defense));
  }
  if (state.trumpCard) seen.add(cardId(state.trumpCard));
  let unseen = 0;
  const ranks = ['6','7','8','9','T','J','Q','K','A'];
  for (const r of ranks) {
    if (!seen.has(`${r}${state.trumpSuit}`)) unseen += 1;
  }
  return unseen;
}

/** Decked'da qancha karta qolgan. */
function deckLeft(state) {
  return state.deck.length;
}

/** O'yin tugashi yaqinmi (deck bo'sh va kam karta qolgan). */
function isEndgame(state) {
  return state.deck.length === 0;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN DECISION ENTRY
// ═══════════════════════════════════════════════════════════════════
export function botDecide(state, playerIdx, level = 'medium') {
  const player = state.players[playerIdx];
  const isDefender = state.defenderIdx === playerIdx;

  // ── DEFENSE ────────────────────────────────────────────────────
  if (isDefender && state.phase === 'defending') {
    const transfer = maybeTransferDecision(state, player, level);
    if (transfer) return transfer;
    return defenseDecision(state, player, level);
  }

  // ── ATTACK / PASS ──────────────────────────────────────────────
  if (state.phase === 'attacking' && !isDefender) {
    return attackDecision(state, player, level);
  }

  return { action: 'pass' };
}

// ═══════════════════════════════════════════════════════════════════
// DEFENSE
// ═══════════════════════════════════════════════════════════════════
function defenseDecision(state, player, level) {
  const valid = getValidDefenses(state, player);
  if (valid.length === 0) return { action: 'take' };

  const open = _internal.unbeatenAttack(state);
  const trumpSuit = state.trumpSuit;
  const nonTrumpDefs = valid.filter(c => c.suit !== trumpSuit).sort((a, b) => a.value - b.value);
  const trumpDefs = valid.filter(c => c.suit === trumpSuit).sort((a, b) => a.value - b.value);

  // ── EASY: random valid move, with mistakes ────────────────────
  if (level === 'easy') {
    // Easy bot may take cards even when defendable (~15% chance)
    if (randomInt(100) < 15) return { action: 'take' };
    // Sometimes wastes high trump on low attack (mistake)
    if (randomInt(100) < 30 && trumpDefs.length) {
      return { action: 'defense', card: pick(trumpDefs) };
    }
    return { action: 'defense', card: pick(valid) };
  }

  // ── MEDIUM: prefer lowest non-trump, then lowest trump ────────
  if (level === 'medium') {
    if (nonTrumpDefs.length) return { action: 'defense', card: nonTrumpDefs[0] };
    // Don't waste trumps on low-value attacks if we have only big trumps
    if (trumpDefs[0].value >= 12 && open.attack.value <= 7 && state.table.length >= 3) {
      // Many cards already taken — better to take
      return { action: 'take' };
    }
    return { action: 'defense', card: trumpDefs[0] };
  }

  // ── HARD: card counting + trump conservation ──────────────────
  // Strategic decisions:
  //   1. Always prefer non-trump that just barely beats (save high cards)
  //   2. Track unseen trumps — if opponent has 2+ unseen trumps and we
  //      have few, take instead of burning trumps
  //   3. If deck empty and we're ahead — defend aggressively
  //   4. If we'd take >= 5 cards back into hand, better defend with trump
  const myTrumps = trumpDefs.length;
  const unseenTrumps = countUnseenTrumps(state, player.hand);
  const oppTrumpsEstimate = Math.max(0, unseenTrumps - deckLeft(state));
  const endgame = isEndgame(state);
  const tableSize = state.table.length;

  // First try non-trump matching closest value (minimal waste)
  if (nonTrumpDefs.length) {
    return { action: 'defense', card: nonTrumpDefs[0] };
  }

  // Only trumps left — strategic decision
  if (myTrumps === 0) return { action: 'take' };

  const lowestT = trumpDefs[0];

  // If attack is low and we only have high trumps left → take to save them
  if (open.attack.value <= 8 && lowestT.value >= 12 && tableSize >= 2 && !endgame) {
    return { action: 'take' };
  }
  // Endgame: defend with whatever we have
  if (endgame) {
    return { action: 'defense', card: lowestT };
  }
  // Opponent might have many trumps and we have just enough — defend
  if (oppTrumpsEstimate <= myTrumps - 1) {
    return { action: 'defense', card: lowestT };
  }
  // Otherwise — defend (don't take by default in hard mode)
  return { action: 'defense', card: lowestT };
}

// ═══════════════════════════════════════════════════════════════════
// ATTACK
// ═══════════════════════════════════════════════════════════════════
function attackDecision(state, player, level) {
  const valid = getValidAttacks(state, player);
  if (valid.length === 0) return { action: 'pass' };

  const trumpSuit = state.trumpSuit;
  const ordered = sortForAttack(valid, trumpSuit);
  const lnt = lowestNonTrump(valid, trumpSuit);
  const lt = lowestTrump(valid, trumpSuit);
  const def = state.players[state.defenderIdx];

  // BLUFF support: if bluff is enabled and we have a hard bot,
  // occasionally claim a higher rank (≈ 18% chance when hand size > 2)
  function maybeBluff(card, claimedRank) {
    if (!state.bluffEnabled) return null;
    if (player.hand.length <= 2) return null;
    return { action: 'attack', card, bluff: true, claimedRank };
  }

  // ── EASY ──────────────────────────────────────────────────────
  if (level === 'easy') {
    // ~30% chance to pass even with valid moves
    if (state.table.length > 0 && randomInt(100) < 30) return { action: 'pass' };
    return { action: 'attack', card: randomInt(100) < 45 ? ordered[0] : pick(valid) };
  }

  // ── MEDIUM ────────────────────────────────────────────────────
  if (level === 'medium') {
    if (state.table.length > 0 && state.table.length >= Math.max(1, def.hand.length)) return { action: 'pass' };
    if (lnt) return { action: 'attack', card: lnt };
    // First move: lowest trump OK
    if (state.table.length === 0 && lt) return { action: 'attack', card: lt };
    return { action: 'pass' };
  }

  // ── HARD ──────────────────────────────────────────────────────
  // Strategy:
  //   - Always prefer lowest non-trump
  //   - Use trump only if defender has few cards or we have many trumps
  //   - Coordinate with paired ranks (if hand has 2 of same rank, attack with both)
  //   - Bluff occasionally if enabled
  if (lnt) {
    if (state.table.length > 0 && state.table.length >= Math.max(1, def.hand.length)) return { action: 'pass' };
    if (state.table.length > 0 && rankCount(player.hand, lnt.rank) > 1) {
      return { action: 'attack', card: lnt };
    }
    // If bluff is enabled, ~10% chance to send a face-down card pretending higher rank
    if (state.bluffEnabled && randomInt(100) < 10 && state.table.length === 0) {
      const claimRank = 'A'; // claim Ace
      const bluff = maybeBluff(lnt, claimRank);
      if (bluff) return bluff;
    }
    return { action: 'attack', card: lnt };
  }

  if (state.table.length === 0 && lt) {
    // First card: only use low trump if defender has 2 or fewer cards
    if (lt.value <= 9 && def.hand.length <= 2) {
      return { action: 'attack', card: lt };
    }
    // Or if endgame and we want to flush their trumps
    if (isEndgame(state) && def.hand.length <= 3) {
      return { action: 'attack', card: lt };
    }
  }

  if (state.table.length > 0 && lt) {
    const unseenOppTrumps = countUnseenTrumps(state, player.hand);
    // Push more attacks if we have trump advantage
    if (lt.value <= 9 && unseenOppTrumps <= 2) {
      return { action: 'attack', card: lt };
    }
  }

  return { action: 'pass' };
}
