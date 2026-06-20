import { api, getToken } from './api.js';
import { state, toast } from './state.js';

const POLL_MS = 6000;
const MAX_IMAGE_DATA_URL = 920000;
let root = null;
let panel = null;
let badge = null;
let body = null;
let open = false;
let viewMode = 'list';
let activeTicketId = '';
let tickets = [];
let messages = [];
let pollTimer = null;
let booted = false;
let lastReplyInputAt = 0;
const createDraft = {
  category: 'game',
  subject: '',
  body: '',
  attachment: null,
};
const replyDraft = {
  body: '',
  attachment: null,
};

function text(value) {
  return String(value ?? '');
}

function el(tag, className = '', children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(text(child)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function statusLabel(status) {
  return {
    open: 'Ochiq',
    pending: 'Kutilmoqda',
    answered: 'Javob berildi',
    closed: 'Yopilgan',
  }[status] || status || 'Ochiq';
}

function categoryLabel(category) {
  return {
    game: "O'yin",
    payment: "To'lov",
    account: 'Akkaunt',
    technical: 'Texnik',
    abuse: 'Shikoyat',
    other: 'Boshqa',
  }[category] || category || "O'yin";
}

function ticketSubject(rawSubject, rawBody, category) {
  const direct = text(rawSubject).replace(/\s+/g, ' ').trim();
  if (direct.length >= 3) return direct.slice(0, 140);
  const fromBody = text(rawBody).replace(/\s+/g, ' ').trim();
  if (fromBody.length >= 3) return fromBody.slice(0, 80);
  return `${categoryLabel(category)} ticket`.slice(0, 140);
}

function attachmentFromMessage(item) {
  const attachment = item?.metadata?.attachment;
  if (!attachment || attachment.type !== 'image' || !attachment.dataUrl) return null;
  return attachment;
}

function attachmentText(attachment) {
  if (!attachment) return '';
  const sizeKb = attachment.size ? ` / ${Math.max(1, Math.round(attachment.size / 1024))} KB` : '';
  return `${attachment.name || 'rasm'}${sizeKb}`;
}

function supportErrorMessage(err, fallback) {
  if (err?.status === 0) return "Server bilan aloqa yo'q. Internetni tekshiring yoki ilovani qayta oching.";
  if (err?.status === 400) {
    if (err.message === 'message required') return 'Xabar yozing yoki rasm biriktiring.';
    if (err.message === 'invalid image') return 'Rasm formati notogri. PNG, JPG yoki WEBP yuboring.';
    return 'Malumotlarni toliq kiriting.';
  }
  if (err?.status === 401) return 'Sessiya tugagan. Qayta kiring.';
  if (err?.status === 413) return 'Rasm hajmi katta. Kichikroq screenshot yuboring.';
  if (err?.status >= 500) return 'Server vaqtincha javob bermadi. Birozdan keyin qayta urining.';
  return err?.message || fallback;
}

function telegramSupportContext() {
  const tg = window.__DURAK_TELEGRAM_WEBAPP__;
  const tgState = window.__DURAK_TELEGRAM_WEBAPP_STATE__;
  if (!tg || !tgState?.enabled) return null;
  return {
    enabled: true,
    platform: tgState.platform || tg.platform || 'unknown',
    version: tgState.version || tg.version || 'unknown',
    initData: typeof tg.initData === 'string' ? tg.initData : '',
  };
}

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Rasm oqilmadi'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Rasm ochilmadi'));
    img.src = dataUrl;
  });
}

async function prepareImageAttachment(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('Faqat rasm fayl yuborish mumkin');
  }
  const original = await readFileDataUrl(file);
  const img = await loadImage(original);
  const render = (maxSide, quality) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };
  let dataUrl = render(1280, 0.78);
  if (dataUrl.length > MAX_IMAGE_DATA_URL) dataUrl = render(960, 0.66);
  if (dataUrl.length > MAX_IMAGE_DATA_URL) dataUrl = render(760, 0.58);
  if (dataUrl.length > MAX_IMAGE_DATA_URL) throw new Error('Rasm hajmi katta. Kichikroq screenshot yuboring.');
  return {
    type: 'image',
    name: String(file.name || 'screenshot.jpg').slice(0, 90),
    mime: 'image/jpeg',
    size: Math.round((dataUrl.length * 3) / 4),
    dataUrl,
  };
}

