import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Promotions() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ name: '', bonusCoins: 1000, durationDays: 7 });
  const toast = useToast();
  async function load() { try { setRows(await api.promotions()); } catch (err) { toast.error(err.message); } }
  useEffect(() => { load(); }, []);
  async function create() { try { await api.createPromotion(form); toast.success('Promo yaratildi'); setForm({ name: '', bonusCoins: 1000, durationDays: 7 }); load(); } catch (err) { toast.error(err.message); } }
  return <div className="space-y-5"><div><h1 className="text-2xl font-black">Promokodlar</h1><p className="text-sm text-slate-400">Promo create, deactivate va history.</p></div><div className="card grid gap-3 p-4 md:grid-cols-[1fr_160px_160px_auto]"><input className="h-10 px-3" placeholder="Promo nomi" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /><input className="h-10 px-3" type="number" value={form.bonusCoins} onChange={(e) => setForm((f) => ({ ...f, bonusCoins: Number(e.target.value) }))} /><input className="h-10 px-3" type="number" value={form.durationDays} onChange={(e) => setForm((f) => ({ ...f, durationDays: Number(e.target.value) }))} /><button className="btn btn-primary" onClick={create}>Create</button></div><DataTable rows={rows} columns={[{ key: 'name', label: 'Name' }, { key: 'bonus_coins', label: 'Bonus' }, { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> }, { key: 'ends_at', label: 'End', render: (r) => new Date(r.ends_at).toLocaleString() }, { key: 'actions', label: 'Amallar', render: (r) => <button className="btn btn-danger min-h-0 px-2 py-1" onClick={async () => { await api.deletePromotion(r.id); toast.success('Deactivated'); load(); }}>Deactivate</button> }]} /></div>;
}
