import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatCard from '../components/StatCard.jsx';
import { useToast } from '../components/Toast.jsx';

export default function GoldCoins() {
  const [stats, setStats] = useState(null);
  const [tx, setTx] = useState({ data: [], pagination: { page: 1, pages: 1, total: 0, limit: 25 } });
  const [grant, setGrant] = useState({ userId: '', amount: 10, reason: 'admin gold grant' });
  const toast = useToast();
  async function load(page = 1) { try { const [s, t] = await Promise.all([api.goldStats(), api.goldTransactions({ page, limit: 25 })]); setStats(s); setTx(t); } catch (err) { toast.error(err.message); } }
  useEffect(() => { load(); }, []);
  async function send() { try { await api.grantGold(grant); toast.success('Gold berildi'); setGrant({ userId: '', amount: 10, reason: 'admin gold grant' }); load(); } catch (err) { toast.error(err.message); } }
  return <div className="space-y-5"><div><h1 className="text-2xl font-black">Gold Coin</h1><p className="text-sm text-slate-400">Gold ledger va admin grant.</p></div><div className="grid gap-4 md:grid-cols-3"><StatCard label="Minted" value={stats?.totalGoldMinted} /><StatCard label="Spent" value={stats?.totalGoldSpent} accent="purple" /><StatCard label="Wallets" value={stats?.inWallets} accent="gold" /></div><div className="card grid gap-3 p-4 md:grid-cols-[1fr_160px_1fr_auto]"><input className="h-10 px-3" placeholder="User ID" value={grant.userId} onChange={(e) => setGrant((g) => ({ ...g, userId: e.target.value }))} /><input className="h-10 px-3" type="number" value={grant.amount} onChange={(e) => setGrant((g) => ({ ...g, amount: Number(e.target.value) }))} /><input className="h-10 px-3" placeholder="Reason" value={grant.reason} onChange={(e) => setGrant((g) => ({ ...g, reason: e.target.value }))} /><button className="btn btn-primary" onClick={send}>Grant</button></div><DataTable rows={tx.data} pagination={tx.pagination} onPageChange={load} columns={[{ key: 'username', label: 'User', render: (r) => r.username || r.user_id }, { key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount' }, { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString() }]} /></div>;
}