function imagePreview(attachment, onRemove) {
  const wrap = el('div', 'support-attachment-preview');
  const img = document.createElement('img');
  img.src = attachment.dataUrl;
  img.alt = attachment.name || 'Support rasmi';
  const meta = el('div', '', [
    el('b', '', ['Rasm biriktirildi']),
    el('small', '', [attachmentText(attachment)]),
  ]);
  const remove = el('button', 'support-attach-remove', ['X']);
  remove.type = 'button';
  remove.addEventListener('click', onRemove);
  wrap.append(img, meta, remove);
  return wrap;
}

function messageImage(attachment) {
  if (!attachment) return null;
  const link = document.createElement('a');
  link.className = 'support-message-image';
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

function attachButton(label, onPick) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.hidden = true;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      onPick(await prepareImageAttachment(file));
    } catch (err) {
      toast(err.message || 'Rasm qoshilmadi', 'error');
    }
  });
  const btn = el('button', 'support-btn secondary support-attach-btn', [label]);
  btn.type = 'button';
  btn.addEventListener('click', () => input.click());
  const wrap = el('div', 'support-attach-wrap', [btn, input]);
  return wrap;
}

function injectStyles() {
  if (document.getElementById('support-widget-css')) return;
  const style = document.createElement('style');
  style.id = 'support-widget-css';
  style.textContent = `
    .support-widget-root{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:calc(24px + env(safe-area-inset-bottom));z-index:9500;font-family:Inter,system-ui,sans-serif;color:#fff}
    .support-widget-root.hidden{display:none}
    .support-fab{position:relative;display:grid;place-items:center;width:58px;height:58px;border-radius:19px;border:1px solid rgba(255,226,141,.92);background:linear-gradient(145deg,#fff0aa 0%,#a86616 48%,#2b1706 100%);box-shadow:0 18px 42px rgba(0,0,0,.52),0 0 28px rgba(226,177,59,.22),inset 0 2px 0 rgba(255,255,255,.42),inset 0 -14px 20px rgba(0,0,0,.32);color:#1c1005;font-size:24px;font-weight:1000;text-shadow:0 1px 0 rgba(255,255,255,.3);cursor:pointer}
    .support-fab:active{transform:translateY(1px) scale(.98)}
    .support-badge{position:absolute;right:-5px;top:-6px;min-width:21px;height:21px;padding:0 6px;border-radius:999px;background:#e11d48;color:#fff;border:2px solid #160d05;display:none;align-items:center;justify-content:center;font-size:11px;font-weight:1000}
    .support-panel{position:absolute;right:0;bottom:70px;width:min(388px,calc(100vw - 24px));max-height:min(690px,calc(100vh - 112px));display:none;overflow:hidden;border:1px solid rgba(255,220,139,.55);border-radius:22px;background:linear-gradient(180deg,rgba(28,25,20,.985),rgba(7,9,13,.985));box-shadow:0 30px 90px rgba(0,0,0,.72),0 0 0 1px rgba(0,0,0,.66),inset 0 1px 0 rgba(255,255,255,.12)}
    .support-panel.open{display:flex;flex-direction:column}
    .support-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 16px;border-bottom:1px solid rgba(226,177,59,.25);background:radial-gradient(circle at 12% 0,rgba(255,224,141,.22),transparent 36%),linear-gradient(90deg,rgba(226,177,59,.13),rgba(255,255,255,.025))}
    .support-title{font-weight:1000;letter-spacing:.02em;color:#ffe7a1}
    .support-sub{font-size:11px;font-weight:800;color:#a7f3d0}
    .support-close{width:36px;height:36px;border-radius:13px;border:1px solid rgba(226,177,59,.36);background:rgba(255,255,255,.055);color:#fff;font-weight:1000;cursor:pointer}
    .support-body{min-height:300px;overflow:auto;padding:13px;background:radial-gradient(circle at 18% 0,rgba(226,177,59,.13),transparent 36%),linear-gradient(180deg,rgba(255,255,255,.018),transparent 42%)}
    .support-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
    .support-btn{min-height:40px;border-radius:13px;border:1px solid rgba(255,226,141,.54);background:linear-gradient(180deg,#d9972c,#6b3a0d 70%,#2c1705);box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 10px 22px rgba(0,0,0,.28);color:#fff7d1;font-weight:1000;padding:0 14px;cursor:pointer}
    .support-btn.secondary{background:rgba(255,255,255,.045);color:#fff;border-color:rgba(255,255,255,.12)}
    .support-btn.danger{background:linear-gradient(180deg,#8b1e35,#50101f);border-color:rgba(255,135,158,.45)}
    .support-ticket{width:100%;text-align:left;border:1px solid rgba(226,177,59,.25);border-radius:17px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.24));padding:12px;margin-bottom:10px;color:#fff;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 12px 24px rgba(0,0,0,.18)}
    .support-ticket.active,.support-ticket:hover{border-color:rgba(255,226,141,.72);background:linear-gradient(180deg,rgba(226,177,59,.14),rgba(0,0,0,.2))}
    .support-ticket-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .support-ticket-title{font-size:13px;font-weight:1000;color:#fff4c9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .support-pill{display:inline-flex;align-items:center;justify-content:center;min-height:22px;border-radius:999px;border:1px solid rgba(226,177,59,.35);background:rgba(226,177,59,.1);padding:0 8px;font-size:10px;font-weight:1000;color:#ffe7a1;text-transform:uppercase}
    .support-pill.green{border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.12);color:#bbf7d0}
    .support-pill.red{border-color:rgba(244,63,94,.4);background:rgba(244,63,94,.14);color:#fecdd3}
    .support-muted{font-size:11px;color:#a8a29e;font-weight:700}
    .support-preview{margin-top:7px;color:#d6d3d1;font-size:12px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .support-ticket-open{margin-top:9px;display:flex;align-items:center;justify-content:space-between;color:#ffe7a1;font-size:11px;font-weight:1000;text-transform:uppercase}
    .support-form{display:grid;gap:9px}
    .support-input,.support-select,.support-textarea{width:100%;border-radius:13px;border:1px solid rgba(226,177,59,.28);background:#080b10;color:#fff;padding:11px 12px;font:inherit;font-size:14px;outline:none}
    .support-input:focus,.support-select:focus,.support-textarea:focus{border-color:#e2b13b;box-shadow:0 0 0 3px rgba(226,177,59,.12)}
    .support-textarea{min-height:104px;resize:vertical}
    .support-thread{display:flex;flex-direction:column;gap:9px}
    .support-message{max-width:88%;border:1px solid rgba(255,255,255,.1);border-radius:17px;padding:10px 11px;background:rgba(255,255,255,.055);line-height:1.4;font-size:13px;white-space:pre-wrap;box-shadow:0 10px 22px rgba(0,0,0,.18)}
    .support-message.user{align-self:flex-end;border-color:rgba(226,177,59,.35);background:linear-gradient(180deg,rgba(158,104,24,.55),rgba(72,42,9,.58))}
    .support-message.staff{align-self:flex-start;border-color:rgba(59,130,246,.28);background:rgba(15,23,42,.75)}
    .support-message-name{margin-bottom:4px;font-size:10px;text-transform:uppercase;font-weight:1000;color:#ffe7a1}
    .support-message-image{display:block;margin-top:8px;border-radius:14px;overflow:hidden;border:1px solid rgba(255,226,141,.28);background:#050505}
    .support-message-image img{display:block;max-width:100%;max-height:220px;object-fit:contain}
    .support-attach-wrap{display:flex}
    .support-attach-btn{width:100%;justify-content:center}
    .support-attachment-preview{display:grid;grid-template-columns:58px minmax(0,1fr) 32px;align-items:center;gap:10px;padding:8px;border:1px solid rgba(226,177,59,.26);border-radius:15px;background:rgba(255,255,255,.045)}
    .support-attachment-preview img{width:58px;height:48px;object-fit:cover;border-radius:11px;border:1px solid rgba(255,255,255,.12)}
    .support-attachment-preview b{display:block;color:#ffe7a1;font-size:12px}
    .support-attachment-preview small{display:block;color:#a8a29e;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .support-attach-remove{width:30px;height:30px;border-radius:10px;border:1px solid rgba(244,63,94,.32);background:rgba(244,63,94,.1);color:#fecdd3;font-weight:1000}
    .support-empty{display:grid;place-items:center;min-height:210px;text-align:center;color:#d6d3d1;font-weight:800}
    .support-login-needed{display:grid;gap:10px;align-content:center;min-height:220px;text-align:center}
    .support-login-needed strong{font-size:18px;color:#ffe7a1}
    .support-login-needed p{margin:0;color:#d6d3d1;font-weight:750;line-height:1.45}
    @media (max-width:520px){
      .support-widget-root{right:12px;bottom:calc(84px + env(safe-area-inset-bottom))}
      .support-panel{right:-2px;width:calc(100vw - 20px);max-height:calc(100vh - 94px);bottom:62px;border-radius:16px}
      .support-body{max-height:calc(100vh - 180px)}
    }
    @media (max-width:760px){
      .support-widget-root:not(.panel-open){display:none!important}
      .support-widget-root.panel-open{left:0!important;right:0!important;bottom:0!important;display:block!important}
      .support-widget-root.panel-open .support-fab{display:none!important}
      .support-widget-root.panel-open .support-panel{position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));width:auto;max-height:calc(100dvh - 24px - env(safe-area-inset-top));border-radius:18px}
      .support-widget-root.panel-open .support-body{max-height:calc(100dvh - 164px - env(safe-area-inset-top) - env(safe-area-inset-bottom))}
    }
  `;
  document.head.appendChild(style);
}

