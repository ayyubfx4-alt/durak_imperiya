import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/game/room.js';

function fakeIo() {
  return {
    to() {
      return { emit() {} };
    },
  };
}

test('private room creator can sit and reconnect without re-entering password', () => {
  const manager = new RoomManager(fakeIo());
  const room = manager.createRoom({
    maxPlayers: 2,
    stake: 100,
    isPrivate: true,
    password: '1111',
    host: { id: 'u1', username: 'host' },
  });

  const created = room.join({ id: 'u1', username: 'host', socketId: 's1', isBot: false }, room.password);
  assert.equal(created.ok, true);

  const reconnect = room.join({ id: 'u1', username: 'host', socketId: 's2', isBot: false });
  assert.equal(reconnect.ok, true);
  assert.equal(reconnect.alreadyJoined, true);

  const wrongPassword = room.join({ id: 'u2', username: 'guest', socketId: 's3', isBot: false }, '2222');
  assert.equal(wrongPassword.ok, false);
  assert.equal(wrongPassword.error, 'wrong password');

  const correctPassword = room.join({ id: 'u2', username: 'guest', socketId: 's4', isBot: false }, '1111');
  assert.equal(correctPassword.ok, true);

  manager.destroy(room.code);
});

test('private rooms are listed publicly without exposing the password', () => {
  const manager = new RoomManager(fakeIo());
  const room = manager.createRoom({
    maxPlayers: 2,
    stake: 100,
    isPrivate: true,
    password: '1111',
    host: { id: 'u1', username: 'host' },
  });
  room.join({ id: 'u1', username: 'host', socketId: 's1', isBot: false }, room.password);

  const list = manager.publicList();
  assert.equal(list.length, 1);
  assert.equal(list[0].code, room.code);
  assert.equal(list[0].isPrivate, true);
  assert.equal(list[0].hasPassword, true);
  assert.equal(Object.prototype.hasOwnProperty.call(list[0], 'password'), false);

  manager.destroy(room.code);
});

test('room snapshots include player avatar metadata', () => {
  const manager = new RoomManager(fakeIo());
  const room = manager.createRoom({
    maxPlayers: 2,
    stake: 100,
    host: { id: 'u1', username: 'host', avatar_url: '/host.png' },
  });
  room.join({
    id: 'u1',
    username: 'host',
    nickname: 'boss',
    avatar_url: '/host.png',
    selected_avatar_frame: 'royal',
    socketId: 's1',
    isBot: false,
  });

  const snapshotSeat = room.lobbySnapshot().seats[0];
  const listSeat = manager.publicList()[0].seats[0];
  assert.equal(snapshotSeat.avatar_url, '/host.png');
  assert.equal(snapshotSeat.nickname, 'boss');
  assert.equal(snapshotSeat.selected_avatar_frame, 'royal');
  assert.equal(listSeat.avatar_url, '/host.png');

  manager.destroy(room.code);
});

test('public room list is cached and invalidated on lobby changes', () => {
  const manager = new RoomManager(fakeIo());
  const room = manager.createRoom({
    maxPlayers: 2,
    stake: 100,
    host: { id: 'u1', username: 'host' },
  });
  room.join({ id: 'u1', username: 'host', socketId: 's1', isBot: false });

  const first = manager.publicList();
  const second = manager.publicList();
  assert.equal(second, first);
  assert.equal(first[0].taken, 1);

  room.join({ id: 'u2', username: 'guest', socketId: 's2', isBot: false });
  const afterJoin = manager.publicList();
  assert.notEqual(afterJoin, first);
  assert.equal(afterJoin[0].taken, 2);

  manager.destroy(room.code);
});

test('private invite allows passwordless join but still blocks bots', async () => {
  const manager = new RoomManager(fakeIo());
  const room = manager.createRoom({
    maxPlayers: 3,
    stake: 100,
    isPrivate: true,
    password: '1111',
    host: { id: 'u1', username: 'host' },
  });
  room.join({ id: 'u1', username: 'host', socketId: 's1', isBot: false }, room.password);

  room.grantInvite('u2');
  const invited = room.join({ id: 'u2', username: 'guest', socketId: 's2', isBot: false });
  assert.equal(invited.ok, true);

  const fill = await room.fillWithBots();
  assert.equal(fill.ok, false);

  const start = await room.requestStart('u1');
  assert.equal(start.ok, false);
  assert.match(start.error, /stolni oching/);

  manager.destroy(room.code);
});
