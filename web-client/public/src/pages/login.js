import { h } from '../ui.js';
import { api, API_BASE, setToken } from '../api.js';
import { navigate } from '../router.js';
import { state, toast } from '../state.js';
import { getLocale, setLocale } from '../i18n.js';
import { openSupportWidget } from '../supportWidget.js?v=141-support-draft';

const LOGIN_RE = /^[A-Za-z0-9_]{3,24}$/;

const LOCALES = {
  uz: "O'zbekcha",
  ru: 'Russkiy',
  en: 'English',
};

const FLAG_LOCALES = [
  { code: 'uz', label: "O'zbekcha", src: '/flags/uz.jpg' },
  { code: 'ru', label: 'Russkiy', src: '/flags/ru.jfif' },
  { code: 'en', label: 'English', src: '/flags/en.avif' },
];

const LOGIN_COPY = {
  uz: {
    google: 'GOOGLE BILAN KIRISH',
    telegram: 'TELEGRAM BILAN KIRISH',
    account: 'LOGIN / ROYXATDAN OTISH',
    or: 'yoki',
    loading: 'YUKLANMOQDA...',
    help: 'Yordam',
    news: 'Yangiliklar',
    settings: 'Sozlamalar',
    support: "Qollab-quvvatlash",
    supportAction: 'Supportga yozish',
    helpTitle: 'Yordam',
    helpLines: [
      'Google bilan kirsangiz akkauntingiz saqlanadi.',
      'Login va parol bilan kirish: avval royxatdan oting, keyin shu login/parol bilan kiring.',
      'Savollar uchun support bolimidan yozing.',
    ],
    newsTitle: 'Yangiliklar',
    newsLines: [
      "Durak Imperia: premium dizayn, turnir, dokon, AI yordamchi va online xonalar.",
      "Yangiliklar Play Market versiyasida ham shu bolimda korsatiladi.",
    ],
    supportTitle: "Qollab-quvvatlash",
    supportLines: [
      "Muammo bolsa supportga yozing, javob shu oynada chiqadi.",
      "Oyin ichida shikoyat tugmasi ham ishlaydi.",
    ],
    safeTitle: 'XAVFSIZ',
    safeText: "100% himoyalangan oyin",
    realTitle: 'REAL OYINCHILAR',
    realText: "Dostlar va online raqiblar",
    voiceTitle: 'OVOZLI CHAT',
    voiceText: "Dostlaringiz bilan gaplashib oynang",
    copyright: '(c) 2026 DURAK IMPERIA. BARCHA HUQUQLAR HIMOYALANGAN.',
    firebaseMissing: 'Firebase sozlanmagan. Hozircha login/parol bilan kiring.',
    googleFailed: 'Google orqali kirib bolmadi',
    checkingLogin: 'Kirish tekshirilmoqda...',
    registering: "Royxatdan otkazilmoqda...",
    validationLogin: 'Login 3-24 belgi, faqat harf/raqam/_',
    validationPassword: "Parol kamida 8 ta belgi bolsin",
    welcome: 'Xush kelibsiz, @{name}',
    settingsTitle: 'Sozlamalar',
    chooseLanguage: 'Tilni tanlang:',
    settingsFooter: "Ovoz va boshqa sozlamalar oyinga kirgandan keyin Sozlamalar sahifasida saqlanadi.",
    accountTitle: 'Akkauntga kirish',
    accountIntro: "Login va parol bilan kiring yoki yangi akkaunt oching.",
    loginTab: 'Kirish',
    registerTab: "Royxatdan o'tish",
    loginPlaceholder: 'Login yoki nickname',
    passwordPlaceholder: 'Parol',
    submitLogin: 'KIRISH',
    submitRegister: "RO'YXATDAN OTISH",
    loginHint: "Avval royxatdan o'tgan login va parolingizni kiriting.",
    registerHint: "Login band bo'lmasa, akkaunt yaratiladi va avtomatik kiradi.",
    invalidCredentials: "Login yoki parol noto'g'ri",
    loginTaken: 'Bu login band',
    tooMany: "Juda kop urinish boldi. Birozdan keyin qayta urinib koring.",
    invalidFormat: 'Login va parol formatini tekshiring',
    authFailed: 'Kirish amalga oshmadi',
  },
  ru: {
    google: 'VOYTI CHEREZ GOOGLE',
    telegram: 'VOYTI CHEREZ TELEGRAM',
    account: 'LOGIN / REGISTRATSIYA',
    or: 'ili',
    loading: 'ZAGRUZKA...',
    help: 'Pomoshch',
    news: 'Novosti',
    settings: 'Nastroyki',
    support: 'Podderzhka',
    supportAction: 'Napisat v support',
    helpTitle: 'Pomoshch',
    helpLines: [
      'Pri vhode cherez Google akkaunt sohranyaetsya.',
      'Login/parol: snachala zaregistriruytes, potom vhodite s etim loginom i parolem.',
      'Po voprosam pishite v razdel podderzhki.',
    ],
    newsTitle: 'Novosti',
    newsLines: [
      'Durak Imperia: premium dizayn, turniry, magazin, AI-pomoshchnik i online-komnaty.',
      'Novosti versii Play Market budut pokazany v etom razdele.',
    ],
    supportTitle: 'Podderzhka',
    supportLines: [
      'Esli est problema, napishite v support. Otvet budet v etom okne.',
      'V igre takzhe rabotaet knopka zhaloby.',
    ],
    safeTitle: 'BEZOPASNO',
    safeText: '100% zashchishchennaya igra',
    realTitle: 'REALNYE IGROKI',
    realText: 'Druzya i online-soperniki',
    voiceTitle: 'GOLOSOVOY CHAT',
    voiceText: 'Igrayte i obshchaytes s druzyami',
    copyright: '(c) 2026 DURAK IMPERIA. VSE PRAVA ZASHCHISHCHENY.',
    firebaseMissing: 'Firebase ne nastroyen. Poka voydite cherez login i parol.',
    googleFailed: 'Ne udalos voyti cherez Google',
    checkingLogin: 'Proveryaem vhod...',
    registering: 'Registriruem akkaunt...',
    validationLogin: 'Login: 3-24 simvola, tolko bukvy/tsifry/_',
    validationPassword: 'Parol dolzhen byt minimum 8 simvolov',
    welcome: 'Dobro pozhalovat, @{name}',
    settingsTitle: 'Nastroyki',
    chooseLanguage: 'Vyberite yazyk:',
    settingsFooter: 'Zvuk i drugie nastroyki sohranyayutsya na stranitse nastroyek posle vhoda v igru.',
    accountTitle: 'Vhod v akkaunt',
    accountIntro: 'Voydite po loginu i parolyu ili sozdayte novyy akkaunt.',
    loginTab: 'Vhod',
    registerTab: 'Registratsiya',
    loginPlaceholder: 'Login ili nickname',
    passwordPlaceholder: 'Parol',
    submitLogin: 'VOYTI',
    submitRegister: 'ZAREGISTRIROVATSYA',
    loginHint: 'Vvedite login i parol, s kotorymi vy zaregistrirovalis.',
    registerHint: 'Esli login svoboden, akkaunt budet sozdan i vhod vypolnitsya avtomaticheski.',
    invalidCredentials: 'Nevernyy login ili parol',
    loginTaken: 'Etot login uzhe zanyat',
    tooMany: 'Slishkom mnogo popytok. Poprobuyte nemnogo pozhe.',
    invalidFormat: 'Proverte format logina i parolya',
    authFailed: 'Ne udalos voyti',
  },
  en: {
    google: 'SIGN IN WITH GOOGLE',
    telegram: 'SIGN IN WITH TELEGRAM',
    account: 'LOGIN / REGISTER',
    or: 'or',
    loading: 'LOADING...',
    help: 'Help',
    news: 'News',
    settings: 'Settings',
    support: 'Support',
    supportAction: 'Write to support',
    helpTitle: 'Help',
    helpLines: [
      'Your account is saved when you sign in with Google.',
      'For login and password: register first, then use that login and password to sign in.',
      'For questions, write through the support section.',
    ],
    newsTitle: 'News',
    newsLines: [
      'Durak Imperia: premium design, tournaments, shop, AI assistant and online rooms.',
      'Play Market version news will also appear here.',
    ],
    supportTitle: 'Support',
    supportLines: [
      'If something is wrong, write to support. The answer appears in this window.',
      'The in-game report button also works.',
    ],
    safeTitle: 'SAFE',
    safeText: '100% protected game',
    realTitle: 'REAL PLAYERS',
    realText: 'Friends and online opponents',
    voiceTitle: 'VOICE CHAT',
    voiceText: 'Talk with friends while playing',
    copyright: '(c) 2026 DURAK IMPERIA. ALL RIGHTS RESERVED.',
    firebaseMissing: 'Firebase is not configured. Use login and password for now.',
    googleFailed: 'Could not sign in with Google',
    checkingLogin: 'Checking login...',
    registering: 'Creating account...',
    validationLogin: 'Login must be 3-24 chars, letters/numbers/_ only',
    validationPassword: 'Password must be at least 8 characters',
    welcome: 'Welcome, @{name}',
    settingsTitle: 'Settings',
    chooseLanguage: 'Choose language:',
    settingsFooter: 'Sound and other settings are saved on the Settings page after entering the game.',
    accountTitle: 'Account login',
    accountIntro: 'Sign in with login and password or create a new account.',
    loginTab: 'Login',
    registerTab: 'Register',
    loginPlaceholder: 'Login or nickname',
    passwordPlaceholder: 'Password',
    submitLogin: 'LOGIN',
    submitRegister: 'REGISTER',
    loginHint: 'Enter the login and password you registered with.',
    registerHint: 'If the login is free, the account will be created and signed in automatically.',
    invalidCredentials: 'Wrong login or password',
    loginTaken: 'This login is taken',
    tooMany: 'Too many attempts. Try again later.',
    invalidFormat: 'Check login and password format',
    authFailed: 'Sign-in failed',
  },
};

