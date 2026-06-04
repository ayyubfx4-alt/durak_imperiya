import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Rooms() {
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  async function load() {
    try {
      setLoading(true);
      setRows(await api.rooms());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); const timer = setInterval(load, 5000); return () => clearInterval(timer); }, []);
  async function close(code) {
    if (!await confirm({ title: 'Xonani yopish', message: `${code} majburiy yopilsinmi?`, danger: true })) return;
    try { await api.closeRoom(code); toast.success('Xona yopildi'); load(); } catch (err) { toast.error(err.message); }
  }
  async function open(code) { try { setDetail(await api.roomDetail(code)); } catch (err) { toast.error(err.message); } }
  async function cleanupStaleRooms() {
    if (!await confirm({ title: 'Stale xonalarni tozalash', message: 'Tugagan yoki real o\'yinchisi qolmagan lokal xonalar serverdan olib tashlanadi.', danger: true })) return;
    setCleaning(true);
    try {
      const result = await api.cleanupRooms();
      toast.success(`${result.count || 0} ta xona tozalandi`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Xonalar tozalanmadi');
    } finally {
      setCleaning(false);
    }
  }
  async function kick(code, userId) {
    if (!await confirm({ title: 'Playerni chiqarish', message: `${userId} xonadan chiqarilsinmi?`, danger: true })) return;
    try {
      await api.kickPlayer(code, userId);
      toast.success('Player xonadan chiqarildi');
      await load();
      try { setDetail(await api.roomDetail(code)); } catch { setDetail(null); }
    } catch (err) {
      toast.error(err.message || 'Player chiqarilmadi');
    }
  }
  const totalPlayers = rows.reduce((sum, row) => sum + Number(row.realPlayers || 0), 0);
  const playing = rows.filter((row) => row.phase === 'playing').length;
  const lobby = rows.filter((row) => row.phase === 'lobby').length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">Live rooms</h1>
          <p className="text-sm text-slate-400">Faqat aktiv xonalar, player nazorati va server tozalash.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={load} disabled={loading}>Yangilash</button>
          <button className="btn btn-danger" onClick={cleanupStaleRooms} disabled={cleaning}>
            {cleaning ? 'Tozalanmoqda...' : 'Stale xonalarni tozalash'}
          </button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <RoomMetric label="Aktiv xonalar" value={rows.length} />
        <RoomMetric label="Playing" value={playing} tone="purple" />
        <RoomMetric label="Lobby" value={lobby} />
        <RoomMetric label="Real playerlar" value={totalPlayers} tone="green" />
      </div>
      <DataTable loading={loading} rows={rows} rowKey={(row) => row.code} columns={[{ key: 'code', label: 'Room', render: (r) => <button className="font-bold text-[#f5a623]" onClick={() => open(r.code)}>{r.code}</button> }, { key: 'mode', label: 'Mode' }, { key: 'phase', label: 'Status', render: (r) => <RoomStatus status={r.phase} /> }, { key: 'realPlayers', label: 'Players', render: (r) => `${r.realPlayers || 0}/${r.maxPlayers || '-'}` }, { key: 'stake', label: 'Stake' }, { key: 'instance', label: 'Instance' }, { key: 'actions', label: 'Amallar', render: (r) => <button className="btn btn-danger min-h-0 px-2 py-1" onClick={() => close(r.code)}>Force close</button> }]} />
      <Modal open={!!detail} title={`Room ${detail?.code || ''}`} onClose={() => setDetail(null)} wide>
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <RoomMetric label="Status" value={detail?.phase || '-'} compact />
            <RoomMetric label="Deck" value={detail?.deckLeft ?? 0} compact />
            <RoomMetric label="Trump" value={detail?.trump || '-'} compact />
            <RoomMetric label="Deadline" value={detail?.turnDeadline ? new Date(detail.turnDeadline).toLocaleTimeString() : '-'} compact />
          </div>
          <div className="rounded-lg border border-[#252538] overflow-hidden">
            <div className="border-b border-[#252538] bg-[#181820] px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-400">Seats</div>
            {(detail?.seats || []).map((seat, index) => (
              <div key={seat?.id || index} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#252538] px-4 py-3 text-sm last:border-b-0">
                <div>
                  <div className="font-bold">{seat ? `@${seat.username || seat.id}` : `Seat ${index + 1}`}</div>
                  <div className="text-xs text-slate-500">{seat ? `${seat.isBot ? 'Bot' : 'Player'} | ${seat.handSize || 0} karta` : 'Bo\'sh joy'}</div>
                </div>
                {seat && !seat.isBot && (
                  <button className="btn btn-danger min-h-0 px-2 py-1" onClick={() => kick(detail.code, seat.id)}>Kick</button>
                )}
              </div>
            ))}
            {!(detail?.seats || []).length && <div className="px-4 py-6 text-center text-slate-500">Seat topilmadi</div>}
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-bold text-[#f5a623]">Texnik JSON</summary>
            <pre className="mt-3 max-h-[40vh] overflow-auto rounded bg-black/40 p-4 text-xs text-slate-300">{JSON.stringify(detail, null, 2)}</pre>
          </details>
        </div>
      </Modal>
    </div>
  );
}

function RoomMetric({ label, value, tone = 'gold', compact = false }) {
  const colors = {
    gold: 'text-[#f5a623]',
    green: 'text-emerald-300',
    purple: 'text-purple-300',
  };
  return (
    <div className={`rounded-lg border border-[#252538] bg-[#13131a] ${compact ? 'p-3' : 'p-4'}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`${compact ? 'text-lg' : 'text-2xl'} mt-1 font-black ${colors[tone] || colors.gold}`}>{value}</div>
    </div>
  );
}

function RoomStatus({ status }) {
  const live = status === 'playing';
  return <span className={`rounded-full border px-2 py-1 text-xs font-bold ${live ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/50 bg-amber-500/10 text-amber-200'}`}>{status || '-'}</span>;
}