function updateVisibility() {
  if (!root) return;
  const loggedIn = !!(state.user && getToken());
  const onLoginScreen = !!document.querySelector('.royal-login-screen');
  const compactScreen = window.matchMedia?.('(max-width: 760px)').matches;
  const hideClosedFab = compactScreen && !open;
  root.classList.toggle('panel-open', open);
  root.classList.toggle('hidden', (!loggedIn && !open) || (onLoginScreen && !open) || hideClosedFab);
  if (!loggedIn && open && viewMode !== 'login') renderLoginNeeded();
}

function updateBadge() {
  if (!badge) return;
  const unread = tickets.reduce((sum, item) => sum + Number(item.unreadByUser || 0), 0);
  badge.style.display = unread > 0 ? 'flex' : 'none';
  badge.textContent = String(Math.min(unread, 99));
}

async function loadTickets({ silent = false } = {}) {
  if (!state.user || !getToken()) return;
  try {
    const data = await api.supportTickets();
    tickets = Array.isArray(data?.tickets) ? data.tickets : [];
    updateBadge();
    if (open && viewMode === 'list') renderList();
  } catch (err) {
    if (!silent) toast(err.message || 'Support yuklanmadi', 'error');
  }
}

async function loadTicket(id, { silent = false } = {}) {
  if (!id) return;
  try {
    const holdReplyComposer = silent && shouldHoldReplyComposer(id);
    if (activeTicketId && activeTicketId !== id) {
      replyDraft.body = '';
      replyDraft.attachment = null;
    }
    const data = await api.supportTicket(id);
    activeTicketId = id;
    messages = Array.isArray(data?.messages) ? data.messages : [];
    const idx = tickets.findIndex((item) => item.id === id);
    if (idx >= 0 && data?.ticket) tickets[idx] = data.ticket;
    else if (data?.ticket) tickets.unshift(data.ticket);
    updateBadge();
    if (open && viewMode === 'thread' && activeTicketId === id && !holdReplyComposer) renderThread(data.ticket);
  } catch (err) {
    if (!silent) toast(err.message || 'Ticket yuklanmadi', 'error');
  }
}