function loginCopy() {
  return LOGIN_COPY[getLocale()] || LOGIN_COPY.uz;
}

async function ensureFirebaseReady(tr) {
  await window.__firebaseInitPromise?.catch(() => null);
  const firebase = window.firebase;
  if (!firebase || !firebase.auth) throw new Error(tr.firebaseMissing);
  if (!window.__GOOGLE_SIGN_IN_DISABLED__ && firebase.apps?.length) return firebase;

  let config = null;
  try {
    const res = await fetch(`${API_BASE || ''}/api/auth/firebase-config`, { cache: 'no-store' });
    if (res.ok) config = await res.json();
  } catch (_) { /* handled below */ }

  if (!config?.configured || !config?.apiKey || !config?.authDomain || !config?.projectId || !config?.messagingSenderId || !config?.appId) {
    window.__GOOGLE_SIGN_IN_DISABLED__ = true;
    throw new Error(tr.firebaseMissing);
  }

  try {
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(config);
  } catch (err) {
    window.__GOOGLE_SIGN_IN_DISABLED__ = true;
    throw err;
  }
  window.__GOOGLE_SIGN_IN_DISABLED__ = false;
  return firebase;
}

async function finishGoogleSignIn(result, tr) {
  if (!result?.user) return false;
  const idToken = await result.user.getIdToken();
  const res = await api.google(idToken);
  setToken(res.token);
  state.user = res.user;
  await api.setLocale(getLocale()).catch(() => {});
  toast(tr.welcome.replace('{name}', res.user?.nickname || res.user?.username || 'Google'), 'success');
  const needsNickname = !!res.needsNickname || !res.user?.nickname || res.user?.nickname_set === false;
  navigate(needsNickname ? 'nickname' : 'home');
  return true;
}

