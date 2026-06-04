import { h, topbar } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { getLocale, t } from '../i18n.js';
import { toast } from '../state.js';
import { attachGoldScrollIndicator } from '../scrollIndicator.js';

const CATEGORY_META = {
  all: ['★', { uz: 'Hammasi', ru: 'Все', en: 'All' }],
  streak: ['🔥', { uz: 'Seriya', ru: 'Серия', en: 'Streak' }],
  wins: ['🏆', { uz: "G'alaba", ru: 'Победы', en: 'Wins' }],
  games: ['🎮', { uz: "O'yinlar", ru: 'Игры', en: 'Games' }],
  coins: ['🪙', { uz: 'Boylik', ru: 'Монеты', en: 'Wealth' }],
  friends: ['🤝', { uz: "Do'stlar", ru: 'Друзья', en: 'Friends' }],
  draws: ['⚖', { uz: 'Durang', ru: 'Ничьи', en: 'Draws' }],
  lossStreak: ['🎭', { uz: 'Sabot', ru: 'Стойкость', en: 'Resilience' }],
  bluffsCaught: ['🛡', { uz: 'Sherif', ru: 'Шериф', en: 'Sheriff' }],
};

const COPY = {
  uz: {
    title: 'YUTUQLAR',
    loading: 'Yutuqlar yuklanmoqda...',
    kicker: 'IMPERIA YUTUQLARI',
    opened: 'ochilgan',
    intro: "Har bir yutuq backenddagi haqiqiy o'yin statistikasi bilan hisoblanadi. O'ynang, oching, profilingizda ko'rsating.",
    wins: "G'alaba",
    games: "O'yin",
    streak: 'Seriya',
    dollars: 'Dollar',
    unlocked: 'Ochilgan',
    progressing: 'Jarayonda',
    locked: 'Qulflangan',
    errorTitle: 'Yutuqlar ochilmadi',
    retry: 'Qayta urinish',
    retrying: 'Qayta yuklanmoqda...',
  },
  ru: {
    title: 'ДОСТИЖЕНИЯ',
    loading: 'Достижения загружаются...',
    kicker: 'ДОСТИЖЕНИЯ IMPERIA',
    opened: 'открыто',
    intro: 'Каждое достижение считается по реальной статистике игры на сервере. Играйте, открывайте и показывайте в профиле.',
    wins: 'Победы',
    games: 'Игры',
    streak: 'Серия',
    dollars: 'Доллары',
    unlocked: 'Открыто',
    progressing: 'В процессе',
    locked: 'Закрыто',
    errorTitle: 'Достижения не открылись',
    retry: 'Повторить',
    retrying: 'Загружается заново...',
  },
  en: {
    title: 'ACHIEVEMENTS',
    loading: 'Loading achievements...',
    kicker: 'IMPERIA ACHIEVEMENTS',
    opened: 'unlocked',
    intro: 'Every achievement is calculated from real server-side game statistics. Play, unlock, and show them on your profile.',
    wins: 'Wins',
    games: 'Games',
    streak: 'Streak',
    dollars: 'Dollars',
    unlocked: 'Unlocked',
    progressing: 'In progress',
    locked: 'Locked',
    errorTitle: 'Achievements did not load',
    retry: 'Try again',
    retrying: 'Reloading...',
  },
};

export async function renderAchievements(root) {
  const copy = COPY[getLocale()] || COPY.uz;
  const wrap = h('div', { class: 'screen bg-lobby achievements-screen' });
  wrap.appendChild(topbar(t('achievements.title') === 'achievements.title' ? copy.title : t('achievements.title'), () => navigate('home')));

  const scroll = h('div', { class: 'scroll achievements-scroll' }, [
    h('section', { class: 'ach-loading' }, [
      h('div', { class: 'ach-loading-medal' }, ['★']),
      h('strong', {}, [copy.loading]),
    ]),
  ]);
  wrap.appendChild(scroll);
  root.appendChild(wrap);
  const detachScroll = attachGoldScrollIndicator(scroll, {
    className: 'achievements-gold-scroll-track',
    top: 78,
    bottom: 14,
  });

  let data = null;
  try {
    data = await api.myAchievements();
  } catch (e) {
    scroll.innerHTML = '';
    scroll.appendChild(errorState(e, copy));
    return detachScroll;
  }

  const items = Array.isArray(data) ? legacyItems(data) : Array.isArray(data?.items) ? data.items : [];
  const total = Number(data?.total || items.length || 0);
  const unlocked = Number(data?.unlocked || items.filter((a) => a.unlocked).length || 0);
  const percent = total ? Math.round((unlocked / total) * 100) : 0;
  const stats = data?.stats || {};
  let active = 'all';

  function paint() {
    scroll.innerHTML = '';
    scroll.appendChild(summaryCard({ total, unlocked, percent, stats, copy }));
    scroll.appendChild(categoryTabs(items, active, (key) => {
      active = key;
      paint();
    }));
    const filtered = active === 'all' ? items : items.filter((a) => a.category === active);
    scroll.appendChild(h('section', { class: 'ach-grid-pro' }, filtered.map((item) => achievementCard(item, copy))));
  }

  paint();
  return detachScroll;
}