function renderShell() {
  clear(root);
  const button = el('button', 'support-fab', ['?']);
  button.type = 'button';
  button.title = 'Support';
  badge = el('span', 'support-badge', ['0']);
  button.appendChild(badge);
  button.addEventListener('click', () => togglePanel(!open));

  panel = el('section', 'support-panel');
  const head = el('div', 'support-head', [
    el('div', '', [
      el('div', 'support-title', ['Yordam markazi']),
      el('div', 'support-sub', ['Support online']),
    ]),
  ]);
  const close = el('button', 'support-close', ['X']);
  close.type = 'button';
  close.addEventListener('click', () => togglePanel(false));
  head.appendChild(close);
  body = el('div', 'support-body');
  panel.append(head, body);
  root.append(panel, button);
}

function renderList() {
  if (!body) return;
  viewMode = 'list';
  activeTicketId = '';
  clear(body);
  const top = el('div', 'support-row');
  const title = el('div', '', [
    el('div', 'support-title', ['Ticketlar']),
    el('div', 'support-muted', ['Muammo yozing yoki javobni kuzating']),
  ]);
  const create = el('button', 'support-btn', ['Yangi']);
  create.type = 'button';
  create.addEventListener('click', renderCreate);
  top.append(title, create);
  body.appendChild(top);

  if (!tickets.length) {
    const empty = el('div', 'support-empty', ['Hali ticket yoq. Muammo boisa yangi ticket oching.']);
    body.appendChild(empty);
    return;
  }
  for (const item of tickets) {
    const btn = el('button', `support-ticket ${item.id === activeTicketId ? 'active' : ''}`);
    btn.type = 'button';
    const dateText = new Date(item.lastMessageAt || item.createdAt).toLocaleString();
    btn.append(
      el('div', 'support-ticket-top', [
        el('div', 'support-ticket-title', [item.subject]),
        el('span', `support-pill ${item.status === 'answered' ? 'green' : item.status === 'closed' ? 'red' : ''}`, [statusLabel(item.status)]),
      ]),
      el('div', 'support-muted', [`${categoryLabel(item.category)} / ${dateText}`]),
      el('div', 'support-preview', [item.lastMessage || 'Javob kutilmoqda']),
      el('div', 'support-ticket-open', [
        el('span', '', ['Chatni ochish']),
        el('span', '', ['>']),
      ]),
    );
    btn.addEventListener('click', () => loadTicket(item.id));
    body.appendChild(btn);
  }
}

