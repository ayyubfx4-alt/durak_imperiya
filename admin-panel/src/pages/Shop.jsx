import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Shop() {
  const [items, setItems] = useState({ data: [], pagination: { page: 1, pages: 1, total: 0, limit: 25 } });
  const [purchases, setPurchases] = useState({ data: [], pagination: { page: 1, pages: 1, total: 0, limit: 25 } });
  const toast = useToast();
  async function load(page = 1) { try { const [i, p] = await Promise.all([api.shopItems({ page, limit: 25 }), api.shopPurchases({ page, limit: 25 })]); setItems(i); setPurchases(p); } catch (err) { toast.error(err.message); } }
  useEffect(() => { load(); }, []);
  return <div className="space-y-5"><div><h1 className="text-2xl font-black">Do'kon</h1><p className="text-sm text-slate-400">Item visibility, narx va purchase history.</p></div><DataTable rows={items.data} pagination={items.pagination} onPageChange={load} columns={[{ key: 'name', label: 'Item' }, { key: 'itemType', label: 'Type' }, { key: 'priceCoins', label: 'Coins' }, { key: 'priceGold', label: 'Gold' }, { key: 'enabled', label: 'Status', render: (r) => <StatusBadge status={r.enabled ? 'active' : 'inactive'} /> }, { key: 'actions', label: 'Amallar', render: (r) => <button className="btn min-h-0 px-2 py-1" onClick={async () => { await api.toggleShopItem(r.id); toast.success('Visibility ozgardi'); load(items.pagination.page); }}>Toggle</button> }]} /><h2 className="font-bold">Purchase history</h2><DataTable rows={purchases.data} pagination={purchases.pagination} onPageChange={load} columns={[{ key: 'username', label: 'User' }, { key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount' }, { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString() }]} /></div>;
}
