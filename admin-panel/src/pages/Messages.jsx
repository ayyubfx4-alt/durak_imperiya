import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Messages() {
  const [tab, setTab] = useState('broadcast');
  const [form, setForm] = useState({ title: '', body: '', targetGroup: 'all', type: 'both' });
  const [direct, setDirect] = useState({ userId: '', message: '', type: 'in-app' });
  const [history, setHistory] = useState([]);
  const [inbox, setInbox] = useState([]);
  const toast = useToast();

  async function load() {
    try {
      const [h, i] = await Promise.all([api.broadcastHistory(), api.inbox()]);
      setHistory(h);
      setInbox(i);
    } catch (err) { toast.error(err.message); }
  }

  useEffect(() => { load(); }, []);

  async function sendBroadcast() {
    try {
      await api.sendBroadcast(form);
      toast.success('Broadcast yuborildi');
      setForm({ title: '', body: '', targetGroup: 'all', type: 'both' });
      load();
    } catch (err) { toast.error(err.message); }
  }

  async function sendDirect() {
    try {
      await api.sendToUser(direct);
      toast.success('Userga xabar yuborildi');
      setDirect({ userId: '', message: '', type: 'in-app' });
      load();
    } catch (err) { toast.error(err.message); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black">Xabarlar</h1>
        <p className="text-sm text-slate-400">Broadcast, bitta userga xabar, inbox va yuborilganlar tarixi.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {['broadcast', 'direct', 'inbox', 'history'].map((x) => <button key={x} className={`btn ${tab === x ? 'btn-primary' : ''}`} onClick={() => setTab(x)}>{x}</button>)}
      </div>
      {tab === 'broadcast' && (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="card space-y-4 p-4">
            <input className="h-10 w-full px-3" placeholder="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <textarea className="min-h-32 w-full p-3" placeholder="Message" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
            <div className="grid gap-3 md:grid-cols-2">
              <select className="h-10 px-3" value={form.targetGroup} onChange={(e) => setForm((f) => ({ ...f, targetGroup: e.target.value }))}>
                <option value="all">All</option>
                <option value="active">Active last 7d</option>
                <option value="premium">Premium</option>
              </select>
              <select className="h-10 px-3" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="push">Push</option>
                <option value="in-app">In-app</option>
                <option value="both">Both</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={sendBroadcast}>Yuborish</button>
          </div>
          <Preview title={form.title} body={form.body} />
        </div>
      )}
      {tab === 'direct' && (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="card space-y-4 p-4">
            <input className="h-10 w-full px-3" placeholder="User ID" value={direct.userId} onChange={(e) => setDirect((f) => ({ ...f, userId: e.target.value }))} />
            <textarea className="min-h-32 w-full p-3" placeholder="Xabar" value={direct.message} onChange={(e) => setDirect((f) => ({ ...f, message: e.target.value }))} />
            <select className="h-10 px-3" value={direct.type} onChange={(e) => setDirect((f) => ({ ...f, type: e.target.value }))}>
              <option value="push">Push</option>
              <option value="in-app">In-app</option>
              <option value="both">Both</option>
            </select>
            <button className="btn btn-primary" onClick={sendDirect}>Userga yuborish</button>
          </div>
          <Preview title="Direct message" body={direct.message} />
        </div>
      )}
      {tab === 'inbox' && <DataTable rows={inbox} columns={[
        { key: 'username', label: 'User' },
        { key: 'title', label: 'Title' },
        { key: 'status', label: 'Status' },
        { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
        { key: 'actions', label: 'Amallar', render: (r) => <button className="btn min-h-0 px-2 py-1" onClick={async () => { await api.markInboxRead(r.id); toast.success('Read'); load(); }}>Read</button> },
      ]} />}
      {tab === 'history' && <DataTable rows={history} columns={[
        { key: 'title', label: 'Title' },
        { key: 'audience', label: 'Audience' },
        { key: 'type', label: 'Type' },
        { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
      ]} />}
    </div>
  );
}

function Preview({ title, body }) {
  return (
    <div className="card p-4">
      <div className="mb-2 text-sm text-slate-400">Mobile preview</div>
      <div className="rounded-2xl border border-[#1e1e2e] bg-black p-4">
        <div className="font-bold">{title || 'Title'}</div>
        <p className="mt-2 text-sm text-slate-300">{body || 'Message preview'}</p>
      </div>
    </div>
  );
}