function googleErrorMessage(error, tr) {
  const code = error?.code || '';
  if (code === 'auth/unauthorized-domain') return "Google login uchun Firebase Authorized domains ga shu domenni qo'shish kerak.";
  if (code.includes('api-key-not-valid') || code === 'auth/invalid-api-key') return "Firebase API key yaroqsiz. Firebase Console'dan Web API key yangilanishi kerak.";
  if (code === 'auth/popup-blocked') return 'Popup bloklandi. Google oynasi redirect orqali ochilmoqda.';
  if (code === 'auth/network-request-failed') return 'Internet yoki Firebase ulanishini tekshiring.';
  return error?.message || tr.googleFailed;
}

export function renderLogin(root) {
  root.innerHTML = '';
  const tr = loginCopy();

  let googleLoading = false;
  let authLoading = false;

  const errorEl = h('div', { class: 'royal-login-error' });
  const isTelegram = !!(window.Telegram?.WebApp?.initData);
  const googleBtn = isTelegram
    ? h('button', { class: 'royal-login-btn telegram', style: 'background: linear-gradient(135deg, #24A1DE, #179CDE); color: white;' }, [
        telegramMark(),
        h('span', {}, [tr.telegram]),
      ])
    : h('button', { class: 'royal-login-btn google' }, [
        googleMark(),
        h('span', {}, [tr.google]),
      ]);
  const accountBtn = h('button', { class: 'royal-login-btn nickname' }, [
    h('span', { class: 'royal-login-btn-icon' }, ['@']),
    h('span', {}, [tr.account]),
  ]);

  const screen = h('div', { class: 'screen royal-login-screen' }, [
    h('div', { class: 'royal-login-shade' }),
    h('header', { class: 'royal-login-top' }, [
      languageFlags(root),
      h('div', { class: 'royal-login-tools' }, [
        toolButton('!', tr.news, () => showInfoModal(tr.newsTitle, tr.newsLines)),
        toolButton('*', tr.settings, () => showSettingsModal(root)),
        toolButton('?', tr.support, () => showInfoModal(tr.supportTitle, tr.supportLines, {
          label: tr.supportAction || tr.support,
          onClick: () => openSupportWidget({ create: true }),
        })),
      ]),
    ]),
    h('main', { class: 'royal-login-main' }, [
      h('div', { class: 'royal-login-brand', 'aria-label': 'Durak Imperia' }, [
        h('div', { class: 'royal-crown' }, ['*']),
        h('div', { class: 'royal-title-main' }, ['']),
        h('div', { class: 'royal-title-sub' }, ['']),
      ]),
      h('div', { class: 'royal-login-actions' }, [
        googleBtn,
        h('div', { class: 'royal-login-or' }, [
          h('span'), h('b', {}, [tr.or]), h('span'),
        ]),
        accountBtn,
        errorEl,
      ]),
    ]),
    h('footer', { class: 'royal-login-footer' }, [
      feature('shield', 'XAVFSIZ', "100% himoyalangan oyin"),
      feature('players', "REAL OYINCHILAR", "Dostlar va online raqiblar"),
      feature('voice', 'OVOZLI CHAT', "Dostlaringiz bilan gaplashib oynang"),
    ]),
    h('div', { class: 'royal-login-copy' }, ['(c) 2026 DURAK IMPERIA. BARCHA HUQUQLAR HIMOYALANGAN.']),
  ]);

  root.appendChild(screen);
  const featureRows = screen.querySelectorAll('.royal-feature');
  const featureCopy = [
    [tr.safeTitle, tr.safeText],
    [tr.realTitle, tr.realText],
    [tr.voiceTitle, tr.voiceText],
  ];
  featureRows.forEach((row, index) => {
    const [title, text] = featureCopy[index] || [];
    if (title) row.querySelector('b').textContent = title;
    if (text) row.querySelector('small').textContent = text;
  });
  screen.querySelector('.royal-login-copy').textContent = tr.copyright;

  if (!isTelegram && sessionStorage.getItem('durak.google.redirect.pending') === '1') {
    sessionStorage.removeItem('durak.google.redirect.pending');
    ensureFirebaseReady(tr).then((firebase) => firebase.auth().getRedirectResult())
      .then((result) => finishGoogleSignIn(result, tr))
      .catch((err) => { errorEl.textContent = googleErrorMessage(err, tr); });
  }

  googleBtn.addEventListener('click', async () => {
    if (googleLoading) return;
    googleLoading = true;
    googleBtn.disabled = true;
    errorEl.textContent = '';
    googleBtn.querySelector('span:last-child').textContent = tr.loading;

    if (isTelegram) {
      try {
        const initData = window.Telegram?.WebApp?.initData;
        const res = await api.telegram(initData);
        setToken(res.token);
        state.user = res.user;
        await api.setLocale(getLocale()).catch(() => {});
        toast(tr.welcome.replace('{name}', res.user?.nickname || res.user?.username || 'Telegram'), 'success');
        const needsNickname = !!res.needsNickname || !res.user?.nickname || res.user?.nickname_set === false;
        navigate(needsNickname ? 'nickname' : 'home');
      } catch (e) {
        errorEl.textContent = e.message || 'Telegram auth failed';
        googleBtn.disabled = false;
        googleBtn.querySelector('span:last-child').textContent = tr.telegram;
        googleLoading = false;
      }
    } else {
      let provider = null;
      try {
        const firebase = await ensureFirebaseReady(tr);
        provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await firebase.auth().signInWithPopup(provider);
        await finishGoogleSignIn(result, tr);
      } catch (e) {
        if ((e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') && provider) {
          try {
            const firebase = await ensureFirebaseReady(tr);
            sessionStorage.setItem('durak.google.redirect.pending', '1');
            await firebase.auth().signInWithRedirect(provider);
            return;
          } catch (redirectErr) {
            e = redirectErr;
          }
        }
        if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') {
          errorEl.textContent = '';
        } else {
          errorEl.textContent = googleErrorMessage(e, tr);
        }
        googleBtn.disabled = false;
        googleBtn.querySelector('span:last-child').textContent = tr.google;
        googleLoading = false;
      }
    }
  });

  accountBtn.addEventListener('click', () => {
    if (authLoading) return;
    showAccountModal(async (mode, payload, statusEl, submitBtn, closeModal) => {
      if (authLoading) return;
      authLoading = true;
      submitBtn.disabled = true;
      statusEl.textContent = mode === 'login' ? tr.checkingLogin : tr.registering;
      statusEl.className = 'royal-nick-status';
      try {
        const loginName = String(payload?.login || '').trim();
        const password = String(payload?.password || '');
        if (!LOGIN_RE.test(loginName)) throw new Error(tr.validationLogin);
        if (password.length < 8) throw new Error(tr.validationPassword);

        const res = mode === 'login'
          ? await api.login({ identifier: loginName, password })
          : await api.register({
              username: loginName,
              password,
              referralCode: localStorage.getItem('referral_code') || undefined,
            });

        setToken(res.token);
        state.user = res.user;
        await api.setLocale(getLocale()).catch(() => {});
        toast(tr.welcome.replace('{name}', res.user?.nickname || res.user?.username || loginName), 'success');
        closeModal();
        navigate('home');
      } catch (e) {
        statusEl.className = 'royal-nick-status error';
        statusEl.textContent = humanAuthError(e);
        submitBtn.disabled = false;
        authLoading = false;
      }
    }, () => { authLoading = false; });
  });
}