function renderCreate() {
  viewMode = 'create';
  activeTicketId = '';
  clear(body);
  const back = el('button', 'support-btn secondary', ['Orqaga']);
  back.type = 'button';
  back.addEventListener('click', renderList);
  const subject = el('input', 'support-input');
  subject.placeholder = 'Qisqa mavzu (ixtiyoriy)';
  subject.maxLength = 140;
  subject.value = createDraft.subject;
  const category = el('select', 'support-select');
  for (const [value, label] of [
    ['game', "O'yin muammosi"],
    ['payment', "To'lov va coin"],
    ['account', 'Akkaunt'],
    ['technical', 'Texnik xato'],
    ['abuse', 'Shikoyat'],
    ['other', 'Boshqa'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    category.appendChild(option);
  }
  category.value = createDraft.category;
  const msg = el('textarea', 'support-textarea');
  msg.placeholder = 'Muammoni batafsil yozing';
  msg.value = createDraft.body;
  category.addEventListener('change', () => { createDraft.category = category.value; });
  subject.addEventListener('input', () => { createDraft.subject = subject.value; });
  msg.addEventListener('input', () => { createDraft.body = msg.value; });
  const imageControl = createDraft.attachment
    ? imagePreview(createDraft.attachment, () => { createDraft.attachment = null; renderCreate(); })
    : attachButton('Rasm yoki screenshot qoshish', (attachment) => { createDraft.attachment = attachment; renderCreate(); });
  const send = el('button', 'support-btn', ['Yuborish']);
  send.type = 'button';
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      const data = await api.supportCreateTicket({
        subject: ticketSubject(subject.value, msg.value, category.value),
        category: category.value,
        body: msg.value,
        attachment: createDraft.attachment,
        context: {
          route: location.hash || '/',
          url: location.href,
          userAgent: navigator.userAgent,
          width: window.innerWidth,
          height: window.innerHeight,
          telegram: telegramSupportContext(),
        },
      });
      if (data?.ticket) {
        tickets.unshift(data.ticket);
        createDraft.category = 'game';
        createDraft.subject = '';
        createDraft.body = '';
        createDraft.attachment = null;
        toast('Ticket yuborildi', 'success');
        viewMode = 'thread';
        await loadTicket(data.ticket.id, { silent: true });
      } else {
        await loadTickets({ silent: true });
        renderList();
      }
    } catch (err) {
      toast(supportErrorMessage(err, 'Yuborilmadi'), 'error');
    } finally {
      send.disabled = false;
    }
  });

  body.append(
    el('div', 'support-row', [
      el('div', '', [
        el('div', 'support-title', ['Yangi ticket']),
        el('div', 'support-muted', ['Support javobi shu oynada chiqadi']),
      ]),
      back,
    ]),
    el('div', 'support-form', [category, subject, msg, imageControl, send]),
  );
}

