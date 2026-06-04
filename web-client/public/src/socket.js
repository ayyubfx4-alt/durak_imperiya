// Socket.IO client wrapper. Uses the global `io` from CDN.
import { API_BASE, getToken } from './api.js';

let _socket = null;

function deviceId() {
  let id = localStorage.getItem('durak.deviceId');
  if (!id) {
    id = ((typeof crypto !== 'undefined' && crypto.randomUUID?.()) || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem('durak.deviceId', id);
  }
  return id;
}

export function connectSocket() {
  if (_socket && _socket.connected) return _socket;
  if (typeof window === 'undefined' || typeof window.io !== 'function') {
    throw new Error('Socket.IO yuklanmadi. Internet/server ulanishini tekshiring va sahifani yangilang.');
  }
  const socketOptions = {
    transports: ['websocket'],
    auth: { token: getToken(), deviceId: deviceId() },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    forceNew: true,
    autoConnect: true,
  };
  // Always pass an explicit URL. Some Socket.IO builds treat `io(options)`
  // inconsistently in production, leaving the client closed without emitting
  // connect_error. Same-origin `/` keeps nginx reverse-proxy deployments stable.
  // eslint-disable-next-line no-undef
  const target = window.io(API_BASE || '/', socketOptions);
  _socket = target;
  return _socket;
}

export function getSocket() { return _socket; }

/**
 * Ensure a connected socket — used by main.js to wire global listeners
 * (achievement popups, gift toasts) before any page renders.
 */
export async function ensureSocket() {
  if (_socket && _socket.connected) return _socket;
  if (!getToken()) throw new Error('no auth token');
  const s = connectSocket();
  if (s.connected) return s;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
    s.once('connect', () => { clearTimeout(t); resolve(s); });
    s.once('connect_error', (err) => { clearTimeout(t); reject(err); });
  });
}

/**
 * Bug 9 fix: `export { socket }` → stale null binding muammosi.
 * Module import paytida socket=null bo'ladi va yangilanmaydi.
 * socketProxy getter orqali har safar hozirgi qiymat qaytariladi.
 *
 * main.js dan `import { socket }` import qilingan joy socketProxy
 * ga o'tkazilishi kerak, yoki getSocket() ishlatilishi kerak.
 */
export const socketProxy = new Proxy({}, {
  get(_target, prop) {
    if (!_socket) return undefined;
    const val = _socket[prop];
    return typeof val === 'function' ? val.bind(_socket) : val;
  },
  set(_target, prop, value) {
    if (_socket) _socket[prop] = value;
    return true;
  },
});

// Legacy export saqlanadi — lekin qiymat dinamik getter orqali qaytariladi.
// Yangi kod socketProxy yoki getSocket() ishlatsin.
/** @deprecated getSocket() yoki connectSocket() ishlating */
export { _socket as socket };

export function emitWithAck(event, payload, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (!_socket) return reject(new Error('not connected'));
    const t = setTimeout(() => reject(new Error('socket timeout')), timeout);
    _socket.emit(event, payload, (resp) => {
      clearTimeout(t);
      resolve(resp);
    });
  });
}