function googleMark() {
  const svg = h('svg', { class: 'royal-google-mark', viewBox: '0 0 48 48', 'aria-hidden': 'true' });
  svg.innerHTML = `
    <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-21 0-1.7-.2-3.3-.5-5z"/>
    <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 14.6 19.2 11 24 11c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.1 2 9.2 6.5 6.3 14.7z"/>
    <path fill="#FBBC05" d="M24 46c6 0 11.1-2 14.8-5.5l-7-5.7C29.8 36.2 27.2 37 24 37c-6 0-11.1-4-12.9-9.5l-7.1 5.5C7.4 40.7 15.1 46 24 46z"/>
    <path fill="#EA4335" d="M11.1 27.5A13.5 13.5 0 0 1 11 24c0-1.2.2-2.4.5-3.5l-7.2-5.8A22 22 0 0 0 2 24c0 3.2.7 6.2 2 9l7.1-5.5z"/>
  `;
  return svg;
}

function telegramMark() {
  const svg = h('svg', { class: 'royal-telegram-mark', viewBox: '0 0 24 24', 'aria-hidden': 'true', style: 'width: 20px; height: 20px; fill: currentColor; margin-right: 8px;' });
  svg.innerHTML = `
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.11.02-1.89 1.2-5.34 3.53-.51.35-.97.52-1.37.51-.44-.01-1.29-.25-1.92-.45-.77-.25-1.38-.39-1.33-.82.03-.22.33-.45.91-.69 3.56-1.55 5.94-2.57 7.14-3.07 3.4-1.42 4.1-.17 4.1.42.01.12.01.25-.01.37z"/>
  `;
  return svg;
}

