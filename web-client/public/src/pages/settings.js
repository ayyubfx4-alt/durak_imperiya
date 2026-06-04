import { h } from '../ui.js';
import { api, clearToken } from '../api.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { avatarColorFor, avatarLetter } from '../cards.js';
import { sfx } from '../sfx.js?v=111-encoding-fix';
import { PREF_DEFAULTS, localMusicPreference, localPreferenceValue, markMusicUserSet, musicWasUserSet, setPrefValue } from '../preferences.js?v=111-encoding-fix';
import { applyRuntimeSettings, normalizeRuntimeSettings } from '../runtimeSettings.js?v=111-encoding-fix';
import { setLocale } from '../i18n.js';

const DEFAULT_SETTINGS = {
  ...PREF_DEFAULTS,
  pref_dark_mode: true,
  pref_vibration: true,
  pref_language: 'uz',
  pref_hud_size: 'middle',
  pref_graphics_quality: 'high',
  pref_fps_limit: 60,
  pref_shadows: true,
  pref_antialiasing: true,
  pref_effects_quality: 'high',
  pref_lighting_quality: 'high',
  pref_sound: true,
  pref_music: false,
  pref_master_volume: 80,
  pref_music_volume: 50,
  pref_effects_volume: 90,
  pref_voice_volume: 70,
  pref_card_place_mode: 'tap',
  pref_joystick_lock: true,
  pref_rotate_table: true,
  pref_quick_chat: true,
  pref_auto_deal: false,
};

const NAV_ITEMS = [
  ['general', 'UMUMIY', 'Asosiy sozlamalar', '#'],
  ['graphics', 'GRAFIKA', 'Grafika va FPS', 'G'],
  ['audio', 'OVOZ', 'Ovoz va musiqa', 'A'],
  ['controls', 'BOSHQARUV', 'Karta boshqaruvi', 'B'],
  ['notifications', 'XABARLAR', 'Chat va effektlar', 'N'],
  ['privacy', 'MAXFIYLIK', 'Xavfsizlik', 'S'],
  ['language', 'TIL', 'Til tanlash', 'UZ'],
  ['help', 'YORDAM', "Qo'llab-quvvatlash", '?'],
  ['other', 'BOSHQA', "Import, eksport", '+'],
];

let activeSection = 'general';
const fmt = (value) => Number(value || 0).toLocaleString('uz-UZ');

export async function renderSettings(root) {
  root.innerHTML = '';

  try { state.user = await api.me(); } catch (_) {}
  const user = state.user || {};
  const remote = await api.getSettings().catch(() => ({ settings: {} }));
  const draft = normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...(remote.settings || {}),
    pref_language: remote.settings?.pref_language || user.locale || DEFAULT_SETTINGS.pref_language,
  });
  persistLocalPrefs(draft);

  const screen = h('div', { class: 'screen royal-settings-v83' });
  const fileInput = h('input', {
    class: 'rs83-file-input',
    type: 'file',
    accept: 'application/json',
    onchange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        Object.assign(draft, normalizeSettings({ ...draft, ...(imported.settings || imported) }, { localOverrides: false }));
        await saveSettings(draft, 'Yuklangan sozlamalar saqlandi');
        renderSettings(root);
      } catch (_) {
        toast("Fayl o'qilmadi", 'error');
      } finally {
        event.target.value = '';
      }
    },
  });

  const rerender = (section) => {
    activeSection = section || activeSection;
    renderSettings(root);
  };

  screen.appendChild(fileInput);
  screen.appendChild(renderHeader(user, draft, () => resetSettings(root, draft)));
  screen.appendChild(h('main', { class: 'rs83-grid' }, [
    renderLeftSidebar(activeSection, rerender),
    renderSection(activeSection, user, draft, root, fileInput),
    h('aside', { class: 'rs83-stack rs83-right' }, [
      accountPanel(user, draft, fileInput),
      systemPanel(),
    ]),
  ]));
  screen.appendChild(bottomBar());

  root.appendChild(screen);
  applySliderPaint(screen);
  localizeSettingsScreen(screen, draft.pref_language);
}

