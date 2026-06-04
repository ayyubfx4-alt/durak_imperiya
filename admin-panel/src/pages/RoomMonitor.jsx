// Room Monitor — real-time view of every active room across all backend
// instances. When Redis adapter is enabled this reads from the shared
// Redis registry (durak:rooms); otherwise it falls back to in-memory data
// from the current instance.
//
// Each row shows live state: phase, stake, seats (real vs bot), turn
// deadline, host, mode. Admin can force-close a room (kick all + refund
// stakes) or watch the room's state in detail.
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const PHASE_COLOR = {
  lobby:   '#64748b',
  playing: '#10b981',
  ended:   '#ef4444',
};

export default function RoomMonitor() {
  const [rooms, setRooms] = useState([]);
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  async function refresh() {
    try {
      const list = await api.roomMonitor();
      setRooms(list || []);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  async function viewDetail(code) {
    setSelected(code);
    setDetail(null);
    try {
      const d = await api.roomDetail(code);
      setDetail(d);
    } catch (e) { setDetail({ error: e.message }); }
  }

  async function closeRoom(code) {
    if (!confirm(`Force-close room ${code}? All stakes will be refunded.`)) return;
    setBusy(code);
    try {
      await api.roomForceClose(code);
      await refresh();
    } catch (e) { alert(e.message); }
    finally { setBusy(null); }
  }

  const filtered = rooms.filter((r) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return r.code.toLowerCase().includes(f)
      || (r.host || '').toLowerCase().includes(f)
      || (r.mode || '').toLowerCase().includes(f);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Room Monitor</h1>
        <input
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm"
          placeholder="Filter by code / host / mode…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {err && <div className="text-red-400 mb-3">{err}</div>}

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Stat label="Total rooms" value={rooms.length} />
        <Stat label="Playing" value={rooms.filter((r) => r.phase === 'playing').length} accent="#10b981" />
        <Stat label="Lobby" value={rooms.filter((r) => r.phase === 'lobby').length} accent="#64748b" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Phase</th>
                <th className="text-left px-3 py-2">Mode</th>
                <th className="text-left px-3 py-2">Seats</th>
                <th className="text-left px-3 py-2">Stake</th>
                <th className="text-left px-3 py-2">Host</th>
                <th className="text-center px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan="7" className="px-3 py-8 text-slate-500 text-center">No active rooms</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.code}
                    className={`border-t border-slate-800 cursor-pointer hover:bg-slate-800/40 ${selected === r.code ? 'bg-slate-800/60' : ''}`}
                    onClick={() => viewDetail(r.code)}>
                  <td className="px-3 py-2 font-mono">{r.code}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded"
                          style={{ background: PHASE_COLOR[r.phase] || '#444', color: 'white' }}>
                      {r.phase}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{r.mode || 'classic'}</td>
                  <td className="px-3 py-2">{r.realPlayers || 0}<span className="text-slate-500">/</span>{r.maxPlayers || '?'} <span className="text-slate-500 text-xs">({r.bots || 0} bot)</span></td>
                  <td className="px-3 py-2">🪙 {(r.stake || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-slate-300 truncate max-w-[100px]">{r.host || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      className="text-red-400 hover:text-red-300 text-xs"
                      disabled={busy === r.code}
                      onClick={(e) => { e.stopPropagation(); closeRoom(r.code); }}>
                      {busy === r.code ? '…' : 'Close'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <h3 className="text-lg font-semibold mb-3">Detail {selected ? `· ${selected}` : ''}</h3>
          {!selected && <div className="text-slate-500 text-sm">Select a room to view live state.</div>}
          {selected && !detail && <div className="text-slate-500 text-sm">Loading…</div>}
          {detail?.error && <div className="text-red-400 text-sm">{detail.error}</div>}
          {detail && !detail.error && (
            <div className="text-xs space-y-2 font-mono">
              <div className="text-slate-400">Phase: <span className="text-white">{detail.phase}</span></div>
              <div className="text-slate-400">Trump: <span className="text-cyan-400">{detail.trump || '—'}</span></div>
              <div className="text-slate-400">Deck left: {detail.deckLeft ?? '—'}</div>
              <div className="text-slate-400">Turn ends: {detail.turnDeadline ? new Date(detail.turnDeadline).toLocaleTimeString() : '—'}</div>
              <div className="mt-2 text-slate-400">Seats:</div>
              <ul className="space-y-0.5 pl-2">
                {(detail.seats || []).map((s, i) => (
                  <li key={i} className={s ? '' : 'text-slate-600'}>
                    {s ? (
                      <>
                        <span className="text-slate-300">#{i}</span>{' '}
                        <span className={s.isBot ? 'text-purple-400' : 'text-emerald-400'}>{s.username}</span>
                        {' '}<span className="text-slate-500">hand={s.handSize ?? '?'} {s.isBot ? '(bot)' : ''}</span>
                      </>
                    ) : 'empty'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 relative overflow-hidden">
      {accent && <div className="absolute top-0 left-0 right-0 h-1" style={{ background: accent }} />}
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
