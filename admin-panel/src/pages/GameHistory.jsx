import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatCard from '../components/StatCard.jsx';
import { useToast } from '../components/Toast.jsx';

export default function GameHistory() {
  const [stats, setStats] = useState(null);
  const [list, setList] = useState({ data: [], pagination: { page: 1, pages: 1, total: 0, limit: 25 } });
  const toast = useToast();
  async function load(page = 1) {
    try {
      const [s, h] = await Promise.all([api.gameStats(), api.gameHistory({ page, limit: 25 })]);
      setStats(s); setList(h);
    } catch (err) { toast.error(err.message); }
  }
  useEffect(() => { load(); }, []);
  return <div className="space-y-5"><div><h1 className="text-2xl font-black">O'yin tarixi</h1><p className="text-sm text-slate-400">Replay data va tugagan o'yinlar.</p></div><div className="grid gap-4 md:grid-cols-4"><StatCard label="Jami games" value={stats?.total_games} /><StatCard label="Aktiv" value={stats?.active_games} accent="green" /><StatCard label="Avg duration" value={`${stats?.avg_duration_seconds || 0}s`} accent="purple" /><StatCard label="Draws" value={stats?.draws} /></div><DataTable rows={list.data} pagination={list.pagination} onPageChange={load} columns={[{ key: 'room_code', label: 'Room' }, { key: 'mode', label: 'Mode' }, { key: 'stake', label: 'Stake' }, { key: 'winner_id', label: 'Winner' }, { key: 'started_at', label: 'Started', render: (r) => new Date(r.started_at).toLocaleString() }, { key: 'ended_at', label: 'Ended', render: (r) => r.ended_at ? new Date(r.ended_at).toLocaleString() : 'active' }]} /></div>;
}
