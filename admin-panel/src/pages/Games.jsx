import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Games() {
  const [games, setGames] = useState([]);
  useEffect(() => { api.games().then(setGames).catch(() => {}); }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Games</h1>
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-800">
            <tr>
              <th className="text-left px-3 py-2">Room</th>
              <th className="text-left px-3 py-2">Mode</th>
              <th className="text-right px-3 py-2">Stake</th>
              <th className="text-left px-3 py-2">Started</th>
              <th className="text-left px-3 py-2">Ended</th>
              <th className="text-center px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr key={g.id} className="border-t border-slate-800">
                <td className="px-3 py-2 font-mono">{g.room_code}</td>
                <td className="px-3 py-2">{g.mode}</td>
                <td className="px-3 py-2 text-right">🪙 {Number(g.stake).toLocaleString()}</td>
                <td className="px-3 py-2 text-slate-400">{new Date(g.started_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-slate-400">{g.ended_at ? new Date(g.ended_at).toLocaleString() : '—'}</td>
                <td className="px-3 py-2 text-center">
                  {g.is_draw ? 'Draw' : g.winner_id ? 'Win' : g.ended_at ? 'Bot win' : 'Active'}
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
        <div className="md:hidden">
          {games.map((g) => (
            <article key={g.id} className="border-b border-slate-800 p-3 text-sm last:border-b-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-mono font-bold text-[#f5a623]">{g.room_code}</span>
                <span className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300">
                  {g.is_draw ? 'Draw' : g.winner_id ? 'Win' : g.ended_at ? 'Bot win' : 'Active'}
                </span>
              </div>
              <div className="grid grid-cols-[92px_1fr] gap-2 text-slate-300">
                <span className="text-xs uppercase text-slate-500">Mode</span><span>{g.mode}</span>
                <span className="text-xs uppercase text-slate-500">Stake</span><span>{Number(g.stake).toLocaleString()}</span>
                <span className="text-xs uppercase text-slate-500">Started</span><span>{new Date(g.started_at).toLocaleString()}</span>
                <span className="text-xs uppercase text-slate-500">Ended</span><span>{g.ended_at ? new Date(g.ended_at).toLocaleString() : '-'}</span>
              </div>
            </article>
          ))}
          {!games.length && <div className="px-3 py-10 text-center text-slate-500">No games</div>}
        </div>
      </div>
    </div>
  );
}
