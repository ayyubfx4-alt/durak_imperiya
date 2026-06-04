import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import AssetUpload from '../components/AssetUpload.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { assetUrl } from '../api.js';

export default function CatalogPage({ kind, title, itemType }) {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 25 });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  async function load(page = 1) {
    setLoading(true);
    try {
      const res = await api.catalog(kind, { page, limit: pagination.limit, search });
      setRows(res.data || []);
      setPagination(res.pagination || pagination);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(1); }, [kind]);

  async function save() {
    if (!form.name) return toast.error('Nomi kerak');
    try {
      const payload = { ...form, itemType };
      if (form.id && !form.isNew) await api.updateCatalog(kind, form.id, payload);
      else await api.createCatalog(kind, payload);
      toast.success('Saqlandi');
      setForm(null);
      await load(pagination.page);
    } catch (err) { toast.error(err.message); }
  }

  async function remove(row) {
    if (!await confirm({ title: 'Ochirish', message: `${row.name} ochirilsinmi?`, danger: true })) return;
    try { await api.deleteCatalog(kind, row.id); toast.success('Ochirildi'); await load(pagination.page); }
    catch (err) { toast.error(err.message); }
  }

  const columns = [
    { key: 'name', label: 'Nomi', sortable: true, render: (r) => <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center overflow-hidden rounded border border-[#1e1e2e] bg-black/30">{r.imageUrl ? <img src={assetUrl(r.imageUrl)} className="h-full w-full object-cover" /> : <span className="text-sm font-black text-[#f5a623]">{r.icon || 'IMG'}</span>}</div><div><div className="font-bold">{r.name}</div><div className="text-xs text-slate-500">{r.id}</div></div></div> },
    { key: 'rarity', label: 'Rarelik', render: (r) => <StatusBadge status={r.rarity}>{r.rarity}</StatusBadge> },
    { key: 'priceCoins', label: 'Coins', sortable: true },
    { key: 'priceGold', label: 'Gold', sortable: true },
    { key: 'enabled', label: 'Status', render: (r) => <StatusBadge status={r.enabled ? 'active' : 'inactive'}>{r.enabled ? 'active' : 'inactive'}</StatusBadge> },
    { key: 'actions', label: 'Amallar', render: (r) => <div className="flex gap-2"><button className="btn min-h-0 px-2 py-1" onClick={() => setForm(r)}>Edit</button><button className="btn min-h-0 px-2 py-1" onClick={async () => { await api.toggleCatalog(kind, r.id); toast.success('Status ozgardi'); load(pagination.page); }}>Toggle</button><button className="btn btn-danger min-h-0 px-2 py-1" onClick={() => remove(r)}>Del</button></div> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-black">{title}</h1><p className="text-sm text-slate-400">Narx, status va katalog elementlarini boshqarish.</p></div>
        <button className="btn btn-primary" onClick={() => setForm({ id: `${itemType}_${Date.now()}`, itemType, name: '', icon: '', imageUrl: '', description: '', rarity: 'common', priceCoins: 0, priceGold: 0, enabled: true, isNew: true })}>+ Yangi</button>
      </div>
      <div className="card flex flex-wrap gap-3 p-4">
        <input className="h-10 min-w-[260px] flex-1 px-3" placeholder="Qidirish..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={() => load(1)}>Qidirish</button>
      </div>
      <DataTable rows={rows} columns={columns} loading={loading} pagination={pagination} onPageChange={load} />
      <Modal open={!!form} title={form?.isNew ? 'Yangi element' : 'Elementni tahrirlash'} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Bekor</button><button className="btn btn-primary" onClick={save}>Saqlash</button></>}>
        {form && <div className="grid gap-4 md:grid-cols-2">
          <Field label="ID"><input className="h-10 w-full px-3" value={form.id} disabled={!form.isNew} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} /></Field>
          <Field label="Nomi"><input className="h-10 w-full px-3" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <div className="md:col-span-2"><AssetUpload label="Rasm / preview" category={kind} value={form.imageUrl || form.image_url || ''} onChange={(url) => setForm((f) => ({ ...f, imageUrl: url }))} /></div>
          <Field label="Icon"><input className="h-10 w-full px-3" value={form.icon || ''} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} /></Field>
          <Field label="Tavsif"><input className="h-10 w-full px-3" value={form.description || ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
          <Field label="Rarelik"><select className="h-10 w-full px-3" value={form.rarity} onChange={(e) => setForm((f) => ({ ...f, rarity: e.target.value }))}><option value="common">Common</option><option value="rare">Rare</option><option value="epic">Epic</option><option value="legendary">Legendary</option></select></Field>
          <Field label="Coins"><input type="number" className="h-10 w-full px-3" value={form.priceCoins} onChange={(e) => setForm((f) => ({ ...f, priceCoins: e.target.value }))} /></Field>
          <Field label="Gold"><input type="number" className="h-10 w-full px-3" value={form.priceGold} onChange={(e) => setForm((f) => ({ ...f, priceGold: e.target.value }))} /></Field>
          <label className="flex items-center gap-3 md:col-span-2"><input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} /> Aktiv</label>
        </div>}
      </Modal>
    </div>
  );
}

function Field({ label, children }) {
  return <label><span className="field-label">{label}</span>{children}</label>;
}
