import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/game/room.js';
import { createGame } from '../src/game/engine.js';
import { cardId } from '../src/game/deck.js';

function fakeIo() {
  const emitted = [];
  const sockets = new Map();
  return {
    emitted,
    sockets: { sockets },
    emit(event, payload) {
      emitted.push({ target: 'root', event, payload });
    },
    to(target) {
      return {
        emit(event, payload) {
          emitted.push({ target, event, payload });
        },
      };
    },
  };
}

function makeTwoHumanRoom() {
  const io = fakeIo();
  const manager = new RoomManager(io);
  const room = manager.createRoom({ maxPlayers: 2, stake: 100, host: { id: 'u1', username: 'host' } });
  room.join({ id: 'u1', username: 'host', socketId: 's1', isBot: false });
  room.join({ id: 'u2', username: 'guest', socketId: 's2', isBot: false });
  io.sockets.sockets.set('s1', { emit(event, payload) { io.emitted.push({ target: 's1', event, payload }); } });
  io.sockets.sockets.set('s2', { emit(event, payload) { io.emitted.push({ target: 's2', event, payload }); } });
  return { io, manager, room };
}

function makeTwoHumanTournamentRoom() {
  const io = fakeIo();
  const manager = new RoomManager(io);
  const room = manager.createRoom({ maxPlayers: 2, mode: 'tournament', stake: 0, host: { id: 'u1', username: 'host' } });
  room.join({ id: 'u1', username: 'host', socketId: 's1', isBot: false });
  room.join({ id: 'u2', username: 'guest', socketId: 's2', isBot: false });
  io.sockets.sockets.set('s1', { emit(event, payload) { io.emitted.push({ target: 's1', event, payload }); } });
  io.sockets.sockets.set('s2', { emit(event, payload) { io.emitted.push({ target: 's2', event, payload }); } });
  return { io, manager, room };
}

test('room start requires the host to explicitly press ready too', async () => {
  const { manager, room } = makeTwoHumanRoom();
  room.setReady('u2', true);

  const start = await room.requestStart('u1');

  assert.equal(start.ok, false);
  assert.equal(start.error, 'all players must be ready');
  manager.destroy(room.code);
});

test('game starts automatically only after every human presses ready', async () => {
  const { io, manager, room } = makeTwoHumanTournamentRoom();

  room.setReady('u1', true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(room.state.phase, 'lobby');
  assert.equal(io.emitted.some((e) => e.event === 'game:start'), false);

  room.setReady('u2', true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(room.state.phase, 'playing');
  assert.equal(io.emitted.some((e) => e.event === 'game:start'), true);
  assert.ok(room.gameState?.players?.every((p) => Array.isArray(p.hand) && p.hand.length > 0));
  manager.destroy(room.code);
});

test('confirmable card action waits for opponent approval before mutating game state', () => {
  const { io, manager, room } = makeTwoHumanRoom();
  room.state.phase = 'playing';
  room.gameState = createGame({ players: room.seats.map((s) => ({ id: s.id, username: s.username })) });
  room.humanActionStats = new Map(room.seats.map((s) => [s.id, { actions: 0, totalTurnMs: 0, actionTypes: {} }]));

  const attacker = room.gameState.players[room.gameState.attackerIdx];
  const card = attacker.hand[0];
  const result = room.requestAction(attacker.id, 'attack', { card: cardId(card) });

  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.equal(room.gameState.table.length, 0);
  assert.equal(io.emitted.some((e) => e.event === 'game:action_confirm_request'), true);

  const approver = room.seats.find((s) => s.id !== attacker.id);
  const confirmed = room.confirmPendingAction(approver.id, result.request.id, true);

  assert.equal(confirmed.ok, true);
  assert.equal(room.gameState.table.length, 1);
  manager.destroy(room.code);
});

test('rejected card action leaves the table unchanged', () => {
  const { manager, room } = makeTwoHumanRoom();
  room.state.phase = 'playing';
  room.gameState = createGame({ players: room.seats.map((s) => ({ id: s.id, username: s.username })) });
  room.humanActionStats = new Map(room.seats.map((s) => [s.id, { actions: 0, totalTurnMs: 0, actionTypes: {} }]));

  const attacker = room.gameState.players[room.gameState.attackerIdx];
  const card = attacker.hand[0];
  const result = room.requestAction(attacker.id, 'attack', { card: cardId(card) });
  const approver = room.seats.find((s) => s.id !== attacker.id);
  const rejected = room.confirmPendingAction(approver.id, result.request.id, false);

  assert.equal(rejected.ok, true);
  assert.equal(rejected.rejected, true);
  assert.equal(room.gameState.table.length, 0);
  assert.equal(room.pendingAction, null);
  manager.destroy(room.code);
});
