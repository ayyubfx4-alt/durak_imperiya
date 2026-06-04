// Global app state + tiny event bus.
const listeners = new Map();

export const state = {
  user: null,
  catalog: null,
  inventory: [],
  currentRoom: null,
  game: null,
  toast: null,
};

export function emit(event, payload) {
  const arr = listeners.get(event) || [];
  for (const fn of arr) {
    try { fn(payload); } catch (e) { console.error(e); }
  }
}

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  const arr = listeners.get(event);
  if (!arr) return;
  const idx = arr.indexOf(fn);
  if (idx >= 0) arr.splice(idx, 1);
}

// Toast: rendered into a stacking container so multiple notifications coexist.
// Pass `type` ("error" | "success" | "info") to style the toast.
export function toast(message, type = 'info', duration = 2500) {
  if (typeof type === 'number') { duration = type; type = 'info'; }
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => el.remove(), 260);
  }, duration);
}