function renderThread(ticket) {
  viewMode = 'thread';
  clear(body);
  const header = el('div', 'support-row');
  const back = el('button', 'support-btn secondary', ['Orqaga']);
  back.type = 'button';
  back.addEventListener('click', () => {
    activeTicketId = '';
    messages = [];
    replyDraft.body = '';
    replyDraft.attachment = null;
    renderList();
  });
  header.append(
    el('div', '', [
      el('div', 'support-title', [ticket?.subject || 'Ticket']),
      el('div', 'support-muted', [`${categoryLabel(ticket?.category)} / ${statusLabel(ticket?.status)}`]),
    ]),
    back,
  );
  const thread = el('div', 'support-thread');
  for (const item of messages) {
    const isUser = item.senderRole === 'user';
    const attachment = attachmentFromMessage(item);
    const card = el('div', `support-message ${isUser ? 'user' : 'staff'}`, [
      el('div', 'support-message-name', [isUser ? 'Siz' : 'Support']),
    ]);
    if (item.body) card.append(document.createTextNode(item.body));
    const image = messageImage(attachment);
    if (image) card.appendChild(image);
    thread.appendChild(card);
  }
  const reply = el('textarea', 'support-textarea');
  reply.placeholder = ticket?.status === 'closed' ? 'Yangi xabar yozsangiz ticket qayta ochiladi' : 'Javob yozing';
  reply.style.minHeight = '76px';
  reply.value = replyDraft.body;
  reply.addEventListener('input', () => {
    replyDraft.body = reply.value;
    lastReplyInputAt = Date.now();
  });
  const replyImageControl = replyDraft.attachment
    ? imagePreview(replyDraft.attachment, () => { replyDraft.attachment = null; renderThread(ticket); })
    : attachButton('Rasm qoshish', (attachment) => { replyDraft.attachment = attachment; renderThread(ticket); });
  const send = el('button', 'support-btn', ['Javob yuborish']);
  send.type = 'button';
  send.addEventListener('click', async () => {
    const value = reply.value.trim();
    if (!value && !replyDraft.attachment) return;
    send.disabled = true;
    try {
      const data = await api.supportReply(activeTicketId, { body: value, attachment: replyDraft.attachment });
      messages = Array.isArray(data?.messages) ? data.messages : messages;
      if (data?.ticket) {
        const idx = tickets.findIndex((x) => x.id === data.ticket.id);
        if (idx >= 0) tickets[idx] = data.ticket;
      }
      reply.value = '';
      replyDraft.body = '';
      replyDraft.attachment = null;
      renderThread(data?.ticket || ticket);
    } catch (err) {
      toast(supportErrorMessage(err, 'Javob yuborilmadi'), 'error');
    } finally {
      send.disabled = false;
    }
  });
  const close = el('button', 'support-btn danger', ['Yopish']);
  close.type = 'button';
  close.addEventListener('click', async () => {
    close.disabled = true;
    try {
      const data = await api.supportClose(activeTicketId);
      if (data?.ticket) {
        const idx = tickets.findIndex((x) => x.id === data.ticket.id);
        if (idx >= 0) tickets[idx] = data.ticket;
        renderThread(data.ticket);
      }
    } catch (err) {
      toast(err.message || 'Yopilmadi', 'error');
    } finally {
      close.disabled = false;
    }
  });

  body.append(header, thread, el('div', 'support-form', [reply, replyImageControl, el('div', 'support-row', [send, close])]));
  body.scrollTop = body.scrollHeight;
}

