// Achievement / event popup system — stacks toast-style cards in the
// bottom-right corner with a celebratory glow + sound. Used by the socket
// layer when `achievement:unlock` is received.
//
// Multiple unlocks shown simultaneously are spaced 800ms apart so the
// "ding" sounds don't pile up. The container auto-removes after 5s.
import { sfx } from '../sfx.js?v=111-encoding-fix';

let container = null;
const queue = [];
let draining = false;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'achievement-popups';
  container.className = 'popup-stack';
  document.body.appendChild(container);
  return container;
}

const CATEGORY_ICON = {
  streak:       '🔥',
  lossStreak:   '💀',
  coins:        '💰',
  friends:      '👥',
  games:        '🎮',
  draws:        '🤝',
  bluffsCaught: '🛡️',
  default:      '🏆',
};

function show({ name, category, target, key }) {
  const el = document.createElement('div');
  el.className = 'popup-card achievement';
  el.innerHTML = `
    <div class="popup-icon">${CATEGORY_ICON[category] || CATEGORY_ICON.default}</div>
    <div class="popup-body">
      <div class="popup-title">Achievement unlocked!</div>
      <div class="popup-name">${escapeHtml(name)}</div>
      ${target ? `<div class="popup-target">Target: ${target}</div>` : ''}
    </div>
    <button class="popup-close" aria-label="Close">×</button>
  `;
  ensureContainer().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  try { sfx.play?.('achievement') || sfx.play?.('win'); } catch (_) { /* ignore */ }

  const close = () => {
    el.classList.remove('show');
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  };
  el.querySelector('.popup-close')?.addEventListener('click', close);
  setTimeout(close, 5500);
  return el;
}

/** Public — enqueue one or many popups. Drains with 800ms spacing. */
export function showAchievement(payload) {
  const items = Array.isArray(payload) ? payload : [payload];
  for (const p of items) if (p) queue.push(p);
  drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const next = queue.shift();
    show(next);
    await new Promise((r) => setTimeout(r, 800));
  }
  draining = false;
}

/** Generic info toast — used by tournament events, gifts, etc. */
export function showEvent({ title, message, icon = '🔔', onClick }) {
  const el = document.createElement('div');
  el.className = 'popup-card event';
  el.innerHTML = `
    <div class="popup-icon">${icon}</div>
    <div class="popup-body">
      <div class="popup-title">${escapeHtml(title || '')}</div>
      <div class="popup-name">${escapeHtml(message || '')}</div>
    </div>
    <button class="popup-close" aria-label="Close">×</button>
  `;
  ensureContainer().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); el.classList.add('out'); setTimeout(() => el.remove(), 350); };
  el.querySelector('.popup-close')?.addEventListener('click', close);
  if (typeof onClick === 'function') {
    el.classList.add('clickable');
    el.style.cursor = 'pointer';
    el.addEventListener('click', (event) => {
      if (event.target?.closest?.('.popup-close')) return;
      close();
      onClick();
    });
  }
  setTimeout(close, 5000);
  return el;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
