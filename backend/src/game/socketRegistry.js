// Tiny module-scoped registry so non-socket modules (REST routes, admin
// endpoints, background workers) can obtain a reference to the live
// RoomManager and Socket.IO server without circular imports. setupSocket()
// calls `setRegistry({ io, manager })` once on startup.
let _io = null;
let _manager = null;

export function setRegistry({ io, manager }) {
  _io = io || _io;
  _manager = manager || _manager;
}

export function getRegistry() {
  return { io: _io, manager: _manager };
}

export function getIo() { return _io; }
export function getRoomManager() { return _manager; }
