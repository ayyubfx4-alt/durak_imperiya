import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatCard from '../components/StatCard.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

export default function Economy() {
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [tx, setTx] = useState({ data: [], pagination: { page: 1, pages: 1, total: 0, limit: 25 } });
  const [airdrop, setAirdrop] = useState({ target: 'all_active', userIds: '', amount: 100, currency: 'coins', reason: 'admin airdrop' });
  const [shop, setShop] = useState([]);
  const toast = useToast();
  const confirm = useConfirm();

  async function loadTransactions(page = 1) { setTx(await api.economyTransactions({ page, limit: 25 })); }
  async function load() {
    try {
      const [o, s] = await Promise.all([api.economyOverview(), api.shopStats()]);
      setOverview(o);
      setShop(s);
      await loadTransactions(1);
    } catch (err) { toast.error(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function sendAirdrop() {
    if (!await confirm({ title: 'Airdrop', message: `${airdrop.amount} ${airdrop.currency} yuborilsinmi?`, danger: true })) return;
    try {
      await api.economyAirdrop({ ...airdrop, userIds: airdrop.userIds.split(',').map((x) => x.trim()).filter(Boolean) });
      toast.success('Airdrop bajarildi');
      await load();
    } catch (err) { toast.error(err.message); }
  }

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-black">Economy</h1><p className="text-sm text-slate-400">Coins, gold, tranzaksiyalar, airdrop va shop statistikasi.</p></div>
      <div className="flex flex-wrap gap-2">{['overview', 'transactions', 'airdrop', 'shop'].map((x) => <button key={x} className={`btn ${tab === x ? 'btn-primary' : ''}`} onClick={() => setTab(x)}>{x}</button>)}</div>
      {tab === 'overview' && <div className="grid gap-4 md:grid-cols-4"><StatCard label="Coins circulation" value={fmt(overview?.totalCoins)} /><StatCard label="Gold circulation" value={fmt(overview?.totalGold)} accent="gold" /><StatCard label="Total spent" value={fmt(overview?.totalSpent)} accent="purple" /><StatCard label="Top spender" value={overview?.topSpenders?.[0]?.username || '-'} accent="green" /></div>}
      {tab === 'transactions' && <DataTable rows={tx.data} pagination={tx.pagination} onPageChange={loadTransactions} columns={[{ key: 'username', label: 'User', render: (r) => r.username || r.user_id }, { key: 'type', label: 'Type', sortable: true }, { key: 'amount', label: 'Amount', sortable: true }, { key: 'currency', label: 'Currency' }, { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString() }]} />}
      {tab === 'airdrop' && <div className="card max-w-2xl space-y-4 p-4">
        <label><span className="field-label">Target</span><select className="h-10 w-full px-3" value={airdrop.target} onChange={(e) => setAirdrop((a) => ({ ...a, target: e.target.value }))}><option value="all_active">All active</option><option value="selected">Selected IDs</option></select></label>
        <label><span className="field-label">User IDs vergul bilan</span><textarea className="min-h-20 w-full p-3" disabled={airdrop.target !== 'selected'} value={airdrop.userIds} onChange={(e) => setAirdrop((a) => ({ ...a, userIds: e.target.value }))} /></label>
        <div className="grid gap-3 md:grid-cols-2"><label><span className="field-label">Amount</span><input type="number" className="h-10 w-full px-3" value={airdrop.amount} onChange={(e) => setAirdrop((a) => ({ ...a, amount: Number(e.target.value) }))} /></label><label><span className="field-label">Currency</span><select className="h-10 w-full px-3" value={airdrop.currency} onChange={(e) => setAirdrop((a) => ({ ...a, currency: e.target.value }))}><option value="coins">Coins</option><option value="gold">Gold</option></select></label></div>
        <label><span className="field-label">Reason</span><input className="h-10 w-full px-3" value={airdrop.reason} onChange={(e) => setAirdrop((a) => ({ ...a, reason: e.target.value }))} /></label>
        <button className="btn btn-primary" onClick={sendAirdrop}>Airdrop yuborish</button>
      </div>}
      {tab === 'shop' && <DataTable rows={shop} columns={[{ key: 'name', label: 'Item' }, { key: 'item_type', label: 'Type' }, { key: 'price_coins', label: 'Coins' }, { key: 'price_gold', label: 'Gold' }, { key: 'enabled', label: 'Visible', render: (r) => r.enabled ? 'yes' : 'no' }]} />}
    </div>
  );
}
