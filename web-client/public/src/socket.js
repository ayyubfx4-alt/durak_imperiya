// Socket.IO client wrapper. Uses the global `io` from CDN.
import { API_BASE, getToken } from './api.js';

let _socket = null;

function isNativeShell() {
  return !!(typeof window !== 'undefined'
    && (window.__DURAK_NATIVE_SHELL__
      || window.Capacitor?.isNativePlatform?.() === true));
}

function deviceId() {
  let id = localStorage.getItem('durak.deviceId');
  if (!id) {
    id = ((typeof crypto !== 'undefined' && crypto.randomUUID?.()) || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem('durak.deviceId', id);
  }
  return id;
}

export function connectSocket() {
  if (_socket) {
    _socket.auth = { token: getToken(), deviceId: deviceId() };
    if (!_socket.connected) _socket.connect?.();
    return _socket;
  }
  if (typeof window === 'undefined' || typeof window.io !== 'function') {
    throw new Error('Socket.IO yuklanmadi. Internet/server ulanishini tekshiring va sahifani yangilang.');
  }
  const native = isNativeShell();
  const socketOptions = {
    transports: native ? ['polling', 'websocket'] : ['websocket', 'polling'],
    upgrade: true,
    auth: { token: getToken(), deviceId: deviceId() },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: native ? 500 : 1000,
    reconnectionDelayMax: native ? 3000 : 5000,
    timeout: native ? 15000 : 10000,
    forceNew: false,
    autoConnect: true,
  };
  // eslint-disable-next-line no-undef
  const target = API_BASE ? window.io(API_BASE, socketOptions) : window.io(socketOptions);
  _socket = target;
  return _socket;
}

export function getSocket() { return _socket; }

function waitForSocketConnected(timeoutMs = 10000) {
  const s = connectSocket();
  if (s.connected) return Promise.resolve(s);
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      s.off?.('connect', onConnect);
      s.off?.('connect_error', onError);
    };
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      fn(value);
    };
    const onConnect = () => finish(resolve, s);
    const onError = (err) => finish(reject, err || new Error('socket connect error'));
    const timer = setTimeout(() => finish(reject, new Error('socket connect timeout')), timeoutMs);
    s.once?.('connect', onConnect);
    s.once?.('connect_error', onError);
    s.connect?.();
  });
}

/**
 * Ensure a connected socket — used by main.js to wire global listeners
 * (achievement popups, gift toasts) before any page renders.
 */
export async function ensureSocket() {
  if (_socket && _socket.connected) return _socket;
  if (!getToken()) throw new Error('no auth token');
  return waitForSocketConnected(isNativeShell() ? 15000 : 10000);
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

export async function emitWithAck(event, payload, timeout = 5000) {
  const s = await waitForSocketConnected(Math.max(timeout, isNativeShell() ? 12000 : 7000));
  return new Promise((resolve, reject) => {
    if (!s?.connected) return reject(new Error('not connected'));
    const t = setTimeout(() => reject(new Error('socket timeout')), timeout);
    s.emit(event, payload, (resp) => {
      clearTimeout(t);
      resolve(resp);
    });
  });
}
