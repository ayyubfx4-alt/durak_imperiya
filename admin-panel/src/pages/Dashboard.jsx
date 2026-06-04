import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [charts, setCharts] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const [s, e, c] = await Promise.all([api.dashboardStats(), api.dashboardEvents(), api.dashboardCharts()]);
      setStats(s);
      setEvents(e);
      setCharts(c);
    } catch (err) {
      toast.error(err.message || 'Dashboard yuklanmadi');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Dashboard</h1>
          <p className="text-sm text-slate-400">Jonli holat, o'yin oqimi va eng muhim metrikalar.</p>
        </div>
        <button className="btn btn-primary" onClick={load}>Yangilash</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Jami foydalanuvchi" value={fmt(stats?.totalUsers)} hint={`Bugun +${fmt(stats?.newUsersToday)}`} />
        <StatCard label="Aktiv o'yinlar" value={fmt(stats?.activeGames)} accent="purple" hint={`Bugun ${fmt(stats?.gamesPlayedToday)} game`} />
        <StatCard label="Online" value={fmt(stats?.onlineNow)} accent="green" hint="Live" />
        <StatCard label="Bugungi revenue" value={fmt(stats?.revenueToday)} accent="gold" hint="Coins ledger" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <section className="card p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold">30 kunlik faollik</h2>
            <StatusBadge status={stats?.server?.status || 'stable'} />
          </div>
          <MiniBars rows={charts?.dailyActiveUsers || []} color="#22c55e" />
          <div className="mt-6">
            <h3 className="mb-3 font-bold">Oxirgi 7 kun games</h3>
            <MiniBars rows={charts?.games || []} color="#a855f7" />
          </div>
        </section>
        <section className="card p-4">
          <h2 className="mb-3 font-bold">Server status</h2>
          <div className="space-y-3 text-sm">
            <Line label="DB" value={stats?.server?.db || 'connected'} />
            <Line label="Redis" value={stats?.server?.redis || 'connected'} />
            <Line label="Instance" value={stats?.server?.instance || '-'} />
            <Line label="Uptime" value={`${fmt(stats?.server?.uptimeSeconds)} sec`} />
          </div>
        </section>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section>
          <h2 className="mb-3 font-bold">Top 5 o'yinchi</h2>
          <DataTable
            loading={loading}
            rows={stats?.topPlayers || []}
            columns={[
              { key: 'username', label: 'User', render: (r) => `@${r.username}` },
              { key: 'games_won', label: 'Wins', sortable: true },
              { key: 'rank_wins', label: 'Rank', sortable: true },
              { key: 'gold_coins', label: 'Gold', sortable: true },
            ]}
          />
        </section>
        <section>
          <h2 className="mb-3 font-bold">Event feed</h2>
          <div className="card max-h-[390px] overflow-auto">
            {events.map((event) => (
              <div key={event.id} className="border-b border-[#1e1e2e] px-4 py-3 text-sm last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#f5a623]">{event.category}</span>
                  <span className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-slate-300">{event.message}</p>
              </div>
            ))}
            {!events.length && <div className="p-8 text-center text-slate-500">Event yo'q</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Line({ label, value }) {
  return <div className="flex justify-between border-b border-[#1e1e2e] pb-2"><span className="text-slate-400">{label}</span><strong>{value}</strong></div>;
}

function MiniBars({ rows, color }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
  return (
    <div className="flex h-48 items-end gap-1">
      {rows.map((row) => (
        <div key={row.date} className="flex flex-1 flex-col items-center gap-2">
          <div className="w-full rounded-t" style={{ height: `${Math.max(4, (Number(row.value || 0) / max) * 180)}px`, background: color }} title={`${row.date}: ${row.value}`} />
        </div>
      ))}
    </div>
  );
}
