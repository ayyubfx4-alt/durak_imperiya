// Rules page — quick reference for new players.
import { h } from '../ui.js';
import { navigate } from '../router.js';
import { t } from '../i18n.js';

export function renderRules(root) {
  const wrap = h('div', { class: 'screen bg-lobby' });
  wrap.appendChild(h('div', { class: 'lobby-topbar' }, [
    h('button', { class: 'btn-icon', onclick: () => history.back() }, ['◀']),
    h('div', { class: 'title' }, [t('rules.title')]),
    h('div', { style: { width: '40px' } }),
  ]));
  const scroll = h('div', { class: 'scroll p-16' });

  const rules = [
    ['rules.deck',       'rules.deck_desc'],
    ['rules.goal',       'rules.goal_desc'],
    ['rules.trump',      'rules.trump_desc'],
    ['rules.first',      'rules.first_desc'],
    ['rules.attack',     'rules.attack_desc'],
    ['rules.throw_in',   'rules.throw_in_desc'],
    ['rules.take_beat',  'rules.take_beat_desc'],
    ['rules.draw',       'rules.draw_desc'],
    ['rules.win',        'rules.win_desc'],
    ['rules.bluff',      'rules.bluff_desc'],
    ['rules.sheriff',    'rules.sheriff_desc'],
  ];

  for (const [titleKey, descKey] of rules) {
    scroll.appendChild(h('div', { class: 'section-card' }, [
      h('h3', { style: { margin: '0 0 6px', color: '#fbbf24' } }, [t(titleKey)]),
      h('div', { class: 'muted', style: { fontSize: '13px', lineHeight: '1.5' } }, [t(descKey)]),
    ]));
  }
  scroll.appendChild(h('button', { class: 'btn-big green mt-16', onclick: () => navigate('lobby') }, [t('rules.got_it')]));

  wrap.appendChild(scroll);
  root.appendChild(wrap);
}