function renderHeader(user, draft, onReset) {
  return h('header', { class: 'rs83-header' }, [
    h('button', { class: 'rs83-back', title: 'Ortga', onclick: () => navigate('home') }, ['<']),
    h('div', { class: 'rs83-title' }, [
      h('h1', {}, ['SOZLAMALAR']),
      h('p', {}, ["O'YIN SOZLAMALARINI MOSLANG"]),
    ]),
    h('div', { class: 'rs83-wallets' }, [
      wallet('$', fmt(user.coins || 0), 'DURAK DOLLAR'),
      wallet('GC', fmt(user.gold_coins || 0), 'GOLD COIN'),
    ]),
    h('div', { class: 'rs83-actions' }, [
      h('button', { onclick: onReset }, [h('b', {}, ['R']), h('span', {}, ["QAYTA O'RNATISH"])]),
      h('button', { onclick: () => saveSettings(draft).catch((err) => toast(err.message || 'Saqlanmadi', 'error')) }, [
        h('b', {}, ['S']),
        h('span', {}, ['SAQLASH']),
      ]),
    ]),
  ]);
}

function wallet(icon, amount, label) {
  return h('div', { class: 'rs83-wallet' }, [
    h('i', {}, [icon]),
    h('div', {}, [h('b', {}, [amount]), h('small', {}, [label])]),
    h('button', { title: "To'ldirish", onclick: () => navigate('shop') }, ['+']),
  ]);
}

function renderLeftSidebar(active, onSelect) {
  return h('aside', { class: 'rs83-left' }, [
    h('nav', { class: 'rs83-menu' }, NAV_ITEMS.map((item) =>
      h('button', {
        class: active === item[0] ? 'active' : '',
        'aria-pressed': String(active === item[0]),
        onclick: () => {
          sfx.play('click');
          onSelect(item[0]);
        },
      }, [
        h('span', {}, [item[3]]),
        h('div', {}, [h('b', {}, [item[1]]), h('small', {}, [item[2]])]),
      ])
    )),
    h('div', { class: 'rs83-rate' }, [
      h('b', {}, ["O'YINNI BAHOLASH"]),
      h('div', {}, ['5 STARS']),
      h('small', {}, ["Bizni qo'llab-quvvatlang"]),
    ]),
  ]);
}

