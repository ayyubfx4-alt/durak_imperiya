import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import { useToast } from '../components/Toast.jsx';

function fmt(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function date(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : '';
}

function userLabel(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return row.username ? `@${row.username}` : name || row.telegram_id;
}

function shortId(value) {
  const text = String(value || '');
  if (text.length <= 6) return text;
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
}

function StatusPill({ ok, label }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-bold ${
      ok ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200' : 'border-red-500/35 bg-red-500/10 text-red-200'
    }`}>
      {label}
    </span>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-[#f5a623]">{fmt(value)}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export default function Telegram() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [broadcasts, setBroadcasts] = useState([]);
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [active, setActive] = useState('all');
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [configureBusy, setConfigureBusy] = useState(false);

  const bot = stats?.bot || health?.bot || null;
  const configured = !!(stats?.configured || health?.configured);
  const botOk = !!(stats?.ok || health?.ok);
  const adminGuardOk = !!(stats?.adminGuardOk || health?.adminGuardOk);

  async function load() {
    try {
      const [s, h, u, b, e] = await Promise.all([
        api.telegramStats(),
        api.telegramHealth(),
        api.telegramUsers({ active, limit: 150 }),
        api.telegramBroadcasts(),
        api.telegramEvents({ limit: 100 }),
      ]);
      setStats(s);
      setHealth(h);
      setUsers(u);
      setBroadcasts(b);
      setEvents(e);
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => { load(); }, [active]);

  async function configure() {
    setConfigureBusy(true);
    try {
      await api.telegramConfigure();
      toast.success('Telegram bot komandalar va menyusi yangilandi');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfigureBusy(false);
    }
  }

  async function sendTest() {
    setTestBusy(true);
    try {
      await api.telegramTestAdminMessage({ message: testMessage.trim() });
      toast.success('Owner Telegram ID ga test xabar yuborildi');
      setTestMessage('');
      await load();
    } catch (err) {
      toast.error(`${err.message}. Owner botga /start bosganini tekshiring.`);
    } finally {
      setTestBusy(false);
    }
  }

  async function send() {
    const text = message.trim();
    if (!text) return toast.error('Xabar matnini kiriting');
    setBusy(true);
    try {
      const result = await api.telegramBroadcast({ message: text });
      toast.success(`Telegram xabar yuborildi: ${fmt(result.sent_count)} ta`);
      setMessage('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const commandList = useMemo(() => (stats?.commands || []).map((c) => `/${c.command}`).join('  '), [stats]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-black">Telegram Bot Control</h1>
          <p className="text-sm text-slate-400">Bot foydalanuvchilari, owner himoyasi, broadcast, eventlar va real holat nazorati.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill ok={configured} label={configured ? 'Token ulangan' : 'Token ulanmagan'} />
          <StatusPill ok={botOk} label={botOk ? 'Telegram API OK' : 'Telegram API xato'} />
          <StatusPill ok={adminGuardOk} label={adminGuardOk ? 'Admin ID OK' : 'Admin ID xato'} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Metric label="Start bosganlar" value={stats?.totalUsers} />
        <Metric label="Aktiv chatlar" value={stats?.activeUsers} />
        <Metric label="Nofaol chatlar" value={stats?.inactiveUsers} />
        <Metric label="Admin user" value={stats?.adminIdsCount || stats?.adminUsers} hint={stats?.ownerId ? `Owner ${stats.ownerId}` : ''} />
        <Metric label="Bot xabarlar" value={stats?.messageCount} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <section className="card p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">Bot holati</h2>
              <p className="text-sm text-slate-400">Token, WebApp havolalar, polling va owner whitelist.</p>
            </div>
            <button className="btn btn-primary" disabled={configureBusy || !configured} onClick={configure}>
              {configureBusy ? 'Yangilanmoqda...' : 'Command/Menu yangilash'}
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Info label="Bot" value={bot?.username ? `@${bot.username}` : bot?.error || '-'} ok={botOk} />
            <Info label="Admin IDs" value={`${stats?.adminIdsCount || health?.adminIdsCount || 0} ta admin`} ok={adminGuardOk} />
            <Info label="Launch mode" value={stats?.launchMode || '-'} ok={(stats?.launchMode || '').includes('web_app')} />
            <Info label="Admin launch" value={stats?.adminLaunchMode || '-'} ok={(stats?.adminLaunchMode || '') !== 'missing'} />
            <Info label="Polling" value={stats?.pollingEnabled ? 'enabled' : 'disabled'} ok={!!stats?.pollingEnabled} />
            <Info label="Instance" value={stats?.pollingInstanceId || '-'} ok={!!stats?.pollingInstanceId} />
          </div>
          <div className="mt-4 rounded-lg border border-[#1e1e2e] bg-black/30 p-3 text-xs text-slate-400">
            <div className="font-bold text-slate-300">Komandalar</div>
            <div className="mt-1 break-words">{commandList || '-'}</div>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="min-h-48 bg-cover bg-center p-4" style={{ backgroundImage: stats?.heroImageUrl ? `linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.82)), url(${stats.heroImageUrl})` : 'linear-gradient(180deg,#17191b,#090706)' }}>
            <div className="max-w-md">
              <div className="text-xs font-black uppercase tracking-widest text-[#f5a623]">Preview</div>
              <h2 className="mt-2 text-2xl font-black">Durak Imperia</h2>
              <p className="mt-2 text-sm text-slate-200">Premium karta stollari, turnirlar, reyting va sovrinlar. Start xabari rasm bilan yuboriladi, rasm ishlamasa matn fallback bor.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="btn btn-primary pointer-events-none">O'yinni ochish</span>
                <span className="btn pointer-events-none">Yordam</span>
                <span className="btn pointer-events-none">Support</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <section className="card space-y-4 p-4">
          <div>
            <h2 className="text-lg font-black">Ownerga test yuborish</h2>
            <p className="text-sm text-slate-400">Faqat Telegram owner ID: {stats?.ownerId || '8324791195'}.</p>
          </div>
          <textarea
            className="min-h-24 w-full p-3"
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            maxLength={1024}
            placeholder="Bo'sh qoldirilsa standart test xabar boradi..."
          />
          <button className="btn btn-green w-full" disabled={testBusy || !configured} onClick={sendTest}>
            {testBusy ? 'Yuborilmoqda...' : 'Ownerga test xabar yuborish'}
          </button>
        </section>

        <section className="card space-y-4 p-4">
          <div>
            <h2 className="text-lg font-black">Hammaga xabar yuborish</h2>
            <p className="text-sm text-slate-400">Xabar barcha aktiv chatlarga yuboriladi. Tugmalar avtomatik qo'shiladi.</p>
          </div>
          <textarea
            className="min-h-24 w-full p-3"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={4096}
            placeholder="Broadcast matni..."
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-bold text-slate-500">{message.length}/4096</span>
            <button className="btn btn-primary" disabled={busy || !configured} onClick={send}>
              {busy ? 'Yuborilmoqda...' : 'Broadcast yuborish'}
            </button>
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black">Telegram userlar</h2>
          <select className="h-10 rounded border border-[#1e1e2e] bg-[#13131a] px-3" value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="all">Hammasi</option>
            <option value="active">Aktiv</option>
            <option value="inactive">Nofaol</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <DataTable rows={users} columns={[
          { key: 'user', label: 'User', render: (r) => <span className="font-bold">{userLabel(r)}</span> },
          { key: 'telegram_id', label: 'Telegram ID', render: (r) => shortId(r.telegram_id) },
          { key: 'is_admin', label: 'Role', render: (r) => r.is_admin ? <span className="text-[#f5a623] font-bold">OWNER</span> : 'User' },
          { key: 'language_code', label: 'Til' },
          { key: 'message_count', label: 'Xabar', render: (r) => fmt(r.message_count) },
          { key: 'last_command', label: 'Oxirgi command', render: (r) => r.last_command ? `/${r.last_command}` : '-' },
          { key: 'is_active', label: 'Holat', render: (r) => r.is_active ? 'Aktiv' : 'Nofaol' },
          { key: 'last_seen_at', label: 'Oxirgi aktiv', render: (r) => date(r.last_seen_at || r.last_start_at) },
        ]} rowKey={(row) => row.telegram_id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-black">Bot event log</h2>
        <DataTable rows={events} columns={[
          { key: 'event_type', label: 'Event' },
          { key: 'telegram_id', label: 'Telegram ID', render: (r) => shortId(r.telegram_id) },
          { key: 'command', label: 'Command', render: (r) => r.payload?.command ? `/${r.payload.command}` : '-' },
          { key: 'username', label: 'Username', render: (r) => r.payload?.username ? `@${r.payload.username}` : '-' },
          { key: 'created_at', label: 'Sana', render: (r) => date(r.created_at) },
        ]} rowKey={(row, index) => `${row.created_at}-${row.event_type}-${index}`} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-black">Broadcast tarixi</h2>
        <DataTable rows={broadcasts} columns={[
          { key: 'message', label: 'Xabar', render: (r) => String(r.message || '').slice(0, 90) },
          { key: 'total_recipients', label: 'Jami', render: (r) => fmt(r.total_recipients) },
          { key: 'sent_count', label: 'Yuborildi', render: (r) => fmt(r.sent_count) },
          { key: 'failed_count', label: 'Xato', render: (r) => fmt(r.failed_count) },
          { key: 'inactive_count', label: 'Nofaol qilindi', render: (r) => fmt(r.inactive_count) },
          { key: 'created_at', label: 'Sana', render: (r) => date(r.created_at) },
        ]} />
      </section>
    </div>
  );
}

function Info({ label, value, ok }) {
  return (
    <div className="rounded-lg border border-[#1e1e2e] bg-black/25 p-3">
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div className={`mt-1 break-words text-sm font-bold ${ok ? 'text-emerald-200' : 'text-slate-200'}`}>{value || '-'}</div>
    </div>
  );
}
