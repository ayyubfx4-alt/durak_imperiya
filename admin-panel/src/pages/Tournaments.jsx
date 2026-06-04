import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Tournaments() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const [winners, setWinners] = useState(null);
  const [bracket, setBracket] = useState(null);
  const toast = useToast();

  async function load() { try { setRows(await api.tournaments()); } catch (err) { toast.error(err.message); } }
  useEffect(() => { load(); }, []);

  async function save() {
    try {
      await api.createTournament(form);
      toast.success('Turnir yaratildi');
      setForm(null);
      load();
    } catch (err) { toast.error(err.message); }
  }

  async function action(label, fn) {
    try { await fn(); toast.success(label); load(); } catch (err) { toast.error(err.message); }
  }

  async function openWinners(row) {
    try {
      const existing = await api.tournamentWinners(row.id);
      setWinners({
        tournament: row,
        existing,
        rows: [
          { placement: 1, userId: existing.find((x) => Number(x.placement) === 1)?.user_id || '' },
          { placement: 2, userId: existing.find((x) => Number(x.placement) === 2)?.user_id || '' },
          { placement: 3, userId: existing.find((x) => Number(x.placement) === 3)?.user_id || '' },
        ],
      });
    } catch (err) { toast.error(err.message); }
  }

  async function saveWinners() {
    const rowsToSend = winners.rows.filter((row) => row.userId);
    if (!rowsToSend.length) return toast.error('Kamida bitta g\'olib userId kerak');
    await action('G\'oliblar saqlandi', () => api.setTournamentWinners(winners.tournament.id, rowsToSend));
    setWinners(null);
  }

  async function openBracket(row) {
    try { setBracket({ tournament: row, data: await api.tournamentBracket(row.id) }); } catch (err) { toast.error(err.message); }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Turnirlar</h1>
          <p className="text-sm text-slate-400">Create, start/stop, mukofot, bracket va g'oliblarni tanlash.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setForm({ name: '', startsAt: '', maxPlayers: 32, entryGoldCoins: 35, prizeFirstGoldCoins: 150, prizeSecondGoldCoins: 75, prizeThirdGoldCoins: 35, tableSize: 2, bluffEnabled: false })}>+ Create</button>
      </div>
      <DataTable rows={rows} columns={[
        { key: 'name', label: 'Name' },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status}>{r.status}</StatusBadge> },
        { key: 'max_players', label: 'Max' },
        { key: 'entry_gold_coins', label: 'Entry gold' },
        { key: 'prize_first_gold_coins', label: '1-o\'rin' },
        { key: 'starts_at', label: 'Start', render: (r) => r.starts_at ? new Date(r.starts_at).toLocaleString() : '-' },
        { key: 'actions', label: 'Amallar', render: (r) => (
          <div className="flex flex-wrap gap-2">
            <button className="btn min-h-0 px-2 py-1" onClick={() => action('Started', () => api.startTournament(r.id))}>Start</button>
            <button className="btn min-h-0 px-2 py-1" onClick={() => action('Ended', () => api.endTournament(r.id))}>End</button>
            <button className="btn min-h-0 px-2 py-1" onClick={() => openBracket(r)}>Bracket</button>
            <button className="btn min-h-0 px-2 py-1" onClick={() => openWinners(r)}>Winners</button>
            <button className="btn btn-danger min-h-0 px-2 py-1" onClick={() => action('Cancelled', () => api.cancelTournament(r.id))}>Cancel</button>
          </div>
        ) },
      ]} />
      <Modal open={!!form} title="Create tournament" onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Bekor</button><button className="btn btn-primary" onClick={save}>Create</button></>}>
        {form && <div className="grid gap-4 md:grid-cols-2">
          <input className="h-10 px-3" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input className="h-10 px-3" type="datetime-local" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
          <input className="h-10 px-3" type="number" value={form.maxPlayers} onChange={(e) => setForm((f) => ({ ...f, maxPlayers: Number(e.target.value) }))} />
          <input className="h-10 px-3" type="number" value={form.entryGoldCoins} onChange={(e) => setForm((f) => ({ ...f, entryGoldCoins: Number(e.target.value) }))} />
          <input className="h-10 px-3" type="number" value={form.prizeFirstGoldCoins} onChange={(e) => setForm((f) => ({ ...f, prizeFirstGoldCoins: Number(e.target.value) }))} />
          <input className="h-10 px-3" type="number" value={form.prizeSecondGoldCoins} onChange={(e) => setForm((f) => ({ ...f, prizeSecondGoldCoins: Number(e.target.value) }))} />
          <input className="h-10 px-3" type="number" value={form.prizeThirdGoldCoins} onChange={(e) => setForm((f) => ({ ...f, prizeThirdGoldCoins: Number(e.target.value) }))} />
          <select className="h-10 px-3" value={form.tableSize} onChange={(e) => setForm((f) => ({ ...f, tableSize: Number(e.target.value) }))}>
            {[2, 3, 4, 6].map((n) => <option key={n} value={n}>{n} player</option>)}
          </select>
        </div>}
      </Modal>
      <Modal open={!!winners} title="G'oliblarni tanlash" onClose={() => setWinners(null)} footer={<><button className="btn" onClick={() => setWinners(null)}>Bekor</button><button className="btn btn-primary" onClick={saveWinners}>Saqlash</button></>}>
        {winners && <div className="space-y-3">
          {winners.rows.map((row, idx) => (
            <div key={row.placement} className="grid grid-cols-[80px_1fr] items-center gap-3">
              <strong>{row.placement}-o'rin</strong>
              <input className="h-10 px-3" placeholder="User ID" value={row.userId} onChange={(e) => setWinners((cur) => {
                const next = [...cur.rows];
                next[idx] = { ...next[idx], userId: e.target.value };
                return { ...cur, rows: next };
              })} />
            </div>
          ))}
        </div>}
      </Modal>
      <Modal open={!!bracket} title="Tournament bracket" wide onClose={() => setBracket(null)}>
        <pre className="max-h-[60vh] overflow-auto rounded bg-black/40 p-4 text-xs text-slate-300">{JSON.stringify(bracket?.data || {}, null, 2)}</pre>
      </Modal>
    </div>
  );
}
