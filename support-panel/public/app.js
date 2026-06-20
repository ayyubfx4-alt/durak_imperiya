(function () {
  const API = '';
  const TOKEN_KEY = 'durak.support.token';
  const PIN_KEY = 'durak.support.pin.ok';
  const DRAFT_KEY = 'durak.support.replyDrafts.v1';
  const app = document.getElementById('app');
  const storage = {
    get(key) {
      try { return localStorage.getItem(key); } catch (_) { return ''; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (_) {}
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (_) {}
    },
  };
  const state = {
    user: null,
    token: storage.get(TOKEN_KEY) || '',
    pinOk: storage.get(PIN_KEY) === '1',
    pinDraft: '',
    pinError: '',
    stats: null,
    tickets: [],
    selected: null,
    messages: [],
    status: 'open',
    q: '',
    view: 'list',
    error: '',
    busy: false,
    replyDrafts: readJson(DRAFT_KEY, {}),
    lastComposeAt: 0,
  };

  function clearSession() {
    state.token = '';
    state.user = null;
    state.pinOk = false;
    storage.remove(TOKEN_KEY);
    storage.remove(PIN_KEY);
  }

  function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    return fetch(`${API}${path}`, {
      method,
      headers,
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (res) => {
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401) {
          clearSession();
          setTimeout(render, 0);
        }
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      return data;
    }).catch((err) => {
      if (err instanceof TypeError) throw new Error('Tarmoq xatosi. Server bilan aloqa tekshirilsin.');
      throw err;
    });
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(storage.get(key) || '');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    storage.set(key, JSON.stringify(value));
  }

  function ticketDraft(id = state.selected?.id) {
    if (!id) return { body: '', internal: false };
    return state.replyDrafts[String(id)] || { body: '', internal: false };
  }

  function saveTicketDraft(id, patch) {
    if (!id) return;
    const key = String(id);
    const current = ticketDraft(key);
    state.replyDrafts = { ...state.replyDrafts, [key]: { ...current, ...patch } };
    state.lastComposeAt = Date.now();
    writeJson(DRAFT_KEY, state.replyDrafts);
  }

  function clearTicketDraft(id) {
    if (!id) return;
    const key = String(id);
    if (!state.replyDrafts[key]) return;
    const next = { ...state.replyDrafts };
    delete next[key];
    state.replyDrafts = next;
    writeJson(DRAFT_KEY, next);
  }

  const api = {
    pinLogin: (pin) => request('POST', '/api/admin/pin-login', { pin }),
    login: (username, password) => request('POST', '/api/admin/login', { username, password }),
    me: () => request('GET', '/api/admin/me'),
    stats: () => request('GET', '/api/support/admin/stats'),
    tickets: () => {
      const params = new URLSearchParams();
      if (state.status && state.status !== 'all') params.set('status', state.status);
      if (state.q) params.set('q', state.q);
      params.set('limit', '100');
      return request('GET', `/api/support/admin/tickets?${params}`);
    },
    ticket: (id) => request('GET', `/api/support/admin/tickets/${encodeURIComponent(id)}`),
    reply: (id, body, internal) => request('POST', `/api/support/admin/tickets/${encodeURIComponent(id)}/messages`, { body, internal }),
    status: (id, data) => request('PUT', `/api/support/admin/tickets/${encodeURIComponent(id)}/status`, data),
    assign: (id) => request('POST', `/api/support/admin/tickets/${encodeURIComponent(id)}/assign`, {}),
  };

  function node(tag, className, children) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    for (const child of Array.isArray(children) ? children : [children || '']) {
      if (child == null) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function fmt(value) {
    return Number(value || 0).toLocaleString('ru-RU');
  }

  function date(value) {
    return value ? new Date(value).toLocaleString('ru-RU') : '';
  }

  function statusLabel(status) {
    return {
      all: 'Hammasi',
      open: 'Ochiq',
      pending: 'Kutilmoqda',
      answered: 'Javob berilgan',
      closed: 'Yopilgan',
    }[status] || status || 'Ochiq';
  }

  function priorityLabel(priority) {
    return {
      low: 'Past',
      normal: 'Oddiy',
      high: 'Muhim',
      urgent: 'Shoshilinch',
    }[priority] || priority || 'Oddiy';
  }

  function imageAttachment(message) {
    const attachment = message?.metadata?.attachment;
    if (!attachment || attachment.type !== 'image' || !attachment.dataUrl) return null;
    return attachment;
  }

  function messageImageNode(attachment) {
    const link = node('a', 'message-image');
    link.href = attachment.dataUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.download = attachment.name || 'support-image.jpg';
    const img = document.createElement('img');
    img.src = attachment.dataUrl;
    img.alt = attachment.name || 'Support rasmi';
    link.appendChild(img);
    return link;
  }

  function setError(message) {
    state.error = message || '';
    render();
  }

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
  }

  function renderPinGate() {
    app.className = 'login-shell';
    const card = node('section', 'login-card pin-card');
    const title = node('div', 'brand', ['Support PIN']);
    const sub = node('div', 'sub', ['Panelga kirish uchun PIN kodni kiriting']);
    const pin = node('input', 'field pin-field');
    pin.type = 'password';
    pin.inputMode = 'numeric';
    pin.autocomplete = 'one-time-code';
    pin.maxLength = 4;
    pin.placeholder = 'PIN kod';
    pin.value = state.pinDraft;
    pin.oninput = (event) => {
      const next = String(event.target.value || '').replace(/\D/g, '').slice(0, 4);
      state.pinDraft = next;
      if (event.target.value !== next) event.target.value = next;
      state.pinError = '';
    };
    const button = node('button', 'btn');
    button.type = 'button';
    button.textContent = 'Kirish';

    const submit = async () => {
      const value = (state.pinDraft || pin.value).trim();
      if (!value) {
        state.pinError = 'PIN kodni kiriting';
        renderPinGate();
        return;
      }
      button.disabled = true;
      button.textContent = 'Tekshirilmoqda...';
      try {
        const data = await api.pinLogin(value);
        state.pinOk = true;
        state.pinError = '';
        state.pinDraft = '';
        state.error = '';
        state.token = data.token || '';
        state.user = data.user || null;
        storage.set(PIN_KEY, '1');
        storage.set(TOKEN_KEY, state.token);
        await bootstrap();
      } catch (err) {
        clearSession();
        state.pinError = err.message === 'invalid pin' ? 'PIN kod xato' : (err.message || 'PIN tekshirishda xato');
        renderPinGate();
      }
    };

    pin.onkeydown = (event) => {
      if (event.key === 'Enter') submit();
    };
    button.onclick = submit;
    card.append(title, sub, pin, button);
    if (state.pinError) card.appendChild(node('div', 'error', [state.pinError]));
    app.replaceChildren(card);
    pin.focus();
  }

  function renderLogin() {
    app.className = 'login-shell';
    const card = node('section', 'login-card');
    const title = node('div', 'brand', ['Support Panel']);
    const sub = node('div', 'sub', ['Faqat support chat uchun alohida panel']);
    const username = node('input', 'field');
    username.placeholder = 'login yoki email';
    username.autocomplete = 'username';
    const password = node('input', 'field');
    password.placeholder = 'parol';
    password.type = 'password';
    password.autocomplete = 'current-password';
    const button = node('button', 'btn');
    button.type = 'button';
    button.textContent = 'Kirish';
    button.onclick = async () => {
      button.disabled = true;
      try {
        const data = await api.login(username.value, password.value);
        state.token = data.token || '';
        storage.set(TOKEN_KEY, state.token);
        state.user = data.user;
        state.error = '';
        await bootstrap();
      } catch (err) {
        state.error = err.message || 'Login xato';
        render();
      } finally {
        button.disabled = false;
      }
    };
    card.append(title, sub, username, password, button);
    if (state.error) card.appendChild(node('div', 'error', [state.error]));
    app.replaceChildren(card);
  }

  function render() {
    if (!state.pinOk) return renderPinGate();
    if (!state.token || !state.user) return renderPinGate();
    app.className = `layout ${state.view === 'thread' ? 'thread-mode' : 'list-mode'}`;

    const sidebar = node('aside', 'sidebar');
    const head = node('div', 'side-head', [
      node('div', 'brand', ['Support']),
      node('div', 'sub', [`@${state.user.nickname || state.user.username || 'operator'} / ${state.user.role || state.user.admin_role || 'support'}`]),
    ]);
    const metrics = node('div', 'metrics', [
      metric('Ochiq', state.stats?.open),
      metric('Yangi', state.stats?.unread_staff),
      metric('Javob', state.stats?.answered),
      metric('Urgent', state.stats?.urgent),
    ]);
    head.appendChild(metrics);
    const filters = node('div', 'filters');
    const search = node('input', 'field');
    search.placeholder = '@nickname yoki mavzu';
    search.value = state.q;
    search.oninput = debounce((e) => { state.q = e.target.value.trim(); loadList(true); }, 350);
    const select = node('select', 'field');
    ['open', 'pending', 'answered', 'closed', 'all'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = statusLabel(value);
      option.selected = state.status === value;
      select.appendChild(option);
    });
    select.onchange = (e) => { state.status = e.target.value; loadList(true); };
    const logout = node('button', 'btn secondary', ['Chiqish']);
    logout.onclick = () => {
      clearSession();
      render();
    };
    filters.append(search, select, logout);
    const list = node('div', 'ticket-list');
    if (!state.tickets.length) list.appendChild(node('div', 'empty', ['Ticket yoq']));
    state.tickets.forEach((ticket) => list.appendChild(ticketButton(ticket)));
    sidebar.append(head, filters, list);

    const main = node('section', 'main');
    if (!state.selected) {
      main.appendChild(node('div', 'empty', ['Ticket tanlang']));
    } else {
      main.append(header(), thread(), composer());
    }

    app.replaceChildren(sidebar, main);
  }

  function metric(label, value) {
    return node('div', 'metric', [node('b', '', [fmt(value)]), node('span', '', [label])]);
  }

  function ticketButton(ticket) {
    const btn = node('button', `ticket ${state.selected?.id === ticket.id ? 'active' : ''}`);
    btn.type = 'button';
    const pillClass = ticket.status === 'closed' ? 'pill red' : ticket.status === 'answered' ? 'pill green' : 'pill';
    btn.append(
      node('div', 'ticket-title', [node('span', '', [ticket.subject]), node('span', pillClass, [statusLabel(ticket.status)])]),
      node('div', 'preview', [ticket.lastMessage || 'Javob kutilmoqda']),
      node('div', 'meta', [`@${ticket.nickname || ticket.username || 'user'} / ${priorityLabel(ticket.priority)} / ${date(ticket.lastMessageAt)}`]),
    );
    if (Number(ticket.unreadByStaff || 0) > 0) {
      btn.appendChild(node('div', 'pill red', [`${ticket.unreadByStaff} yangi`]));
    }
    btn.onclick = () => loadTicket(ticket.id);
    return btn;
  }

  function header() {
    const wrap = node('div', 'topbar');
    const back = node('button', 'mobile-back btn secondary', ['Orqaga']);
    back.type = 'button';
    back.onclick = () => {
      state.view = 'list';
      render();
    };
    const title = node('div', 'brand', [state.selected.subject]);
    const meta = node('div', 'sub', [
      `@${state.selected.nickname || state.selected.username || 'user'} / ${state.selected.email || 'email yoq'} / ${date(state.selected.createdAt)}`,
    ]);
    const controls = node('div', 'composer-actions');
    const status = node('select', 'field');
    status.style.maxWidth = '190px';
    ['open', 'pending', 'answered', 'closed'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = statusLabel(value);
      option.selected = state.selected.status === value;
      status.appendChild(option);
    });
    status.onchange = () => updateSelected({ status: status.value });
    const priority = node('select', 'field');
    priority.style.maxWidth = '190px';
    ['low', 'normal', 'high', 'urgent'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = priorityLabel(value);
      option.selected = state.selected.priority === value;
      priority.appendChild(option);
    });
    priority.onchange = () => updateSelected({ priority: priority.value });
    const assign = node('button', 'btn secondary', ['Menga olish']);
    assign.onclick = assignSelected;
    controls.append(status, priority, assign);
    wrap.append(back, title, meta, controls);
    return wrap;
  }

  function thread() {
    const box = node('div', 'thread');
    state.messages.forEach((message) => {
      const staff = message.senderRole !== 'user';
      const attachment = imageAttachment(message);
      const card = node('div', `message ${staff ? 'staff' : ''} ${message.isInternal ? 'internal' : ''}`);
      card.append(
        node('div', 'message-head', [message.isInternal ? 'Ichki izoh' : staff ? 'Support' : (message.senderName || 'User'), ' / ', date(message.createdAt)]),
        document.createTextNode(message.body),
      );
      if (attachment) card.appendChild(messageImageNode(attachment));
      box.appendChild(card);
    });
    setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
    return box;
  }

  function composer() {
    const ticketId = state.selected?.id;
    const draft = ticketDraft(ticketId);
    const wrap = node('div', 'composer');
    const text = node('textarea', 'field');
    text.placeholder = 'Javob yozing';
    text.value = draft.body || '';
    text.oninput = () => {
      saveTicketDraft(ticketId, { body: text.value });
      send.disabled = !text.value.trim();
    };
    const row = node('div', 'composer-actions');
    const label = node('label', 'sub');
    const internal = document.createElement('input');
    internal.type = 'checkbox';
    internal.checked = !!draft.internal;
    internal.onchange = () => saveTicketDraft(ticketId, { internal: internal.checked, body: text.value });
    internal.style.marginRight = '8px';
    label.append(internal, 'Ichki izoh');
    const send = node('button', 'btn', ['Javob yuborish']);
    send.disabled = !text.value.trim();
    send.onclick = async () => {
      const body = text.value.trim();
      if (!body) return;
      send.disabled = true;
      try {
        const data = await api.reply(ticketId, body, internal.checked);
        state.selected = data.ticket;
        state.messages = data.messages || [];
        clearTicketDraft(ticketId);
        text.value = '';
        await loadList(true);
      } catch (err) {
        alert(err.message);
      } finally {
        send.disabled = false;
      }
    };
    row.append(label, send);
    wrap.append(text, row);
    return wrap;
  }

  async function bootstrap() {
    if (!state.pinOk) return renderPinGate();
    if (!state.token) {
      clearSession();
      return renderPinGate();
    }
    try {
      const me = await api.me();
      state.user = me;
      const role = me.role || me.admin_role || '';
      if (!me.permissions?.includes('*') && !me.permissions?.includes('support.manage') && role !== 'support') {
        throw new Error('support permission kerak');
      }
      await loadList(true);
    } catch (err) {
      state.error = err.message || 'Kirish xato';
      clearSession();
      render();
    }
  }

  async function loadList(silent) {
    try {
      const holdComposer = silent && shouldHoldComposer();
      const [stats, list] = await Promise.all([api.stats(), api.tickets()]);
      state.stats = stats;
      state.tickets = list.tickets || [];
      if (!state.selected && state.tickets[0] && !isMobile()) await loadTicket(state.tickets[0].id, true);
      if (state.selected) {
        const fresh = state.tickets.find((ticket) => ticket.id === state.selected.id);
        if (fresh) state.selected = fresh;
      }
      if (!holdComposer) render();
    } catch (err) {
      if (!silent) setError(err.message);
    }
  }

  async function loadTicket(id, silent) {
    try {
      const holdComposer = silent && String(id) === String(state.selected?.id || '') && shouldHoldComposer();
      const data = await api.ticket(id);
      state.selected = data.ticket;
      state.messages = data.messages || [];
      state.view = 'thread';
      if (!holdComposer) render();
    } catch (err) {
      if (!silent) alert(err.message);
    }
  }

  async function updateSelected(data) {
    if (!state.selected) return;
    try {
      const res = await api.status(state.selected.id, data);
      state.selected = res.ticket;
      await loadList(true);
    } catch (err) {
      alert(err.message);
    }
  }

  async function assignSelected() {
    if (!state.selected) return;
    try {
      const res = await api.assign(state.selected.id);
      state.selected = res.ticket;
      await loadList(true);
    } catch (err) {
      alert(err.message);
    }
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function isFormFieldActive() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function isComposerActive() {
    return !!document.activeElement?.closest?.('.composer');
  }

  function shouldHoldComposer() {
    return isComposerActive() || (Date.now() - state.lastComposeAt < 2500);
  }

  let lastMobileLayout = isMobile();

  setInterval(() => {
    if (document.hidden) return;
    if (state.pinOk && state.token && state.user) {
      loadList(true);
      if (state.selected?.id) loadTicket(state.selected.id, true);
    }
  }, 5000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.pinOk || !state.token || !state.user) return;
    loadList(true);
    if (state.selected?.id) loadTicket(state.selected.id, true);
  });

  window.addEventListener('resize', debounce(() => {
    const mobile = isMobile();
    if (mobile === lastMobileLayout && isFormFieldActive()) return;
    lastMobileLayout = mobile;
    if (!state.pinOk || !state.token || !state.user) return;
    if (!mobile) state.view = 'thread';
    if (mobile && !state.selected) state.view = 'list';
    render();
  }, 150));

  bootstrap();
})();