function languageFlags(root) {
  return h('div', { class: 'royal-language-flags', role: 'group', 'aria-label': 'Til tanlash' }, FLAG_LOCALES.map((item) => (
    h('button', {
      class: `royal-flag-btn ${getLocale() === item.code ? 'active' : ''}`,
      type: 'button',
      title: item.label,
      'aria-label': item.label,
      onclick: () => setLocale(item.code, () => renderLogin(root)),
    }, [
      h('img', { src: item.src, alt: item.label, loading: 'eager' }),
    ])
  )));
}

function toolButton(icon, label, onClick) {
  return h('button', { class: 'royal-tool', onclick: onClick }, [
    h('span', {}, [icon]),
    h('small', {}, [label]),
  ]);
}

function feature(icon, title, text) {
  return h('div', { class: 'royal-feature' }, [
    h('span', { class: `royal-feature-icon ${icon}`, 'aria-hidden': 'true' }, [
      h('i'),
    ]),
    h('div', {}, [
      h('b', {}, [title]),
      h('small', {}, [text]),
    ]),
  ]);
}

function showInfoModal(title, lines, action = null) {
  const close = () => bg.remove();
  const modalChildren = [
    h('button', { class: 'royal-modal-close', onclick: close }, ['X']),
    h('h2', {}, [title]),
    ...lines.map((line) => h('p', {}, [line])),
  ];
  if (action?.label && typeof action.onClick === 'function') {
    modalChildren.push(h('button', {
      type: 'button',
      class: 'royal-modal-action',
      onclick: () => {
        close();
        action.onClick();
      },
    }, [action.label]));
  }
  const bg = h('div', { class: 'royal-modal-bg', onclick: (e) => { if (e.target === bg) close(); } }, [
    h('div', { class: 'royal-modal' }, modalChildren),
  ]);
  document.body.appendChild(bg);
}

