import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import AssetUpload from '../components/AssetUpload.jsx';
import { assetUrl } from '../api.js';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const blank = { uniqueId: '', name: '', imageUrl: '', rarity: 'rare', type: 'static', status: 'active', priceGold: 0, priceUzs: 0, soldCount: 0 };
const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

export default function Stickers() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 25 });
  const [filters, setFilters] = useState({ search: '', rarity: '', type: '', status: '' });
  const [form, setForm] = useState(null);
  const [owners, setOwners] = useState(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  async function load(page = 1) {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([api.stickers({ ...filters, page, limit: pagination.limit }), api.stickerStats()]);
      setRows(list.data || []);
      setPagination(list.pagination || pagination);
      setStats(s);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(1); }, []);

  const normalizedForm = useMemo(() => form ? ({
    ...blank,
    ...form,
    uniqueId: form.uniqueId || form.unique_id || '',
    imageUrl: form.imageUrl || form.image_url || '',
    priceGold: form.priceGold ?? form.price_gold ?? 0,
    priceUzs: form.priceUzs ?? form.price_uzs ?? 0,
    soldCount: form.soldCount ?? form.sold_count ?? 0,
  }) : null, [form]);

  function edit(row = null) {
    setForm(row || { ...blank, uniqueId: `STK_${Date.now().toString().slice(-5)}` });
  }
  async function save() {
    const payload = normalizedForm;
    if (!payload.name || !payload.uniqueId) return toast.error('Nomi va unique ID kerak');
    if (!payload.imageUrl) return toast.error('Stiker rasmi kerak');
    try {
      if (form.id) await api.updateSticker(form.id, payload);
      else await api.createSticker(payload);
      toast.success('Stiker saqlandi');
      setForm(null);
      await load(form.id ? pagination.page : 1);
    } catch (err) { toast.error(err.message); }
  }
  async function remove(row) {
    if (!await confirm({ title: 'Stiker ochirish', message: `${row.name} ochirilsinmi?`, danger: true })) return;
    try { await api.deleteSticker(row.id); toast.success('Stiker ochirildi'); await load(pagination.page); }
    catch (err) { toast.error(err.message); }
  }
  async function viewOwners(row) {
    try { setOwners({ sticker: row, rows: await api.stickerOwners(row.id) }); }
    catch (err) { toast.error(err.message); }
  }
  async function toggle(row) {
    try { await api.toggleSticker(row.id); toast.success('Status ozgardi'); await load(pagination.page); }
    catch (err) { toast.error(err.message); }
  }

  const columns = [
    { key: 'name', label: 'Stiker', sortable: true, render: (r) => <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center overflow-hidden rounded border border-[#1e1e2e] bg-black/30">{r.imageUrl || r.image_url ? <img src={assetUrl(r.imageUrl || r.image_url)} className="h-full w-full object-cover" /> : <span className="text-xs text-slate-500">IMG</span>}</div><div><div className="font-bold">{r.name}</div><div className="text-xs text-slate-500">{r.uniqueId || r.unique_id}</div></div></div> },
    { key: 'rarity', label: 'Rarelik', render: (r) => <StatusBadge status={r.rarity}>{String(r.rarity).toUpperCase()}</StatusBadge> },
    { key: 'type', label: 'Turi' },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status}>{r.status}</StatusBadge> },
    { key: 'priceGold', label: 'Gold', sortable: true, render: (r) => fmt(r.priceGold ?? r.price_gold) },
    { key: 'priceUzs', label: 'UZS', sortable: true, render: (r) => fmt(r.priceUzs ?? r.price_uzs) },
    { key: 'soldCount', label: 'Sotilgan', sortable: true, render: (r) => fmt(r.soldCount ?? r.sold_count) },
    { key: 'actions', label: 'Amallar', render: (r) => <div className="flex flex-wrap gap-2"><button className="btn min-h-0 px-2 py-1" onClick={() => viewOwners(r)}>Owners</button><button className="btn min-h-0 px-2 py-1" onClick={() => edit(r)}>Edit</button><button className="btn min-h-0 px-2 py-1" onClick={() => toggle(r)}>Toggle</button><button className="btn btn-danger min-h-0 px-2 py-1" onClick={() => remove(r)}>Del</button></div> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-black">Stikerlar</h1><p className="text-sm text-slate-400">Stiker CRUD, narx, status va egalar ro'yxati.</p></div>
        <button className="btn btn-primary" onClick={() => edit()}>+ Yangi stiker</button>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Jami" value={fmt(stats?.totalStickers)} />
        <StatCard label="Aktiv" value={fmt(stats?.activeStickers)} accent="green" />
        <StatCard label="Noaktiv" value={fmt(stats?.inactiveStickers)} accent="red" />
        <StatCard label="Sotilgan" value={fmt(stats?.totalSold)} accent="purple" />
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-[1fr_160px_160px_160px_auto]">
        <input className="h-10 px-3" placeholder="Qidirish..." value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
        <select className="h-10 px-3" value={filters.rarity} onChange={(e) => setFilters((f) => ({ ...f, rarity: e.target.value }))}><option value="">Rarelik</option><option value="common">Common</option><option value="rare">Rare</option><option value="epic">Epic</option><option value="legendary">Legendary</option></select>
        <select className="h-10 px-3" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}><option value="">Turi</option><option value="static">Static</option><option value="animated">Animated</option></select>
        <select className="h-10 px-3" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}><option value="">Status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <button className="btn btn-primary" onClick={() => load(1)}>Filter</button>
      </div>
      <DataTable rows={rows} columns={columns} loading={loading} pagination={pagination} onPageChange={load} />
      <Modal open={!!form} title={form?.id ? 'Stikerni tahrirlash' : 'Yangi stiker'} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Bekor</button><button className="btn btn-primary" onClick={save}>Saqlash</button></>}>
        {normalizedForm && <StickerForm form={normalizedForm} setForm={setForm} />}
      </Modal>
      <Modal open={!!owners} title={`${owners?.sticker?.name || ''} egalari`} onClose={() => setOwners(null)}>
        <div className="space-y-2">
          {(owners?.rows || []).map((row) => <div key={row.id} className="flex justify-between rounded border border-[#1e1e2e] p-3 text-sm"><span>@{row.username}</span><span className="text-slate-400">{row.quantity} dona</span></div>)}
          {!owners?.rows?.length && <div className="text-center text-slate-500">Hali egasi yo'q</div>}
        </div>
      </Modal>
    </div>
  );
}

