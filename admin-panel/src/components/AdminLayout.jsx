import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, clearToken } from '../api.js';

const nav = [
  ['Asosiy', [
    ['Dashboard', '/dashboard', 'D'],
    ['Foydalanuvchilar', '/users', 'U'],
    ['Xonalar', '/rooms', 'R'],
    ["O'yin tarixi", '/games', 'G'],
  ]],
  ["O'yin boshqaruvi", [
    ['Stikerlar', '/stickers', 'S'],
    ['Decklar', '/decks', 'K'],
    ['Chestlar', '/chests', 'C'],
    ['Emoji', '/emoji-packs', 'E'],
    ['Ramkalar', '/frames', 'F'],
    ['Tasklar', '/tasks', 'T'],
    ['Reyting', '/ranking', '#'],
  ]],
  ['Iqtisodiyot', [
    ['Economy', '/economy', '$'],
    ['Gold coin', '/gold', 'O'],
    ["Do'kon", '/shop', 'P'],
    ['Promokodlar', '/promotions', '%'],
  ]],
  ['Operatsiya', [
    ['Xabarlar', '/messages', 'M'],
    ['Telegram', '/telegram', 'TG'],
    ['Support chat', '/support', '?'],
    ['Turnirlar', '/tournaments', 'W'],
    ['Hisobotlar', '/reports', 'A'],
    ['Analytics', '/analytics', 'N'],
    ['Security', '/security', '!'],
    ['Antibot', '/antibot', 'B'],
    ['Backup', '/backups', 'Z'],
    ['Roles', '/roles', 'O'],
    ['Sozlamalar', '/settings', '*'],
    ['Audit', '/audit', 'L'],
  ]],
];

function fmt(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

export default function AdminLayout({ user }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.dashboardStats().then((data) => alive && setStats(data)).catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const initial = useMemo(() => (user?.nickname || user?.username || 'A').slice(0, 1).toUpperCase(), [user]);
  const roleLabel = String(user?.role || user?.admin_role || 'admin').replaceAll('_', ' ').toUpperCase();
  const linkClass = ({ isActive }) => `flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
    isActive ? 'bg-[#f5a623]/14 text-[#f5a623] ring-1 ring-[#f5a623]/30' : 'text-slate-400 hover:bg-white/[.04] hover:text-white'
  }`;

  return (
    <div className="admin-shell min-h-screen bg-[#0a0a0f] text-white lg:pl-60">
      <aside className={`admin-sidebar fixed inset-y-0 left-0 z-40 w-[min(18rem,calc(100vw-24px))] border-r border-[#1e1e2e] bg-[#0d0d14] transition-transform sm:w-64 lg:w-60 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[#1e1e2e] p-4">
            <div className="min-w-0">
              <div className="truncate text-xl font-black tracking-wide text-[#f5a623]">ADMIN PANEL</div>
              <div className="mt-1 text-[10px] uppercase tracking-[.18em] text-slate-500">Durak Imperia</div>
            </div>
            <button className="btn h-9 min-h-0 w-9 p-0 lg:hidden" onClick={() => setOpen(false)} aria-label="Menyuni yopish">x</button>
          </div>
          <div className="flex items-center gap-3 border-b border-[#1e1e2e] p-4">
            <div className="grid h-10 w-10 place-items-center rounded-full border border-[#f5a623]/40 bg-[#f5a623]/12 font-black text-[#f5a623]">{initial}</div>
            <div className="min-w-0">
              <div className="truncate font-bold">@{user?.nickname || user?.username || 'admin'}</div>
              <div className="text-xs font-bold text-emerald-400">{roleLabel}</div>
            </div>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto p-3">
            {nav.map(([section, items]) => (
              <div key={section} className="mb-4">
                <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[#f5a623]/55">{section}</div>
                <div className="space-y-1">
                  {items.map(([label, to, icon]) => (
                    <NavLink key={to} to={to} className={linkClass} onClick={() => setOpen(false)}>
                      <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded bg-white/[.04] text-xs font-black">{icon}</span>
                      <span className="min-w-0 truncate">{label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-[#1e1e2e] p-3">
            <button className="btn btn-danger w-full" onClick={() => { clearToken(); navigate('/login'); }}>Chiqish</button>
          </div>
        </div>
      </aside>
      {open && <button className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu" />}

      <header className="admin-topbar sticky top-0 z-20 border-b border-[#1e1e2e] bg-[#0a0a0f]/95 backdrop-blur">
        <div className="flex min-h-16 flex-col items-stretch gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4 lg:px-6">
          <div className="flex items-center justify-between gap-2 sm:justify-start">
            <button className="btn lg:hidden" onClick={() => setOpen(true)}>
              <span aria-hidden="true">☰</span>
              <span>Menu</span>
            </button>
            <div className="flex items-center gap-2 md:hidden">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-bold uppercase text-emerald-300">Live</span>
            </div>
          </div>
          <div className="admin-header-metrics grid flex-1 grid-cols-2 gap-2 md:grid-cols-4">
            <HeaderMetric label="Users" value={fmt(stats?.totalUsers)} />
            <HeaderMetric label="Online" value={fmt(stats?.onlineNow)} live />
            <HeaderMetric label="Games" value={fmt(stats?.activeGames)} />
            <HeaderMetric label="Server" value={stats?.server?.status || 'stable'} />
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-bold uppercase text-emerald-300">Live</span>
          </div>
        </div>
      </header>
      <main className="admin-main p-3 sm:p-4 lg:p-6">
        <Outlet />
      </main>
    </div>
  );
}

function HeaderMetric({ label, value, live }) {
  return (
    <div className="min-w-0 rounded border border-[#1e1e2e] bg-[#13131a] px-3 py-2">
      <div className="truncate text-[10px] font-bold uppercase text-slate-500">{label}</div>
      <div className="flex min-w-0 items-center gap-2 text-sm font-black">
        {live && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
        <span className="min-w-0 truncate">{value}</span>
      </div>
    </div>
  );
}