function shouldHoldReplyComposer(id) {
  if (!open || viewMode !== 'thread' || String(activeTicketId || '') !== String(id || '')) return false;
  const active = document.activeElement;
  const inReplyForm = !!active?.closest?.('.support-form');
  return inReplyForm || (Date.now() - lastReplyInputAt < 2500);
}

function togglePanel(next) {
  open = !!next;
  if (!panel) return;
  root?.classList.toggle('panel-open', open);
  updateVisibility();
  panel.classList.toggle('open', open);
  if (open) {
    if (!state.user || !getToken()) {
      renderLoginNeeded();
      return;
    }
    if (viewMode === 'create') {
      renderCreate();
      loadTickets({ silent: true });
    } else if (activeTicketId) {
      viewMode = 'thread';
      loadTicket(activeTicketId, { silent: true });
    } else {
      viewMode = 'list';
      loadTickets({ silent: true }).then(() => {
        if (open && viewMode === 'list') renderList();
      });
    }
  }
}

function renderLoginNeeded() {
  if (!body) return;
  viewMode = 'login';
  activeTicketId = '';
  clear(body);
  body.appendChild(el('div', 'support-login-needed', [
    el('strong', '', ['Supportga yozish']),
    el('p', '', ['Ticket yuborish uchun akkauntga kiring. Kirganingizdan keyin shu oyna orqali muammoni yozasiz va javob shu yerda chiqadi.']),
  ]));
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    updateVisibility();
    if (!state.user || !getToken()) return;
    if (open && activeTicketId) await loadTicket(activeTicketId, { silent: true });
    else await loadTickets({ silent: true });
  }, POLL_MS);
}

export function initSupportWidget() {
  if (booted || typeof document === 'undefined') return;
  booted = true;
  injectStyles();
  root = document.createElement('div');
  root.className = 'support-widget-root hidden';
  document.body.appendChild(root);
  renderShell();
  updateVisibility();
  loadTickets({ silent: true });
  startPolling();
  window.DurakSupport = {
    open: () => openSupportWidget(),
    newTicket: () => openSupportWidget({ create: true }),
  };
  window.addEventListener('durak:support:new-ticket', () => openSupportWidget({ create: true }));
  window.addEventListener('hashchange', updateVisibility);
}

export function refreshSupportWidget() {
  updateVisibility();
  loadTickets({ silent: true });
}

export function openSupportWidget(options = {}) {
  if (!booted) initSupportWidget();
  updateVisibility();
  if (options.create) viewMode = 'create';
  togglePanel(true);
  if (options.create && state.user && getToken()) renderCreate();
}
