import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, playAttack, playDefense, takeCards, passAttack, viewFor } from '../src/game/engine.js';
import { createDeck, beats } from '../src/game/deck.js';

test('deck has 36 unique cards', () => {
  const d = createDeck();
  assert.equal(d.length, 36);
  const ids = new Set(d.map((c) => c.rank + c.suit));
  assert.equal(ids.size, 36);
});

test('beats: trump beats non-trump, higher same-suit beats lower', () => {
  const trump = 'H';
  assert.equal(beats({ rank: '6', suit: 'S', value: 6 }, { rank: '6', suit: 'H', value: 6 }, trump), true);
  assert.equal(beats({ rank: 'T', suit: 'S', value: 10 }, { rank: 'J', suit: 'S', value: 11 }, trump), true);
  assert.equal(beats({ rank: 'T', suit: 'S', value: 10 }, { rank: '9', suit: 'S', value: 9 }, trump), false);
  assert.equal(beats({ rank: 'A', suit: 'H', value: 14 }, { rank: '6', suit: 'S', value: 6 }, trump), false);
});

test('engine: deals 6 cards each, 2 players', () => {
  const game = createGame({ players: [{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }] });
  assert.equal(game.players.length, 2);
  assert.equal(game.players[0].hand.length, 6);
  assert.equal(game.players[1].hand.length, 6);
  assert.equal(game.deck.length, 36 - 12);
  assert.equal(game.phase, 'attacking');
});

test('engine: full round happy path', () => {
  // Build a deterministic-ish small game and step through
  const game = createGame({ players: [{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }] });
  // Whatever the attacker has, play their lowest non-trump (or trump if no choice)
  const attacker = game.players[game.attackerIdx];
  const card = attacker.hand[0];
  const r1 = playAttack(game, attacker.id, card);
  assert.equal(r1.ok, true);
  // Defender either beats or takes — try to find a beating card
  const defender = game.players[game.defenderIdx];
  let beaten = false;
  for (const c of defender.hand) {
    if (beats(card, c, game.trumpSuit)) {
      const r2 = playDefense(game, defender.id, c);
      if (r2.ok) { beaten = true; break; }
    }
  }
  if (!beaten) takeCards(game, defender.id);
  // Attacker passes (or takeCards already advanced)
  if (game.phase === 'attacking' && game.table.length > 0) {
    passAttack(game, attacker.id);
  }
  // Game state should still be valid
  assert.ok(game.players[0].hand.length <= 12);
  assert.ok(game.players[1].hand.length <= 12);
});

test('viewFor hides other players hands', () => {
  const game = createGame({ players: [{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }] });
  const view = viewFor(game, 'a');
  assert.ok(view.players[0].hand);
  assert.equal(view.players[1].hand, undefined);
  assert.ok(typeof view.players[1].handSize === 'number');
  assert.equal(view.configuredDeckSize, 36);
  assert.equal(view.deckRemaining, game.deck.length);
  assert.equal(Object.hasOwn(view, 'deckSize'), false);
});

test('viewFor keeps public player profile image metadata', () => {
  const game = createGame({
    players: [
      { id: 'a', username: 'A', nickname: 'alpha', avatar_url: '/a.png', selected_avatar_frame: 'gold' },
      { id: 'b', username: 'B', avatar_url: '/b.png' },
    ],
  });
  const view = viewFor(game, 'a');
  assert.equal(view.players[0].nickname, 'alpha');
  assert.equal(view.players[0].avatar_url, '/a.png');
  assert.equal(view.players[0].selected_avatar_frame, 'gold');
  assert.equal(view.players[1].avatar_url, '/b.png');
});

test('viewFor masks face-down bluff attacks from opponents', () => {
  const game = createGame({
    bluffEnabled: true,
    players: [{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }],
  });
  const attacker = game.players[game.attackerIdx];
  const card = attacker.hand[0];
  const res = playAttack(game, attacker.id, card, { bluff: true, claimedRank: '6' });
  assert.equal(res.ok, true);

  const defenderView = viewFor(game, game.players[game.defenderIdx].id);
  assert.deepEqual(defenderView.table[0].attack, { faceDown: true });
  assert.equal(defenderView.table[0].claimedRank, '6');

  const blufferView = viewFor(game, attacker.id);
  assert.equal(blufferView.table[0].attack.rank, card.rank);
  assert.equal(blufferView.table[0].attack.suit, card.suit);
});

test('engine: invalid attack rank rejected', () => {
  const game = createGame({ players: [{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }] });
  const attacker = game.players[game.attackerIdx];
  // Capture the card BEFORE it's spliced out of the hand so we can compare
  // the rank-on-table against any subsequent throw-in attempt.
  const firstCard = attacker.hand[0];
  playAttack(game, attacker.id, firstCard);
  // Try to throw in another card whose rank doesn't match table
  const otherAttacker = game.players[game.attackerIdx];
  const wrongRank = otherAttacker.hand.find((c) => c.rank !== firstCard.rank);
  if (wrongRank) {
    const res = playAttack(game, otherAttacker.id, wrongRank);
    assert.equal(res.ok, false);
  }
});

test('engine: round closes after defense when no attacker can throw in', () => {
  const game = createGame({
    players: [
      { id: 'a', username: 'A' },
      { id: 'b', username: 'B' },
      { id: 'c', username: 'C' },
      { id: 'd', username: 'D' },
    ],
  });
  game.trumpSuit = 'H';
  game.deck = [];
  game.attackerIdx = 0;
  game.defenderIdx = 1;
  game.phase = 'attacking';
  game.players[0].hand = [{ rank: '6', suit: 'S', value: 6 }, { rank: 'A', suit: 'H', value: 14 }];
  game.players[1].hand = [{ rank: '7', suit: 'S', value: 7 }, { rank: 'Q', suit: 'H', value: 12 }];
  game.players[2].hand = [{ rank: '8', suit: 'D', value: 8 }];
  game.players[3].hand = [{ rank: '9', suit: 'C', value: 9 }];

  assert.equal(playAttack(game, 'a', '6S').ok, true);
  assert.equal(playDefense(game, 'b', '7S').ok, true);

  assert.equal(game.table.length, 0);
  assert.equal(game.phase, 'attacking');
  assert.equal(game.attackerIdx, 1);
});

test('engine: pass advances throw-in turn to next eligible attacker', () => {
  const game = createGame({
    players: [
      { id: 'a', username: 'A' },
      { id: 'b', username: 'B' },
      { id: 'c', username: 'C' },
      { id: 'd', username: 'D' },
    ],
  });
  game.trumpSuit = 'H';
  game.deck = [];
  game.attackerIdx = 0;
  game.defenderIdx = 1;
  game.phase = 'attacking';
  game.players[0].hand = [{ rank: '6', suit: 'S', value: 6 }, { rank: '6', suit: 'D', value: 6 }];
  game.players[1].hand = [{ rank: '7', suit: 'S', value: 7 }, { rank: 'Q', suit: 'H', value: 12 }];
  game.players[2].hand = [{ rank: '8', suit: 'D', value: 8 }];
  game.players[3].hand = [{ rank: '6', suit: 'C', value: 6 }];

  assert.equal(playAttack(game, 'a', '6S').ok, true);
  assert.equal(playDefense(game, 'b', '7S').ok, true);
  assert.equal(game.attackerIdx, 0);

  assert.equal(passAttack(game, 'a').ok, true);
  assert.equal(game.phase, 'attacking');
  assert.equal(game.attackerIdx, 3);
});
