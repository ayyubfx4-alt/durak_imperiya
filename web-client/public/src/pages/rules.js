// Rules page — quick reference for new players.
import { h } from '../ui.js';
import { navigate } from '../router.js';
import { t } from '../i18n.js';

const FALLBACK = {
  title: 'Qoidalar',
  got_it: 'Tushundim - boshlaymiz',
  deck_title: 'Talon',
  deck_desc: '36 karta ishlatiladi: 6,7,8,9,10,J,Q,K,A va 4 ta mast.',
  goal_title: 'Maqsad',
  goal_desc: "Qo'ldagi kartalardan birinchi bo'lib qutuling. Oxirida karta ushlab qolgan o'yinchi yutqazadi.",
  trump_title: "Ko'zir",
  trump_desc: "Kartalar tarqatilgandan keyin ochilgan karta masti ko'zir bo'ladi.",
  first_title: 'Birinchi hujum',
  first_desc: "Eng kichik ko'zirli o'yinchi birinchi yuradi.",
  attack_title: 'Hujum',
  attack_desc: "Hujumchi karta tashlaydi, himoyachi shu mastdagi kattaroq karta yoki ko'zir bilan uradi.",
  throw_in_title: "Qo'shish",
  throw_in_desc: "Stolda bor qiymatdagi kartalarni boshqa o'yinchilar ham qo'shishi mumkin.",
  take_beat_title: 'Olish yoki urish',
  take_beat_desc: "Himoyachi hammasini urolmasa kartalarni oladi. Ursa, kartalar tashlanadi.",
  draw_title: 'Karta olish',
  draw_desc: "Raund tugaganda o'yinchilar 6 tagacha karta oladi, talon tugaguncha.",
  win_title: "G'alaba",
  win_desc: "Talon tugagach qo'ldagi kartalarni bitiring. Oxirida karta qolgan o'yinchi durak bo'ladi.",
  bluff_title: 'Bluf',
  bluff_desc: "Bluf rejimi yoqilgan bo'lsa, yopiq karta bilan aldash mumkin. Raqib shubha qilsa karta ochiladi.",
  sheriff_title: 'Sherif nishoni',
  sheriff_desc: "Bluflarni fosh qilib, Sherif nishonini qo'lga kiriting.",
};

function tSafe(key, fallback) {
  const value = t(key);
  const text = String(value || '');
  if (!text || text === key || text.toLowerCase() === key.toLowerCase() || /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(text)) {
    return fallback;
  }
  return text;
}

export function renderRules(root) {
  const wrap = h('div', { class: 'screen bg-lobby' });
  wrap.appendChild(h('div', { class: 'lobby-topbar' }, [
    h('button', { class: 'btn-icon', onclick: () => history.back() }, ['◀']),
    h('div', { class: 'title' }, [tSafe('rules.title', FALLBACK.title)]),
    h('div', { style: { width: '40px' } }),
  ]));
  const scroll = h('div', { class: 'scroll p-16' });

  const rules = [
    ['rules.deck_title',      'rules.deck_desc',      FALLBACK.deck_title,      FALLBACK.deck_desc],
    ['rules.goal_title',      'rules.goal_desc',      FALLBACK.goal_title,      FALLBACK.goal_desc],
    ['rules.trump_title',     'rules.trump_desc',     FALLBACK.trump_title,     FALLBACK.trump_desc],
    ['rules.first_title',     'rules.first_desc',     FALLBACK.first_title,     FALLBACK.first_desc],
    ['rules.attack_title',    'rules.attack_desc',    FALLBACK.attack_title,    FALLBACK.attack_desc],
    ['rules.throw_in_title',  'rules.throw_in_desc',  FALLBACK.throw_in_title,  FALLBACK.throw_in_desc],
    ['rules.take_beat_title', 'rules.take_beat_desc', FALLBACK.take_beat_title, FALLBACK.take_beat_desc],
    ['rules.draw_title',      'rules.draw_desc',      FALLBACK.draw_title,      FALLBACK.draw_desc],
    ['rules.win_title',       'rules.win_desc',       FALLBACK.win_title,       FALLBACK.win_desc],
    ['rules.bluff_title',     'rules.bluff_desc',     FALLBACK.bluff_title,     FALLBACK.bluff_desc],
    ['rules.sheriff_title',   'rules.sheriff_desc',   FALLBACK.sheriff_title,   FALLBACK.sheriff_desc],
  ];

  for (const [titleKey, descKey, titleFallback, descFallback] of rules) {
    scroll.appendChild(h('div', { class: 'section-card' }, [
      h('h3', { style: { margin: '0 0 6px', color: '#fbbf24' } }, [tSafe(titleKey, titleFallback)]),
      h('div', { class: 'muted', style: { fontSize: '13px', lineHeight: '1.5' } }, [tSafe(descKey, descFallback)]),
    ]));
  }
  scroll.appendChild(h('button', { class: 'btn-big green mt-16', onclick: () => navigate('lobby') }, [tSafe('rules.got_it', FALLBACK.got_it)]));

  wrap.appendChild(scroll);
  root.appendChild(wrap);
}
