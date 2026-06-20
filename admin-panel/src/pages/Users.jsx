import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const emptyAdjust = { amount: 0, reason: '' };
const defaultMute = { minutes: 60, reason: 'admin mute' };
const PREMIUM_PRESETS = [
  { label: '1 kun', days: 1 },
  { label: '1 hafta', days: 7 },
  { label: '1 oy', days: 30 },
  { label: '1 yil', days: 365 },
];
const MUTE_PRESETS = [
  { label: '15 daqiqa', minutes: 15 },
  { label: '1 soat', minutes: 60 },
  { label: '1 kun', minutes: 1440 },
  { label: '7 kun', minutes: 10080 },
];

export default function Users() {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 25 });
  const [filters, setFilters] = useState({ search: '', status: '', role: '' });
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [adjust, setAdjust] = useState(emptyAdjust);
  const [premiumDays, setPremiumDays] = useState(30);
  const [muteForm, setMuteForm] = useState(defaultMute);
  const [selected, setSelected] = useState([]);
  const toast = useToast();
  const confirm = useConfirm();

  async function load(page = 1) {
    setLoading(true);
    try {
      const [res, roleRows] = await Promise.all([
        api.users({ ...filters, page, limit: pagination.limit }),
        api.roles().catch(() => []),
      ]);
      setRows(res.data || []);
      setPagination(res.pagination || pagination);
      setRoles(roleRows || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, []);

  async function openDetail(id) {
    try { setDetail(await api.userDetail(id)); } catch (err) { toast.error(err.message); }
  }

  async function doAction(label, fn) {
    try {
      await fn();
      toast.success(label);
      await load(pagination.page);
      if (detail?.user?.id) await openDetail(detail.user.id);
    } catch (err) { toast.error(err.message); }
  }

  const columns = [
    { key: 'username', label: 'User', sortable: true, render: (u) => <button className="font-bold text-[#f5a623]" onClick={() => openDetail(u.id)}>@{u.nickname || u.username}</button> },
    { key: 'email', label: 'Email', render: (u) => <span className="text-slate-400">{u.email || '-'}</span> },
    { key: 'coins', label: 'Durak $', sortable: true, render: (u) => Number(u.coins || 0).toLocaleString('ru-RU') },
    { key: 'gold_coins', label: 'Gold', sortable: true },
    { key: 'games_played', label: 'Games', sortable: true },
    { key: 'games_won', label: 'Wins', sortable: true },
    { key: 'role', label: 'Role', render: (u) => <StatusBadge status={u.admin_role || (u.is_admin ? 'admin' : 'player')} /> },
    {
      key: 'status',
      label: 'Status',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={u.is_banned ? 'banned' : 'active'} />
          {u.is_muted && <StatusBadge status="muted" />}
          {u.premium_until && new Date(u.premium_until) > new Date() && <StatusBadge status="premium" />}
        </div>
      ),
    },
    {
      key: 'actions',
      label: 'Amallar',
      render: (u) => (
        <div className="flex flex-wrap gap-2">
          <button className="btn min-h-0 px-2 py-1" onClick={() => openDetail(u.id)}>Profil</button>
          {u.is_muted
            ? <button className="btn btn-green min-h-0 px-2 py-1" onClick={() => doAction('Mute olib tashlandi', () => api.unmuteUser(u.id))}>Unmute</button>
            : <button className="btn min-h-0 px-2 py-1" onClick={() => doAction('Mute berildi', () => api.muteUser(u.id, defaultMute))}>Mute</button>}
          {u.is_banned
            ? <button className="btn btn-green min-h-0 px-2 py-1" onClick={() => doAction('Ban olib tashlandi', () => api.unbanUser(u.id))}>Unban</button>
            : <button className="btn btn-danger min-h-0 px-2 py-1" onClick={async () => {
              if (await confirm({ title: 'Ban berish', message: `@${u.nickname || u.username} ban qilinsinmi?`, danger: true })) {
                await doAction('Foydalanuvchi ban qilindi', () => api.banUser(u.id, { reason: 'admin action', duration: 'permanent' }));
              }
            }}>Ban</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Foydalanuvchilar</h1>
          <p className="text-sm text-slate-400">@nickname qidirish, ban/mute, premium, balans, rol va tarix boshqaruvi.</p>
        </div>
        <button
          className="btn btn-danger"
          disabled={!selected.length}
          onClick={async () => {
            if (await confirm({ title: 'Bulk ban', message: `${selected.length} foydalanuvchi ban qilinsinmi?`, danger: true })) {
              await doAction('Tanlangan foydalanuvchilar ban qilindi', async () => {
                for (const id of selected) await api.banUser(id, { reason: 'bulk admin action', duration: 'permanent' });
                setSelected([]);
              });
            }
          }}
        >
          Tanlanganlarni ban qilish
        </button>
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-[1fr_180px_180px_auto]">
        <input className="h-10 px-3" placeholder="@nickname, username yoki email..." value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
        <select className="h-10 px-3" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">Status: hammasi</option>
          <option value="active">Active</option>
          <option value="banned">Banned</option>
        </select>
        <select className="h-10 px-3" value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}>
          <option value="">Role: hammasi</option>
          <option value="player">Player</option>
          <option value="admin">Admin</option>
          {roles.map((role) => <option key={role.role} value={role.role}>{role.role}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => load(1)}>Qidirish</button>
      </div>
      <DataTable rows={rows} columns={columns} loading={loading} pagination={pagination} onPageChange={load} selected={selected} onSelectedChange={setSelected} />
      <Modal
        open={!!detail}
        title={detail?.user ? `@${detail.user.nickname || detail.user.username}` : 'Profil'}
        wide
        onClose={() => setDetail(null)}
      >
        {detail?.user && (
          <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
            <div className="space-y-4">
              <div className="card p-4">
                <div className="text-xl font-black">@{detail.user.nickname || detail.user.username}</div>
                <div className="mt-2 text-sm text-slate-400">{detail.user.email || 'email yoq'}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge status={detail.user.admin_role || 'player'} />
                  <StatusBadge status={detail.user.is_banned ? 'banned' : 'active'} />
                  {detail.user.is_muted && <StatusBadge status="muted" />}
                  {detail.user.premium_until && new Date(detail.user.premium_until) > new Date() && <StatusBadge status="premium" />}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <Info label="Durak $" value={detail.user.coins} />
                  <Info label="Gold" value={detail.user.gold_coins} />
                  <Info label="Games" value={detail.user.games_played} />
                  <Info label="Wins" value={detail.user.games_won} />
                </div>
                <div className="mt-4 text-xs text-slate-500">
                  IP: {detail.user.last_ip || '-'} · Device: {detail.user.device_id || '-'}
                </div>
              </div>

              <div className="card space-y-3 p-4">
                <div className="font-bold">Balans sozlash</div>
                <input className="h-10 w-full px-3" type="number" value={adjust.amount} onChange={(e) => setAdjust((a) => ({ ...a, amount: e.target.value }))} />
                <input className="h-10 w-full px-3" placeholder="Sabab" value={adjust.reason} onChange={(e) => setAdjust((a) => ({ ...a, reason: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-primary" onClick={() => doAction('Durak $ yangilandi', () => api.adjustCoins(detail.user.id, adjust))}>Durak $</button>
                  <button className="btn btn-primary" onClick={() => doAction('Gold yangilandi', () => api.adjustGold(detail.user.id, adjust))}>Gold</button>
                </div>
              </div>

              <div className="card space-y-3 p-4">
                <div className="font-bold">Premium va mute</div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Premium davri</div>
                <div className="grid grid-cols-2 gap-2">
                  {PREMIUM_PRESETS.map((preset) => (
                    <button
                      key={preset.days}
                      className={`btn ${Number(premiumDays) === preset.days ? 'btn-primary' : ''}`}
                      onClick={() => setPremiumDays(preset.days)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-primary w-full"
                  onClick={() => doAction('Premium berildi', () => api.grantPremium(detail.user.id, { days: Number(premiumDays) || 30 }))}
                >
                  Premium berish: {PREMIUM_PRESETS.find((p) => p.days === Number(premiumDays))?.label || `${premiumDays} kun`}
                </button>

                <div className="pt-2 text-xs font-bold uppercase tracking-wide text-slate-400">Mute muddati</div>
                <div className="grid grid-cols-2 gap-2">
                  {MUTE_PRESETS.map((preset) => (
                    <button
                      key={preset.minutes}
                      className={`btn ${Number(muteForm.minutes) === preset.minutes ? 'btn-primary' : ''}`}
                      onClick={() => setMuteForm((f) => ({ ...f, minutes: preset.minutes }))}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input className="h-10 w-full px-3" placeholder="Mute sababi" value={muteForm.reason} onChange={(e) => setMuteForm((f) => ({ ...f, reason: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn" onClick={() => doAction('Mute berildi', () => api.muteUser(detail.user.id, { ...muteForm, minutes: Number(muteForm.minutes) || 60 }))}>Mute</button>
                  <button className="btn btn-green" onClick={() => doAction('Mute olib tashlandi', () => api.unmuteUser(detail.user.id))}>Unmute</button>
                </div>
              </div>

              <div className="card space-y-3 p-4">
                <div className="font-bold">Admin role</div>
                <select
                  className="h-10 w-full px-3"
                  value={detail.user.admin_role || (detail.user.is_admin ? 'super_admin' : 'player')}
                  onChange={(e) => doAction('Role yangilandi', () => api.setUserRole(detail.user.id, e.target.value))}
                >
                  {roles.map((role) => <option key={role.role} value={role.role}>{role.role}</option>)}
                </select>
                <button className="btn btn-danger w-full" onClick={() => doAction('Sessiyalar yopildi', () => api.kickSessions(detail.user.id))}>Force logout</button>
              </div>
            </div>
            <div className="space-y-4">
              <Section title="Inventory" rows={detail.inventory} cols={['item_type', 'item_id', 'quantity']} />
              <Section title="Transactions" rows={detail.transactions} cols={['type', 'amount', 'created_at']} />
              <Section title="Gold transactions" rows={detail.goldTransactions} cols={['type', 'amount', 'created_at']} />
              <Section title="Game history" rows={detail.games} cols={['room_code', 'mode', 'stake', 'started_at']} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Info({ label, value }) {
  return <div className="rounded border border-[#1e1e2e] bg-black/20 p-3"><div className="text-xs text-slate-500">{label}</div><div className="font-black">{Number(value || 0).toLocaleString('ru-RU')}</div></div>;
}

function Section({ title, rows = [], cols }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[#1e1e2e] px-4 py-3 font-bold">{title}</div>
      <div className="max-h-56 overflow-auto">
        {rows.slice(0, 30).map((row, idx) => (
          <div key={row.id || idx} className="grid grid-cols-3 gap-2 border-b border-[#1e1e2e] px-4 py-2 text-xs text-slate-300 last:border-b-0">
            {cols.map((col) => <span key={col} className="truncate">{String(row[col] ?? '-')}</span>)}
          </div>
        ))}
        {!rows.length && <div className="p-5 text-center text-sm text-slate-500">Ma'lumot yo'q</div>}
      </div>
    </div>
  );
}