function renderSection(section, user, draft, root, fileInput) {
  const builders = {
    general: () => [
      panel('UMUMIY SOZLAMALAR', [
        settingRow('D', 'DARK MODE', "Qorong'i mavzu", toggleControl('pref_dark_mode', draft)),
        settingRow('V', 'VIBRATSIYA', "Vibratsiya yoqish/o'chirish", toggleControl('pref_vibration', draft)),
        settingRow('L', 'TIL', "O'yin tili", languageSelect(draft)),
        settingRow('H', "HUD KO'RINISHI", 'Interfeys kattaligi', segmentControl('pref_hud_size', draft, [
          ['compact', 'KOMPAKT'],
          ['middle', "O'RTA"],
          ['wide', 'KENG'],
        ])),
      ]),
    ],
    graphics: () => [
      panel('GRAFIKA SOZLAMALARI', [
        settingRow('Q', 'GRAFIKA SIFATI', 'Render sifati', segmentControl('pref_graphics_quality', draft, [
          ['low', 'LOW'],
          ['medium', 'MEDIUM'],
          ['high', 'HIGH'],
          ['ultra', 'ULTRA'],
        ])),
        settingRow('F', 'FPS LIMIT', 'Kadrlar chegarasi', segmentControl('pref_fps_limit', draft, [
          [30, '30 FPS'],
          [60, '60 FPS'],
          [90, '90 FPS'],
          [120, '120 FPS'],
        ])),
        settingRow('S', 'SOYALAR', "Soya yoqish/o'chirish", toggleControl('pref_shadows', draft)),
        settingRow('A', 'ANTI-ALIASING', 'Karta qirralarini silliqlash', toggleControl('pref_antialiasing', draft)),
        settingRow('E', 'EFFECTLAR SIFATI', 'Animatsiya sifati', segmentControl('pref_effects_quality', draft, [
          ['low', 'LOW'],
          ['medium', 'MEDIUM'],
          ['high', 'HIGH'],
        ])),
        settingRow('L', 'YORITISH SIFATI', 'Glow va yoruglik sifati', segmentControl('pref_lighting_quality', draft, [
          ['low', 'LOW'],
          ['medium', 'MEDIUM'],
          ['high', 'HIGH'],
        ])),
      ]),
    ],
    audio: () => [
      panel('OVOZ SOZLAMALARI', [
        settingRow('O', 'OVOZ', "O'yin ovozlarini yoqish", toggleControl('pref_sound', draft)),
        settingRow('M', 'MUSIQA', 'Fon musiqasini yoqish', toggleControl('pref_music', draft)),
        settingRow('T', 'ASOSIY OVOZ', "O'yin umumiy ovozi", sliderControl('pref_master_volume', draft)),
        settingRow('B', 'MUSIQA OVOZI', 'Fon musiqasi ovozi', sliderControl('pref_music_volume', draft)),
        settingRow('E', 'EFEKT OVOZLARI', "O'yin effektlari ovozi", sliderControl('pref_effects_volume', draft)),
        settingRow('V', 'VOICE CHAT', 'Voice chat ovozi', sliderControl('pref_voice_volume', draft)),
      ]),
    ],
    controls: () => [
      panel('BOSHQARUV SOZLAMALARI', [
        settingRow('C', 'KARTA JOYLASH', "Kartalarni stolga qo'yish usuli", segmentControl('pref_card_place_mode', draft, [
          ['tap', 'TEGISH'],
          ['drag', 'SUDRASH'],
        ])),
        settingRow('J', 'JOYSTICK LOCK', 'Boshqaruvni qulflash', toggleControl('pref_joystick_lock', draft)),
        settingRow('R', "O'NG QO'L REJIMI", "Asosiy tugmalar o'ng tomonda", toggleControl('pref_right_action', draft)),
        settingRow('2', 'DOUBLE TAP', 'Ikki marta bosib yurish', toggleControl('pref_double_tap', draft)),
        settingRow('T', 'NAVBAT SORT', 'Navbatga mos kartalarni oldinga chiqarish', toggleControl('pref_turn_sorting', draft)),
        settingRow('V', 'QIYMAT SORT', "Kartalarni qiymat bo'yicha tartiblash", toggleControl('pref_sort_value', draft)),
        settingRow('A', 'AVTO TARQATISH', 'Tarqatish animatsiyasini avtomatik boshqarish', toggleControl('pref_auto_deal', draft)),
      ]),
    ],
    notifications: () => [
      panel('XABAR VA CHAT', [
        settingRow('Q', 'TEZKOR CHAT', "Tezkor chat tugmalarini ko'rsatish", toggleControl('pref_quick_chat', draft)),
        settingRow('E', 'EMOJI VA STIKER', "O'yin ichidagi emotsiyalar", toggleControl('pref_emotions', draft)),
        settingRow('W', 'MUKOFOT ANIMATSIYASI', "G'alaba va mukofot effektlari", toggleControl('pref_reward_anim', draft)),
        settingRow('M', 'MUSIQA XABARI', 'Musiqa alohida boshqariladi', toggleControl('pref_music', draft)),
      ]),
    ],
    privacy: () => [
      panel('MAXFIYLIK VA XAVFSIZLIK', [
        settingRow('H', 'HALOL REJIM', 'Bezovta qiluvchi kontentni cheklash', toggleControl('pref_halal_mode', draft)),
        settingRow('S', "KARTA KO'YLAGI", 'Tanlangan skinni ishlatish', toggleControl('pref_card_shirt', draft)),
        actionRow('P', 'PROFIL', "Profil ma'lumotlarini boshqarish", () => navigate('profile')),
        actionRow('L', 'CHIQISH', 'Akkauntdan chiqish', logout, 'danger'),
      ]),
    ],
    language: () => [
      panel('TIL SOZLAMALARI', [
        settingRow('UZ', 'INTERFEYS TILI', 'Matnlar tili', languageSelect(draft)),
        actionRow('R', 'SAHIFANI YANGILASH', "Tanlangan tilni ko'rish", () => renderSettings(root)),
      ]),
    ],
    help: () => [
      panel('YORDAM', [
        actionRow('?', 'SUPPORTGA YOZISH', "Muammo bo'lsa admin panelga ticket yuborish", openSupportTicket),
        actionRow('Q', 'QOIDALAR', "O'yin qoidalarini ochish", () => navigate('rules')),
        actionRow('P', 'PROFIL', "Akkaunt sahifasini ochish", () => navigate('profile')),
        actionRow('S', "DO'KON", "Paket va skinlarni ko'rish", () => navigate('shop')),
        actionRow('K', 'KESHNI TOZALASH', 'Brauzer keshini tozalash', clearClientCache),
      ]),
    ],
    other: () => [
      panel('BOSHQA', [
        actionRow('I', 'IMPORT', 'JSON sozlamalarni yuklash', () => fileInput.click()),
        actionRow('E', 'EKSPORT', 'JSON sozlamalarni saqlash', () => downloadSettings(user, draft)),
        actionRow('R', "QAYTA O'RNATISH", 'Standart sozlamalarga qaytish', () => resetSettings(root, draft)),
        actionRow('H', 'BOSH MENU', 'Asosiy menyuga qaytish', () => navigate('home')),
      ]),
    ],
  };

  const selected = builders[section] ? section : 'general';
  return h('section', { class: 'rs83-stack rs83-main' }, [
    ...builders[selected](),
    sectionActions(draft),
  ]);
}

