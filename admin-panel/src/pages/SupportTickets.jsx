import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';

const SUPPORT_DRAFT_KEY = 'durak.admin.supportDrafts.v1';

const statusLabels = {
  all: 'Hammasi',
  open: 'Ochiq',
  pending: 'Kutilmoqda',
  answered: 'Javob berilgan',
  closed: 'Yopilgan',
};

const priorityLabels = {
  low: 'Past',
  normal: 'Oddiy',
  high: 'Muhim',
  urgent: 'Shoshilinch',
};

function fmtDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('ru-RU');
}

function imageAttachment(message) {
  const attachment = message?.metadata?.attachment;
  if (!attachment || attachment.type !== 'image' || !attachment.dataUrl) return null;
  return attachment;
}

function readDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SUPPORT_DRAFT_KEY) || '');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeDrafts(value) {
  try {
    localStorage.setItem(SUPPORT_DRAFT_KEY, JSON.stringify(value));
  } catch {
    // Private browsing can block storage; React state still keeps the current draft.
  }
}

export default function SupportTickets() {
  const [stats, setStats] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [loading, setLoading] = useState(false);
  const draftsRef = useRef(readDrafts());
  const toast = useToast();

  const selectedId = selected?.id || '';

  function saveDraft(ticketId, patch) {
    if (!ticketId) return;
    const key = String(ticketId);
    const current = draftsRef.current[key] || { body: '', internal: false };
    const next = { ...draftsRef.current, [key]: { ...current, ...patch } };
    draftsRef.current = next;
    writeDrafts(next);
  }

  function clearDraft(ticketId) {
    if (!ticketId) return;
    const key = String(ticketId);
    if (!draftsRef.current[key]) return;
    const next = { ...draftsRef.current };
    delete next[key];
    draftsRef.current = next;
    writeDrafts(next);
  }

  async function loadList({ silent = false } = {}) {
    try {
      const [s, list] = await Promise.all([
        api.supportStats(),
        api.supportTickets({ status: status === 'all' ? '' : status, q, limit: 80 }),
      ]);
      setStats(s);
      const rows = Array.isArray(list?.tickets) ? list.tickets : [];
      setTickets(rows);
      if (!selectedId && rows[0]) loadTicket(rows[0].id, { silent: true });
      if (selectedId) {
        const fresh = rows.find((item) => item.id === selectedId);
        if (fresh) setSelected(fresh);
      }
    } catch (err) {
      if (!silent) toast.error(err.message);
    }
  }

  async function loadTicket(id, { silent = false } = {}) {
    if (!id) return;
    try {
      const data = await api.supportTicket(id);
      setSelected(data.ticket);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (err) {
      if (!silent) toast.error(err.message);
    }
  }

  useEffect(() => {
    let alive = true;
    const run = async (silent = false) => {
      if (!alive) return;
      await loadList({ silent });
      if (selectedId) await loadTicket(selectedId, { silent: true });
    };
    run();
    const timer = setInterval(() => run(true), 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [status, q, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setReply('');
      setInternal(false);
      return;
    }
    const draft = draftsRef.current[String(selectedId)] || {};
    setReply(draft.body || '');
    setInternal(!!draft.internal);
  }, [selectedId]);

  async function sendReply() {
    const body = reply.trim();
    if (!selectedId || !body) return;
    setLoading(true);
    try {
      const data = await api.supportReply(selectedId, { body, internal });
      clearDraft(selectedId);
      setReply('');
      setInternal(false);
      setSelected(data.ticket);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      toast.success(internal ? 'Ichki izoh saqlandi' : 'Javob yuborildi');
      loadList({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateTicket(next) {
    if (!selectedId) return;
    setLoading(true);
    try {
      const data = await api.supportStatus(selectedId, next);
      setSelected(data.ticket);
      toast.success("Ticket yangilandi");
      loadList({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function assignToMe() {
    if (!selectedId) return;
    setLoading(true);
    try {
      const data = await api.supportAssign(selectedId);
      setSelected(data.ticket);
      toast.success("Ticket sizga biriktirildi");
      loadList({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  const orderedMessages = useMemo(() => messages.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [messages]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-black">Support chat</h1>
          <p className="text-sm text-slate-400">User ticketlari real vaqtda yangilanadi, javoblar o'yinchining web chat oynasiga tushadi.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(statusLabels).map(([key, label]) => (
            <button key={key} className={`btn ${status === key ? 'btn-primary' : ''}`} onClick={() => setStatus(key)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Ochiq" value={stats?.open} tone="amber" />
        <Metric label="Javob kutilmoqda" value={stats?.unread_staff} tone="red" />
        <Metric label="Javob berilgan" value={stats?.answered} tone="green" />
        <Metric label="Shoshilinch" value={stats?.urgent} tone="blue" />
      </div>

      <div className="grid min-h-[620px] gap-4 xl:grid-cols-[390px_1fr]">
        <section className="card overflow-hidden">
          <div className="border-b border-[#1e1e2e] p-4">
            <input
              className="h-11 w-full px-3"
              placeholder="@nickname, email yoki mavzu"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="max-h-[560px] overflow-y-auto p-3">
            {!tickets.length && <div className="rounded-lg border border-[#1e1e2e] p-5 text-center text-sm text-slate-400">Ticket topilmadi</div>}
            {tickets.map((item) => (
              <button
                key={item.id}
                className={`mb-2 block w-full rounded-lg border p-3 text-left transition ${
                  selectedId === item.id ? 'border-[#f5a623] bg-[#f5a623]/10' : 'border-[#1e1e2e] bg-white/[.025] hover:border-[#f5a623]/45'
                }`}
                onClick={() => loadTicket(item.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-black text-amber-100">{item.subject}</div>
                    <div className="mt-1 text-xs font-bold text-slate-400">@{item.nickname || item.username || 'user'}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black ${
                    item.status === 'open' ? 'bg-amber-500/15 text-amber-200'
                      : item.status === 'answered' ? 'bg-emerald-500/15 text-emerald-200'
                        : item.status === 'closed' ? 'bg-rose-500/15 text-rose-200'
                          : 'bg-blue-500/15 text-blue-200'
                  }`}>{statusLabels[item.status] || item.status}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-300">{item.lastMessage || 'Xabar yoq'}</p>
                <div className="mt-3 flex items-center justify-between text-xs font-bold text-slate-500">
                  <span>{priorityLabels[item.priority] || item.priority}</span>
                  <span>{fmtDate(item.lastMessageAt)}</span>
                </div>
                {Number(item.unreadByStaff || 0) > 0 && (
                  <div className="mt-2 inline-flex rounded-full bg-rose-600 px-2 py-1 text-[10px] font-black text-white">
                    {item.unreadByStaff} yangi
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="card flex min-h-[620px] flex-col overflow-hidden">
          {!selected ? (
            <div className="grid flex-1 place-items-center p-6 text-center text-slate-400">
              Ticket tanlang
            </div>
          ) : (
            <>
              <div className="border-b border-[#1e1e2e] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-xl font-black text-amber-100">{selected.subject}</div>
                    <div className="mt-1 text-sm text-slate-400">
                      @{selected.nickname || selected.username || 'user'} / {selected.email || 'email yoq'} / {fmtDate(selected.createdAt)}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Biriktirilgan: {selected.assignedNickname || selected.assignedUsername || 'hali yoq'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select className="h-10 px-3" value={selected.status} onChange={(e) => updateTicket({ status: e.target.value })}>
                      {Object.entries(statusLabels).filter(([key]) => key !== 'all').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <select className="h-10 px-3" value={selected.priority} onChange={(e) => updateTicket({ priority: e.target.value })}>
                      {Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <button className="btn" onClick={assignToMe} disabled={loading}>Menga olish</button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-black/20 p-4">
                {orderedMessages.map((message) => {
                  const isStaff = message.senderRole !== 'user';
                  const attachment = imageAttachment(message);
                  return (
                    <div key={message.id} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] rounded-2xl border px-4 py-3 ${
                        message.isInternal ? 'border-violet-500/35 bg-violet-950/45'
                          : isStaff ? 'border-[#f5a623]/35 bg-[#3b2608]' : 'border-[#1e1e2e] bg-[#111827]'
                      }`}>
                        <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase text-slate-400">
                          <span>{message.isInternal ? 'Ichki izoh' : isStaff ? 'Support' : (message.senderName || 'User')}</span>
                          <span>{fmtDate(message.createdAt)}</span>
                        </div>
                        <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{message.body}</div>
                        {attachment && (
                          <a href={attachment.dataUrl} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-xl border border-amber-400/25 bg-black/35">
                            <img src={attachment.dataUrl} alt={attachment.name || 'Support rasmi'} className="max-h-72 w-full object-contain" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-[#1e1e2e] p-4">
                <textarea
                  className="min-h-24 w-full p-3"
                  placeholder="Javob yozing"
                  value={reply}
                  onChange={(e) => {
                    setReply(e.target.value);
                    saveDraft(selectedId, { body: e.target.value, internal });
                  }}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-300">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(e) => {
                        setInternal(e.target.checked);
                        saveDraft(selectedId, { body: reply, internal: e.target.checked });
                      }}
                    />
                    Faqat adminlar uchun ichki izoh
                  </label>
                  <button className="btn btn-primary" onClick={sendReply} disabled={loading || !reply.trim()}>
                    Javob yuborish
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  const color = {
    amber: 'text-amber-200 border-amber-500/25 bg-amber-500/10',
    red: 'text-rose-200 border-rose-500/25 bg-rose-500/10',
    green: 'text-emerald-200 border-emerald-500/25 bg-emerald-500/10',
    blue: 'text-blue-200 border-blue-500/25 bg-blue-500/10',
  }[tone] || 'text-slate-200 border-[#1e1e2e] bg-white/[.03]';
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <div className="text-xs font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-2 text-3xl font-black">{Number(value || 0).toLocaleString('ru-RU')}</div>
    </div>
  );
}
