import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatCard from '../components/StatCard.jsx';
import { useToast } from '../components/Toast.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const mins = (seconds) => `${Math.round(Number(seconds || 0) / 60)} min`;

export default function Analytics() {
  const [data, setData] = useState(null);
  const toast = useToast();

  async function load() {
    try { setData(await api.analyticsOverview()); } catch (err) { toast.error(err.message); }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Analytics</h1>
          <p className="text-sm text-slate-400">DAU/MAU, session time, donorlar, aktiv userlar va eng ko'p o'ynalgan stollar.</p>
        </div>
        <button className="btn btn-primary" onClick={load}>Yangilash</button>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="DAU" value={fmt(data?.activity?.dau)} accent="green" />
        <StatCard label="MAU" value={fmt(data?.activity?.mau)} accent="purple" />
        <StatCard label="Yangi userlar" value={fmt(data?.activity?.new_today)} />
        <StatCard label="Avg session" value={mins(data?.sessionTime?.avg_seconds)} accent="gold" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Eng ko'p donat qilgan userlar">
          <DataTable rows={data?.topDonators || []} columns={[
            { key: 'username', label: 'User', render: (r) => `@${r.nickname || r.username}` },
            { key: 'amount_cents', label: 'USD', render: (r) => `$${(Number(r.amount_cents || 0) / 100).toFixed(2)}` },
          ]} />
        </Section>
        <Section title="Eng aktiv userlar">
          <DataTable rows={data?.activeUsers || []} columns={[
            { key: 'username', label: 'User', render: (r) => `@${r.nickname || r.username}` },
            { key: 'games_played', label: 'Games', sortable: true },
            { key: 'games_won', label: 'Wins', sortable: true },
          ]} />
        </Section>
      </div>
      <Section title="Eng ko'p o'ynalgan stol">
        <DataTable rows={data?.popularTables || []} columns={[
          { key: 'stake', label: 'Stavka', sortable: true, render: (r) => fmt(r.stake) },
          { key: 'mode', label: 'Mode' },
          { key: 'games', label: 'Games', sortable: true },
        ]} />
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return <section className="space-y-3"><h2 className="font-bold">{title}</h2>{children}</section>;
}
