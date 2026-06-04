// Tiny DOM helpers + reusable layout fragments.
import { state } from './state.js';
import { t } from './i18n.js';

export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    }
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
    else if (c instanceof Node) el.appendChild(c);
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

export function topbar(title, onBack) {
  return h('div', { class: 'lobby-topbar' }, [
    h('button', { class: 'btn-icon', onclick: onBack || (() => history.back()) }, ['◀']),
    h('div', { class: 'title' }, [title]),
    h('div', { class: 'coins' }, [`${(state.user?.coins || 0).toLocaleString()}`]),
  ]);
}

export function bottomTabs(activeKey) {
  const items = [
    { key: 'profile', icon: '♣', label: t('nav.profile') },
    { key: 'lobby',   icon: '❤', label: t('nav.tables') },
    { key: 'private', icon: '🔒', label: t('nav.private') },
    { key: 'create',  icon: '➕', label: t('nav.create') },
  ];
  const nav = h('div', { class: 'bottom-tabs' });
  for (const it of items) {
    const tab = h('div', {
      class: `tab ${activeKey === it.key ? 'active' : ''}`,
      onclick: () => {
        if (it.key === 'profile') location.hash = '#/profile';
        else if (it.key === 'lobby') location.hash = '#/lobby';
        else if (it.key === 'private') location.hash = '#/lobby?private=1';
        else if (it.key === 'create') location.hash = '#/lobby?create=1';
      },
    }, [
      h('span', { class: 'ic' }, [it.icon]),
      h('div', {}, [it.label]),
    ]);
    nav.appendChild(tab);
  }
  return nav;
}

export function coinPill(coins) {
  return h('span', { class: 'coins' }, [`${(coins || 0).toLocaleString()}`]);
}

export function showToast(message, kind = 'info') {
  const toast = h('div', {
    class: `toast toast-${kind}`,
    style: {
      position: 'fixed',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      zIndex: '9999',
      maxWidth: 'calc(100vw - 32px)',
      padding: '10px 14px',
      borderRadius: '12px',
      color: '#fff',
      background: kind === 'success' ? 'rgba(16, 185, 129, 0.92)'
        : kind === 'error' ? 'rgba(220, 38, 38, 0.92)'
        : kind === 'warn' ? 'rgba(245, 158, 11, 0.92)'
        : 'rgba(23, 23, 23, 0.92)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      fontSize: '14px',
      fontWeight: '600',
      textAlign: 'center',
    },
  }, [String(message || '')]);

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}