function sectionActions(draft) {
  return h('div', { class: 'rs83-section-actions' }, [
    h('button', {
      class: 'rs83-save',
      onclick: async () => {
        try { await saveSettings(draft); }
        catch (err) { toast(err.message || 'Sozlamalar saqlanmadi', 'error'); }
      },
    }, ["O'ZGARISHLARNI SAQLASH"]),
  ]);
}

function panel(title, children) {
  return h('section', { class: 'rs83-panel' }, [
    h('h2', {}, [title]),
    h('div', { class: 'rs83-panel-body' }, children),
  ]);
}

function settingRow(icon, title, subtitle, control) {
  return h('div', { class: 'rs83-row' }, [
    h('span', { class: 'rs83-row-icon' }, [icon]),
    h('div', { class: 'rs83-row-copy' }, [
      h('b', {}, [title]),
      h('small', {}, [subtitle]),
    ]),
    h('div', { class: 'rs83-row-control' }, [control]),
  ]);
}

function openSupportTicket() {
  window.dispatchEvent(new CustomEvent('durak:support:new-ticket'));
}

function actionRow(icon, title, subtitle, onclick, kind = '') {
  return settingRow(icon, title, subtitle, h('button', {
    class: `rs83-action ${kind}`,
    onclick: () => {
      sfx.play('click');
      onclick();
    },
  }, ['OPEN']));
}

function toggleControl(key, draft) {
  const btn = h('button', {
    type: 'button',
    class: `rs83-toggle ${draft[key] ? 'on' : 'off'}`,
    'aria-pressed': String(!!draft[key]),
    onclick: () => {
      draft[key] = !draft[key];
      if (key === 'pref_music') markMusicUserSet();
      syncToggle(btn, draft[key]);
      persistLocalPrefs(draft);
    },
  }, [h('span', {}, [draft[key] ? 'ON' : 'OFF']), h('i', {}, [])]);
  return btn;
}

function syncToggle(btn, value) {
  btn.classList.toggle('on', !!value);
  btn.classList.toggle('off', !value);
  btn.setAttribute('aria-pressed', String(!!value));
  btn.querySelector('span').textContent = value ? 'ON' : 'OFF';
}

function segmentControl(key, draft, options) {
  const wrap = h('div', { class: 'rs83-segment', 'data-key': key }, options.map(([value, label]) =>
    h('button', {
      type: 'button',
      class: String(draft[key]) === String(value) ? 'active' : '',
      onclick: (event) => {
        draft[key] = typeof value === 'number' ? value : value;
        wrap.querySelectorAll('button').forEach((btn) => btn.classList.toggle('active', btn === event.currentTarget));
        persistLocalPrefs(draft);
      },
    }, [label])
  ));
  return wrap;
}

function sliderControl(key, draft) {
  const value = clampVolume(draft[key]);
  draft[key] = value;
  const out = h('b', { class: 'rs83-slider-value' }, [`${value}%`]);
  const input = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: String(value),
    oninput: () => {
      draft[key] = clampVolume(input.value);
      out.textContent = `${draft[key]}%`;
      input.style.setProperty('--fill', `${draft[key]}%`);
      persistLocalPrefs(draft);
    },
  });
  input.style.setProperty('--fill', `${value}%`);
  return h('label', { class: 'rs83-slider' }, [out, input]);
}

function languageSelect(draft) {
  return h('select', {
    class: 'rs83-select',
    value: draft.pref_language,
    onchange: (event) => {
      draft.pref_language = event.currentTarget.value;
      persistLocalPrefs(draft);
      setLocale(draft.pref_language).catch(() => {});
      const screen = document.querySelector('.royal-settings-v83');
      if (screen) localizeSettingsScreen(screen, draft.pref_language);
    },
  }, [
    option('uz', "O'ZBEKCHA", draft.pref_language),
    option('ru', 'РУССКИЙ', draft.pref_language),
    option('en', 'ENGLISH', draft.pref_language),
  ]);
}

