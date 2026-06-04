/**
 * pages/nickname.js
 * Shown once to new users after Google Sign-In.
 * Lets the user pick a unique @nickname before entering the game.
 */

import { h } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { state, toast } from '../state.js';
import { t } from '../i18n.js';

const NICK_RE = /^[A-Za-z0-9_]{3,24}$/;
const NICK_COPY = {
  title: 'Nickname tanlang',
  subtitle: "Profil ichida keyin xohlagan payt o'zgartirasiz.",
  placeholder: 'nickname',
  check: 'Tekshirish',
  save: 'Davom etish',
  error_format: '3-24 belgi: harf, raqam yoki _',
  available: 'Mavjud',
  taken: 'Band',
  saved: 'Saqlandi',
};

function nt(key) {
  const fullKey = `nickname.${key}`;
  const translated = t(fullKey);
  return translated === fullKey ? NICK_COPY[key] || key : translated;
}

function nicknameSuggestion() {
  const source = state.user?.nickname
    || state.user?.username
    || (state.user?.email ? String(state.user.email).split('@')[0] : '')
    || '';
  const value = String(source)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 24);
  return NICK_RE.test(value) ? value : '';
}

export function renderNickname(root) {
  root.innerHTML = '';

  const inputEl   = h('input', { class: 'nickname-input', placeholder: nt('placeholder'), maxlength: '24', autocapitalize: 'none', autocorrect: 'off', value: nicknameSuggestion() });
  const statusEl  = h('div',   { class: 'nickname-status' });
  const saveBtn   = h('button', { class: 'btn-big nickname-save', disabled: true, style: 'opacity:.5' }, [nt('save')]);
  const checkBtn  = h('button', { class: 'btn-pill nickname-check' }, [nt('check')]);

  let lastChecked = '';
  let isAvailable = false;

  function validate() {
    const v = inputEl.value.trim();
    if (v !== lastChecked) {
      statusEl.textContent = '';
      statusEl.style.color = '';
      isAvailable = false;
      saveBtn.disabled = true;
      saveBtn.style.opacity = '.5';
    }
  }

  async function doCheck() {
    const nick = inputEl.value.trim();
    if (!NICK_RE.test(nick)) {
      statusEl.style.color = '#fca5a5';
      statusEl.textContent = nt('error_format');
      return;
    }
    checkBtn.disabled = true;
    statusEl.style.color = 'rgba(255,255,255,.5)';
    statusEl.textContent = '...';
    try {
      const res = await api.checkNickname(nick);
      lastChecked = nick;
      isAvailable = res.available;
      statusEl.style.color = isAvailable ? '#86efac' : '#fca5a5';
      statusEl.textContent = isAvailable ? nt('available') : nt('taken');
      saveBtn.disabled = !isAvailable;
      saveBtn.style.opacity = isAvailable ? '1' : '.5';
    } catch (e) {
      statusEl.style.color = '#fca5a5';
      statusEl.textContent = e.message;
    } finally {
      checkBtn.disabled = false;
    }
  }

  inputEl.addEventListener('input', validate);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') doCheck(); });
  checkBtn.addEventListener('click', doCheck);

  saveBtn.addEventListener('click', async () => {
    if (!isAvailable) return;
    saveBtn.disabled = true;
    saveBtn.textContent = '...';
    try {
      const nick = inputEl.value.trim();
      await api.setNickname(nick);
      state.user = { ...state.user, nickname: nick, nickname_set: true };
      toast(nt('saved') + ' @' + nick);
      navigate('home');
    } catch (e) {
      statusEl.style.color = '#fca5a5';
      statusEl.textContent = e.message || t('errors.nickname_taken');
      saveBtn.disabled = false;
      saveBtn.textContent = nt('save');
    }
  });

  const card = h('div', { class: 'login-card nickname-card' }, [
    h('div', { class: 'nickname-avatar' }, ['😎']),
    h('h2', {}, [nt('title')]),
    h('p', { class: 'muted' }, [nt('subtitle')]),
    h('div', { class: 'nickname-field' }, [
      h('span', {}, ['@']),
      inputEl,
    ]),
    statusEl,
    h('div', { class: 'nickname-actions' }, [checkBtn, saveBtn]),
  ]);

  root.appendChild(h('div', {
    class: 'screen nickname-screen',
  }, [card]));

  validate();
  setTimeout(() => inputEl.focus(), 100);
}
