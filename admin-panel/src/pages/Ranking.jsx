import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Ranking() {
  const [rows, setRows] = useState([]);
  const [dist, setDist] = useState([]);
  const toast = useToast();
  const confirm = useConfirm();
  async function load() { try { const [l, d] = await Promise.all([api.leaderboard(), api.rankDistribution()]); setRows(l); setDist(d); } catch (err) { toast.error(err.message); } }
  useEffect(() => { load(); }, []);
  async function reset() {
    if (!await confirm({ title: 'Ranking reset', message: 'Barcha reytinglar 0 qilinsinmi?', danger: true })) return;
    try { await api.resetRanking('RESET_RANKING'); toast.success('Ranking reset qilindi'); load(); } catch (err) { toast.error(err.message); }
  }
  return <div className="space-y-5"><div className="flex justify-between gap-3"><div><h1 className="text-2xl font-black">Reyting tizimi</h1><p className="text-sm text-slate-400">Top 100, sezon va tier distribution.</p></div><button className="btn btn-danger" onClick={reset}>Reset ranking</button></div><div className="card flex flex-wrap gap-3 p-4">{dist.map((x) => <div key={x.tier} className="rounded border border-[#1e1e2e] px-4 py-3"><div className="text-xs text-slate-500">{x.tier}</div><div className="text-xl font-black">{x.users}</div></div>)}</div><DataTable rows={rows} columns={[{ key: 'position', label: '#' }, { key: 'username', label: 'User', render: (r) => `@${r.username}` }, { key: 'rank_wins', label: 'Rank wins', sortable: true }, { key: 'games_won', label: 'Wins', sortable: true }, { key: 'games_played', label: 'Games', sortable: true }, { key: 'gold_coins', label: 'Gold', sortable: true }]} /></div>;
}
