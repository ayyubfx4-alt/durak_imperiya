import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Games() {
  const [games, setGames] = useState([]);
  useEffect(() => { api.games().then(setGames).catch(() => {}); }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Games</h1>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
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
    </div>
  );
}