function option(value, label, active) {
  return h('option', { value, selected: value === active }, [label]);
}

function accountPanel(user, draft, fileInput) {
  const name = user.nickname || user.username || 'IMPERIA';
  const id = String(user.id || '1254689787');
  return panel('AKKAUNT', [
    h('div', { class: 'rs83-account-head' }, [
      h('div', { class: 'rs83-avatar-ring' }, [
        h('div', { class: `rs83-avatar color-${avatarColorFor(user.id || user.username || name)}` }, [
          user.avatar_url
            ? h('img', { src: user.avatar_url, alt: name })
            : avatarLetter(name),
        ]),
        h('button', { title: "Profilga o'tish", onclick: () => navigate('profile') }, ['P']),
      ]),
      h('h3', {}, [String(name).toUpperCase()]),
      h('div', { class: 'rs83-online' }, [h('i', {}, []), 'ONLINE']),
      h('strong', { class: 'rs83-badge' }, ['LEGEND']),
      h('div', { class: 'rs83-id' }, [
        h('span', {}, [`ID: ${id.slice(0, 12)}`]),
        h('button', { onclick: () => copyId(id) }, ['C']),
      ]),
    ]),
    actionButton('P', 'PROFILNI OCHISH', () => navigate('profile')),
    actionButton('I', "MA'LUMOTNI YUKLASH", () => fileInput.click()),
    actionButton('E', "MA'LUMOTNI SAQLASH", () => downloadSettings(user, draft)),
    actionButton('L', 'CHIQISH', logout, 'danger'),
  ]);
}

function actionButton(icon, label, onclick, kind = '') {
  return h('button', { class: `rs83-account-btn ${kind}`, onclick }, [h('span', {}, [icon]), h('b', {}, [label])]);
}

function systemPanel() {
  return panel('TIZIM HAQIDA', [
    infoLine("O'yin versiyasi", '2.4.7'),
    infoLine('Server holati', h('span', { class: 'rs83-status' }, [h('i', {}, []), 'ONLINE'])),
    infoLine('FPS rejim', `${document.documentElement.dataset.fpsLimit || 60} FPS`),
    infoLine('Grafika', String(document.documentElement.dataset.graphicsQuality || 'high').toUpperCase()),
    h('button', { class: 'rs83-cache', onclick: clearClientCache }, ['KESHNI TOZALASH']),
  ]);
}

function infoLine(label, value) {
  return h('div', { class: 'rs83-info-line' }, [
    h('span', {}, [label]),
    typeof value === 'string' ? h('b', {}, [value]) : value,
  ]);
}

function bottomBar() {
  return h('footer', { class: 'rs83-bottom' }, [
    h('button', { onclick: () => navigate('rules') }, ['?', h('span', {}, ['QOIDALAR'])]),
    h('button', { onclick: () => navigate('profile') }, ['P', h('span', {}, ['PROFIL'])]),
    h('button', { onclick: () => navigate('shop') }, ['S', h('span', {}, ["DO'KON"])]),
    h('button', { onclick: () => navigate('home') }, ['H', h('span', {}, ['BOSH MENU'])]),
  ]);
}

async function saveSettings(draft, successText = "O'zgarishlar saqlandi") {
  const payload = normalizeSettings(draft, { localOverrides: false });
  const res = await api.saveSettings(payload);
  await setLocale(payload.pref_language).catch(() => {});
  api.setLocale?.(payload.pref_language)?.catch?.(() => {});
  if (res?.settings) {
    Object.assign(draft, normalizeSettings({ ...payload, ...res.settings }, { localOverrides: false }));
    state.user = {
      ...(state.user || {}),
      settings: { ...((state.user || {}).settings || {}), ...res.settings },
    };
  }
  persistLocalPrefs(payload);
  toast(successText, 'success');
}

async function resetSettings(root, draft) {
  try {
    const res = await api.resetSettings();
    Object.assign(draft, normalizeSettings(res.settings || DEFAULT_SETTINGS, { localOverrides: false }));
    persistLocalPrefs(draft);
    toast("Sozlamalar qayta o'rnatildi", 'success');
    renderSettings(root);
  } catch (_) {
    Object.assign(draft, normalizeSettings(DEFAULT_SETTINGS));
    await saveSettings(draft, "Sozlamalar qayta o'rnatildi");
    renderSettings(root);
  }
}