function legacyItems(rows) {
  const unlocked = new Set(rows.map((a) => a.achievement_key));
  return rows.map((a) => ({
    key: a.achievement_key,
    name: a.achievement_key,
    category: 'all',
    target: 1,
    current: unlocked.has(a.achievement_key) ? 1 : 0,
    progress: unlocked.has(a.achievement_key) ? 100 : 0,
    unlocked: unlocked.has(a.achievement_key),
    unlocked_at: a.unlocked_at,
  }));
}

function summaryCard({ total, unlocked, percent, stats, copy }) {
  return h('section', { class: 'ach-hero' }, [
    h('div', { class: 'ach-hero-copy' }, [
      h('span', { class: 'ach-kicker' }, [copy.kicker]),
      h('h1', {}, [`${unlocked} / ${total} ${copy.opened}`]),
      h('p', {}, [copy.intro]),
      h('div', { class: 'ach-hero-progress' }, [
        h('i', { style: `width:${percent}%` }),
        h('b', {}, [`${percent}%`]),
      ]),
    ]),
    h('div', { class: 'ach-hero-medal' }, ['♛']),
    h('div', { class: 'ach-stat-row' }, [
      statPill('🏆', copy.wins, stats.wins),
      statPill('🎮', copy.games, stats.games),
      statPill('🔥', copy.streak, stats.streak),
      statPill('🪙', copy.dollars, stats.coins),
    ]),
  ]);
}

function statPill(icon, label, value) {
  return h('div', { class: 'ach-stat-pill' }, [
    h('span', {}, [icon]),
    h('strong', {}, [Number(value || 0).toLocaleString()]),
    h('small', {}, [label]),
  ]);
}

function categoryTabs(items, active, onPick) {
  const keys = ['all', ...Array.from(new Set(items.map((a) => a.category).filter(Boolean)))];
  return h('nav', { class: 'ach-tabs' }, keys.map((key) => {
    const [icon, labels] = CATEGORY_META[key] || ['◆', key];
    const label = typeof labels === 'string' ? labels : (labels[getLocale()] || labels.uz || key);
    return h('button', { class: key === active ? 'active' : '', onclick: () => onPick(key) }, [
      h('span', {}, [icon]),
      h('b', {}, [label]),
    ]);
  }));
}

function achievementCard(a, copy) {
  const [icon, categoryLabels] = CATEGORY_META[a.category] || ['◆', a.category || 'Yutuq'];
  const categoryLabel = typeof categoryLabels === 'string' ? categoryLabels : (categoryLabels[getLocale()] || categoryLabels.uz || a.category || 'Yutuq');
  const current = Number(a.current || 0);
  const target = Number(a.target || 0);
  const progress = Math.max(0, Math.min(100, Number(a.progress || 0)));
  const stateClass = a.unlocked ? 'unlocked' : progress > 0 ? 'progressing' : 'locked';
  const status = a.unlocked ? copy.unlocked : progress > 0 ? copy.progressing : copy.locked;
  return h('article', { class: `ach-card-pro ${stateClass}` }, [
    h('div', { class: 'ach-card-glow' }),
    h('div', { class: 'ach-badge' }, [icon]),
    h('div', { class: 'ach-card-copy' }, [
      h('small', {}, [categoryLabel]),
      h('strong', {}, [a.name || a.key]),
      h('span', {}, [target ? `${current.toLocaleString()} / ${target.toLocaleString()}` : status]),
      h('div', { class: 'ach-progress' }, [h('i', { style: `width:${a.unlocked ? 100 : progress}%` })]),
    ]),
    h('div', { class: 'ach-card-state' }, [
      h('b', {}, [a.unlocked ? '✓' : progress > 0 ? `${progress}%` : '🔒']),
      h('span', {}, [status]),
    ]),
  ]);
}

function errorState(error, copy) {
  return h('section', { class: 'ach-error' }, [
    h('div', { class: 'ach-loading-medal' }, ['!']),
    h('h2', {}, [copy.errorTitle]),
    h('p', {}, [error?.message || 'Backend bilan aloqa uzildi.']),
    h('button', { class: 'dash-gold-btn small', onclick: () => {
      toast(copy.retrying, 'info');
      const app = document.getElementById('app');
      app.innerHTML = '';
      renderAchievements(app);
    } }, [copy.retry]),
  ]);
}
