import { shuffle } from '../util/random.js';

// Durak decks: 24 / 36 / 52 cards in 4 suits.
export const SUITS = ['S', 'H', 'D', 'C']; // Spades, Hearts, Diamonds, Clubs
export const RANKS = ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const RANKS_BY_DECK_SIZE = {
  24: ['9', 'T', 'J', 'Q', 'K', 'A'],
  36: RANKS,
  52: ['2', '3', '4', '5', ...RANKS],
};
export const RANK_VALUE = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

export function cardId(card) {
  if (!isValidCard(card)) return '';
  return `${card.rank}${card.suit}`;
}

export function parseCard(id) {
  if (!id || typeof id !== 'string' || id.length < 2) return null;
  const rank = id.slice(0, id.length - 1);
  const suit = id.slice(-1);
  if (!SUITS.includes(suit) || !Object.hasOwn(RANK_VALUE, rank)) return null;
  return { rank, suit, value: RANK_VALUE[rank] };
}

export function isValidCard(card) {
  return !!card
    && typeof card === 'object'
    && typeof card.rank === 'string'
    && typeof card.suit === 'string'
    && SUITS.includes(card.suit)
    && Object.hasOwn(RANK_VALUE, card.rank)
    && typeof card.value === 'number'
    && Number.isFinite(card.value)
    && card.value === RANK_VALUE[card.rank];
}

export function createDeck(deckSize = 36) {
  const ranks = RANKS_BY_DECK_SIZE[deckSize] || RANKS_BY_DECK_SIZE[36];
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of ranks) {
      cards.push({ rank, suit, value: RANK_VALUE[rank] });
    }
  }
  return cards;
}

export function shuffleDeck(deck) {
  return shuffle(deck);
}

/**
 * Deal initial hands. The bottom card of the deck becomes the trump
 * indicator. With a 36-card deck and 6 players the standard hand size is
 * shrunk to 5 so there is always at least one card left to act as the
 * trump indicator (TOR §3 lists 6-player as a supported table size).
 *
 * Returns { hands: card[][], deck: card[], trumpCard: card, trumpSuit: string }
 */
export function dealInitial(playerCount, handSize = 6, deckSize = 36) {
  const deck = shuffleDeck(createDeck(deckSize));
  // Always reserve at least one card as the trump indicator. For 6-player
  // tables this caps the deal at 5 cards per player (35 ÷ 6 ≈ 5).
  const adjustedHandSize = Math.min(handSize, Math.floor((deck.length - 1) / playerCount));
  const hands = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < adjustedHandSize; i++) {
    for (let p = 0; p < playerCount; p++) {
      hands[p].push(deck.pop());
    }
  }
  // The bottom card is the trump indicator and stays at the bottom (drawn last)
  const trumpCard = deck[0];
  return { hands, deck, trumpCard, trumpSuit: trumpCard.suit, handSize: adjustedHandSize };
}

export function isTrump(card, trumpSuit) {
  return isValidCard(card) && card.suit === trumpSuit;
}

/**
 * Can `defense` beat `attack` given the trump suit?
 * - Same suit, higher value, OR
 * - Defense is trump and attack is not trump
 */
export function beats(attack, defense, trumpSuit) {
  if (!isValidCard(attack) || !isValidCard(defense)) return false;
  const aT = isTrump(attack, trumpSuit);
  const dT = isTrump(defense, trumpSuit);
  if (aT && dT) return defense.value > attack.value;
  if (!aT && dT) return true;
  if (!aT && !dT) return defense.suit === attack.suit && defense.value > attack.value;
  return false; // attack is trump, defense is non-trump
}

/**
 * Find lowest trump in a hand. Used to decide first attacker.
 */
export function lowestTrump(hand, trumpSuit) {
  let best = null;
  for (const c of hand) {
    if (c.suit === trumpSuit && (!best || c.value < best.value)) best = c;
  }
  return best;
}