function normalizeSettings(settings, options = {}) {
  const useLocalOverrides = options.localOverrides !== false;
  const normalized = normalizeRuntimeSettings({
    ...DEFAULT_SETTINGS,
    ...settings,
  });
  if (useLocalOverrides) {
    for (const key of Object.keys(PREF_DEFAULTS)) {
      if (key === 'pref_music') continue;
      const localValue = localPreferenceValue(key);
      if (localValue !== null) normalized[key] = localValue;
    }
  }
  if (!musicWasUserSet()) {
    normalized.pref_music = false;
  } else if (useLocalOverrides) {
    const localValue = localMusicPreference();
    if (localValue !== null) normalized.pref_music = localValue;
  }
  return normalized;
}

function clampVolume(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function persistLocalPrefs(settings) {
  const normalized = normalizeSettings(settings, { localOverrides: false });
  state.user = {
    ...(state.user || {}),
    settings: { ...((state.user || {}).settings || {}), ...normalized },
  };
  for (const [key, value] of Object.entries(normalized)) {
    if (Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, key)) setPrefValue(key, value);
  }
  try {
    localStorage.setItem('locale', normalized.pref_language);
    document.documentElement.lang = normalized.pref_language;
  } catch (_) { /* ignore */ }
  sfx.configure?.({
    soundEnabled: normalized.pref_sound,
    musicEnabled: normalized.pref_music,
    masterVolume: normalized.pref_master_volume,
    musicVolume: normalized.pref_music_volume,
    effectsVolume: normalized.pref_effects_volume,
    voiceVolume: normalized.pref_voice_volume,
  });
  applyRuntimeSettings(normalized);
}

function applySliderPaint(screen) {
  screen.querySelectorAll('.rs83-slider input').forEach((input) => {
    input.style.setProperty('--fill', `${input.value}%`);
  });
}

async function copyId(id) {
  try {
    await navigator.clipboard.writeText(id);
    toast('ID nusxalandi', 'success');
  } catch (_) {
    toast('ID nusxalash imkonsiz', 'error');
  }
}