function StickerForm({ form, setForm }) {
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Nomi"><input className="h-10 w-full px-3" value={form.name} onChange={(e) => update('name', e.target.value)} /></Field>
      <Field label="Unique ID"><input className="h-10 w-full px-3" value={form.uniqueId} onChange={(e) => update('uniqueId', e.target.value)} /></Field>
      <div className="md:col-span-2"><AssetUpload label="Stiker rasmi" category="stickers" value={form.imageUrl} onChange={(url) => update('imageUrl', url)} /></div>
      <Field label="Rarelik"><select className="h-10 w-full px-3" value={form.rarity} onChange={(e) => update('rarity', e.target.value)}><option value="common">Common</option><option value="rare">Rare</option><option value="epic">Epic</option><option value="legendary">Legendary</option></select></Field>
      <Field label="Turi"><select className="h-10 w-full px-3" value={form.type} onChange={(e) => update('type', e.target.value)}><option value="static">Static</option><option value="animated">Animated</option></select></Field>
      <Field label="Status"><select className="h-10 w-full px-3" value={form.status} onChange={(e) => update('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
      <Field label="Gold narx"><input type="number" className="h-10 w-full px-3" value={form.priceGold} onChange={(e) => update('priceGold', e.target.value)} /></Field>
      <Field label="UZS narx"><input type="number" className="h-10 w-full px-3" value={form.priceUzs} onChange={(e) => update('priceUzs', e.target.value)} /></Field>
    </div>
  );
}

function Field({ label, children }) {
  return <label><span className="field-label">{label}</span>{children}</label>;
}