function showSettingsModal(root) {
  const tr = loginCopy();
  const close = () => bg.remove();
  const bg = h('div', { class: 'royal-modal-bg', onclick: (e) => { if (e.target === bg) close(); } }, [
    h('div', { class: 'royal-modal' }, [
      h('button', { class: 'royal-modal-close', onclick: close }, ['X']),
      h('h2', {}, [tr.settingsTitle]),
      h('p', {}, [tr.chooseLanguage]),
      h('div', { class: 'royal-settings-row' }, Object.entries(LOCALES).map(([code, label]) => h('button', {
        class: `royal-setting-pill ${getLocale() === code ? 'active' : ''}`,
        onclick: () => setLocale(code, () => { close(); renderLogin(root); }),
      }, [label]))),
      h('p', {}, [tr.settingsFooter]),
    ]),
  ]);
  document.body.appendChild(bg);
}

function showAccountModal(onSubmit, onClose) {
  const tr = loginCopy();
  let mode = 'login';
  const loginInput = h('input', {
    class: 'royal-nick-input',
    placeholder: tr.loginPlaceholder,
    maxlength: '24',
    autocapitalize: 'none',
    autocorrect: 'off',
    autocomplete: 'username',
  });
  const passInput = h('input', {
    class: 'royal-nick-input',
    placeholder: tr.passwordPlaceholder,
    type: 'password',
    maxlength: '128',
    autocomplete: 'current-password',
  });
  const status = h('div', { class: 'royal-nick-status' });
  const submit = h('button', { class: 'royal-login-btn nickname compact' }, [tr.submitLogin]);
  const hint = h('p', { class: 'royal-auth-hint' });
  const loginTab = h('button', { type: 'button', class: 'active' }, [tr.loginTab]);
  const registerTab = h('button', { type: 'button' }, [tr.registerTab]);
  const close = () => {
    bg.remove();
    if (typeof onClose === 'function') onClose();
  };
  const bg = h('div', { class: 'royal-modal-bg', onclick: (e) => { if (e.target === bg) close(); } }, [
    h('form', { class: 'royal-modal royal-nick-modal royal-auth-modal' }, [
      h('button', { type: 'button', class: 'royal-modal-close', onclick: close }, ['X']),
      h('h2', {}, [tr.accountTitle]),
      h('p', {}, [tr.accountIntro]),
      h('div', { class: 'royal-auth-tabs' }, [loginTab, registerTab]),
      hint,
      h('div', { class: 'royal-nick-wrap' }, [
        h('span', {}, ['@']),
        loginInput,
      ]),
      h('div', { class: 'royal-nick-wrap royal-pass-wrap' }, [
        h('span', {}, ['#']),
        passInput,
      ]),
      status,
      submit,
    ]),
  ]);

  const setMode = (next) => {
    mode = next;
    loginTab.classList.toggle('active', mode === 'login');
    registerTab.classList.toggle('active', mode === 'register');
    submit.textContent = mode === 'login' ? tr.submitLogin : tr.submitRegister;
    passInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    hint.textContent = mode === 'login' ? tr.loginHint : tr.registerHint;
    status.textContent = '';
    status.className = 'royal-nick-status';
    submit.disabled = false;
  };

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));
  bg.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit(mode, { login: loginInput.value.trim(), password: passInput.value }, status, submit, close);
  });
  document.body.appendChild(bg);
  setMode('login');
  setTimeout(() => loginInput.focus(), 80);
}

function humanAuthError(e) {
  const tr = loginCopy();
  const msg = String(e?.message || '');
  if (e?.status === 401 || msg.includes('invalid credentials')) return tr.invalidCredentials;
  if (e?.status === 409 || msg.includes('taken') || msg.includes('exists')) return tr.loginTaken;
  if (e?.status === 429) return tr.tooMany;
  if (msg.includes('validation') || msg.includes('Invalid')) return tr.invalidFormat;
  return msg || tr.authFailed;
}