function downloadSettings(user, settings) {
  const blob = new Blob([JSON.stringify({ userId: user.id, settings: normalizeSettings(settings) }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'durak-imperia-settings.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 800);
  toast("Ma'lumot yuklab olindi", 'success');
}

async function clearClientCache() {
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    sessionStorage.removeItem('durak-v82-live-sync-cache-reset');
    toast('Kesh tozalandi', 'success');
  } catch (_) {
    toast('Kesh tozalanmadi', 'error');
  }
}

function logout() {
  if (!confirm('Akkauntdan chiqasizmi?')) return;
  clearToken();
  state.user = null;
  toast('Akkauntdan chiqildi', 'success');
  navigate('login');
}

const SETTINGS_TEXT = {
  ru: {
    'SOZLAMALAR': 'НАСТРОЙКИ',
    "O'YIN SOZLAMALARINI MOSLANG": 'НАСТРОЙТЕ ИГРУ',
    "QAYTA O'RNATISH": 'СБРОС',
    'SAQLASH': 'СОХРАНИТЬ',
    'DURAK DOLLAR': 'DURAK DOLLAR',
    'GOLD COIN': 'GOLD COIN',
    'UMUMIY': 'ОБЩИЕ',
    'Asosiy sozlamalar': 'Основные настройки',
    'GRAFIKA': 'ГРАФИКА',
    'Grafika va FPS': 'Графика и FPS',
    'OVOZ': 'ЗВУК',
    'Ovoz va musiqa': 'Звук и музыка',
    'BOSHQARUV': 'УПРАВЛЕНИЕ',
    'Karta boshqaruvi': 'Управление картами',
    'XABARLAR': 'СООБЩЕНИЯ',
    'Chat va effektlar': 'Чат и эффекты',
    'MAXFIYLIK': 'ПРИВАТНОСТЬ',
    'Xavfsizlik': 'Безопасность',
    'TIL': 'ЯЗЫК',
    'Til tanlash': 'Выбор языка',
    'YORDAM': 'ПОМОЩЬ',
    "Qo'llab-quvvatlash": 'Поддержка',
    'BOSHQA': 'ДРУГОЕ',
    'Import, eksport': 'Импорт, экспорт',
    "O'YINNI BAHOLASH": 'ОЦЕНИТЬ ИГРУ',
    'Bizni qo\'llab-quvvatlang': 'Поддержите нас',
    'UMUMIY SOZLAMALAR': 'ОБЩИЕ НАСТРОЙКИ',
    'Qorong\'i mavzu': 'Темная тема',
    'VIBRATSIYA': 'ВИБРАЦИЯ',
    "Vibratsiya yoqish/o'chirish": 'Включить или выключить вибрацию',
    "O'yin tili": 'Язык игры',
    "HUD KO'RINISHI": 'ВИД HUD',
    'Interfeys kattaligi': 'Размер интерфейса',
    'KOMPAKT': 'КОМПАКТ',
    "O'RTA": 'СРЕДНИЙ',
    'KENG': 'ШИРОКИЙ',
    'GRAFIKA SOZLAMALARI': 'НАСТРОЙКИ ГРАФИКИ',
    'GRAFIKA SIFATI': 'КАЧЕСТВО ГРАФИКИ',
    'Render sifati': 'Качество рендера',
    'FPS LIMIT': 'ЛИМИТ FPS',
    'Kadrlar chegarasi': 'Ограничение кадров',
    'SOYALAR': 'ТЕНИ',
    "Soya yoqish/o'chirish": 'Включить или выключить тени',
    'ANTI-ALIASING': 'СГЛАЖИВАНИЕ',
    'Karta qirralarini silliqlash': 'Сглаживание краев карт',
    'EFFECTLAR SIFATI': 'КАЧЕСТВО ЭФФЕКТОВ',
    'Animatsiya sifati': 'Качество анимации',
    'YORITISH SIFATI': 'КАЧЕСТВО СВЕТА',
    'Glow va yoruglik sifati': 'Свечение и освещение',
    'OVOZ SOZLAMALARI': 'НАСТРОЙКИ ЗВУКА',
    'OVOZ': 'ЗВУК',
    "O'yin ovozlarini yoqish": 'Включить звуки игры',
    'MUSIQA': 'МУЗЫКА',
    'Fon musiqasini yoqish': 'Включить фоновую музыку',
    'ASOSIY OVOZ': 'ОБЩАЯ ГРОМКОСТЬ',
    "O'yin umumiy ovozi": 'Общая громкость игры',
    'MUSIQA OVOZI': 'ГРОМКОСТЬ МУЗЫКИ',
    'Fon musiqasi ovozi': 'Громкость фоновой музыки',
    'EFEKT OVOZLARI': 'ЗВУКИ ЭФФЕКТОВ',
    "O'yin effektlari ovozi": 'Громкость эффектов',
    'VOICE CHAT': 'ГОЛОСОВОЙ ЧАТ',
    'Voice chat ovozi': 'Громкость голосового чата',
    'BOSHQARUV SOZLAMALARI': 'НАСТРОЙКИ УПРАВЛЕНИЯ',
    'KARTA JOYLASH': 'КЛАСТЬ КАРТУ',
    "Kartalarni stolga qo'yish usuli": 'Способ выкладывания карт',
    'TEGISH': 'КАСАНИЕ',
    'SUDRASH': 'ПЕРЕТАСКИВАНИЕ',
    'JOYSTICK LOCK': 'БЛОКИРОВКА ДЖОЙСТИКА',
    'Boshqaruvni qulflash': 'Зафиксировать управление',
    "O'NG QO'L REJIMI": 'РЕЖИМ ПРАВОЙ РУКИ',
    "Asosiy tugmalar o'ng tomonda": 'Главные кнопки справа',
    'DOUBLE TAP': 'ДВОЙНОЕ НАЖАТИЕ',
    'Ikki marta bosib yurish': 'Ход двойным нажатием',
    'NAVBAT SORT': 'СОРТИРОВКА ХОДА',
    'Navbatga mos kartalarni oldinga chiqarish': 'Показывать подходящие карты первыми',
    'QIYMAT SORT': 'СОРТИРОВКА ПО ЗНАЧЕНИЮ',
    "Kartalarni qiymat bo'yicha tartiblash": 'Сортировать карты по значению',
    'AVTO TARQATISH': 'АВТОРАЗДАЧА',
    'Tarqatish animatsiyasini avtomatik boshqarish': 'Автоматическая анимация раздачи',
    'XABAR VA CHAT': 'СООБЩЕНИЯ И ЧАТ',
    'TEZKOR CHAT': 'БЫСТРЫЙ ЧАТ',
    "Tezkor chat tugmalarini ko'rsatish": 'Показывать кнопки быстрого чата',
    'EMOJI VA STIKER': 'EMOJI И СТИКЕРЫ',
    "O'yin ichidagi emotsiyalar": 'Эмоции внутри игры',
    'MUKOFOT ANIMATSIYASI': 'АНИМАЦИЯ НАГРАД',
    "G'alaba va mukofot effektlari": 'Эффекты победы и наград',
    'MUSIQA XABARI': 'МУЗЫКА',
    'Musiqa alohida boshqariladi': 'Музыка управляется отдельно',
    'MAXFIYLIK VA XAVFSIZLIK': 'ПРИВАТНОСТЬ И БЕЗОПАСНОСТЬ',
    'HALOL REJIM': 'БЕЗОПАСНЫЙ РЕЖИМ',
    'Bezovta qiluvchi kontentni cheklash': 'Ограничить нежелательный контент',
    "KARTA KO'YLAGI": 'РУБАШКА КАРТ',
    'Tanlangan skinni ishlatish': 'Использовать выбранный скин',
    'PROFIL': 'ПРОФИЛЬ',
    "Profil ma'lumotlarini boshqarish": 'Управлять профилем',
    'CHIQISH': 'ВЫЙТИ',
    'Akkauntdan chiqish': 'Выйти из аккаунта',
    'TIL SOZLAMALARI': 'НАСТРОЙКИ ЯЗЫКА',
    'INTERFEYS TILI': 'ЯЗЫК ИНТЕРФЕЙСА',
    'Matnlar tili': 'Язык текста',
    'SAHIFANI YANGILASH': 'ОБНОВИТЬ СТРАНИЦУ',
    "Tanlangan tilni ko'rish": 'Показать выбранный язык',
    'QOIDALAR': 'ПРАВИЛА',
    "O'yin qoidalarini ochish": 'Открыть правила игры',
    "Akkaunt sahifasini ochish": 'Открыть страницу аккаунта',
    "DO'KON": 'МАГАЗИН',
    "Paket va skinlarni ko'rish": 'Посмотреть пакеты и скины',
    'KESHNI TOZALASH': 'ОЧИСТИТЬ КЕШ',
    'Brauzer keshini tozalash': 'Очистить кеш браузера',
    'IMPORT': 'ИМПОРТ',
    'JSON sozlamalarni yuklash': 'Загрузить настройки JSON',
    'EKSPORT': 'ЭКСПОРТ',
    'JSON sozlamalarni saqlash': 'Сохранить настройки JSON',
    'Standart sozlamalarga qaytish': 'Вернуть стандартные настройки',
    'BOSH MENU': 'ГЛАВНОЕ МЕНЮ',
    'Asosiy menyuga qaytish': 'Вернуться в главное меню',
    "O'ZGARISHLARNI SAQLASH": 'СОХРАНИТЬ ИЗМЕНЕНИЯ',
    'AKKAUNT': 'АККАУНТ',
    'ONLINE': 'ОНЛАЙН',
    'PROFILNI OCHISH': 'ОТКРЫТЬ ПРОФИЛЬ',
    "MA'LUMOTNI YUKLASH": 'ЗАГРУЗИТЬ ДАННЫЕ',
    "MA'LUMOTNI SAQLASH": 'СОХРАНИТЬ ДАННЫЕ',
    'TIZIM HAQIDA': 'О СИСТЕМЕ',
    "O'yin versiyasi": 'Версия игры',
    'Server holati': 'Состояние сервера',
    'FPS rejim': 'Режим FPS',
    'Grafika': 'Графика',
    'BOSH MENU': 'ГЛАВНОЕ МЕНЮ',
    'OPEN': 'ОТКРЫТЬ',
    'ON': 'ВКЛ',
    'OFF': 'ВЫКЛ',
  },
};

function localizeSettingsScreen(screen, lang) {
  const dict = SETTINGS_TEXT[lang];
  if (!screen || !dict) return;
  const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const raw = node.nodeValue;
    const trimmed = raw.trim();
    if (!trimmed || !dict[trimmed]) continue;
    node.nodeValue = raw.replace(trimmed, dict[trimmed]);
  }
}
