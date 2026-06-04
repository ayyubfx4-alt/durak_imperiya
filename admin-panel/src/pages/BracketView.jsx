// Tournament Bracket view — visualizes a single-elimination tree. Admin
// can seed the bracket (round 1), record per-match results, or trigger
// the auto-settle prize payout once the final is done.
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useParams, Link } from 'react-router-dom';

function nameOf(side, prefix) {
  return side[`${prefix}_username`] || side[`${prefix}_bot_name`] || (side[`${prefix}_user`] ? side[`${prefix}_user`].slice(0, 8) : '—');
}

export default function BracketView() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData(await api.tournamentBracket(id)); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function seed() {
    setBusy(true);
    try { await api.tournamentSeed(id); await load(); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function recordResult(matchId, winnerEntryId) {
    setBusy(true);
    try { await api.tournamentMatchResult(matchId, winnerEntryId); await load(); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function autoSettle() {
    if (!confirm('Run auto-settle and distribute prizes?')) return;
    setBusy(true);
    try { await api.tournamentAutoSettle(id); await load(); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  if (err) return <div className="text-red-400">{err}</div>;
  if (!data) return <div className="text-slate-400">Loading…</div>;

  const rounds = {};
  for (const m of data.matches) {
    rounds[m.round_no] = rounds[m.round_no] || [];
    rounds[m.round_no].push(m);
  }
  const roundList = Object.keys(rounds).sort((a, b) => Number(a) - Number(b));

  return (
    <div>
      <div className="mb-4">
        <Link to="/tournaments" className="text-sm text-slate-400 hover:text-white">← Back to tournaments</Link>
      </div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{data.tournament.name}</h1>
        <div className="flex gap-2">
          {!data.tournament.bracket_seeded && (
            <button className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg" disabled={busy} onClick={seed}>
              {busy ? '…' : 'Seed bracket'}
            </button>
          )}
          {data.tournament.status === 'finished' && (
            <span className="px-3 py-2 bg-amber-600 text-white rounded-lg">Finished</span>
          )}
          {data.tournament.bracket_seeded && data.tournament.status !== 'finished' && (
            <button className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg" disabled={busy} onClick={autoSettle}>
              Auto-settle
            </button>
          )}
        </div>
      </div>

      <div className="text-sm text-slate-400 mb-4">
        Round {data.tournament.current_round} / {data.tournament.bracket_rounds || '?'} · status:{' '}
        <span className="px-2 py-0.5 rounded bg-slate-800">{data.tournament.status}</span>
      </div>

      <div className="flex gap-6 overflow-x-auto pb-4">
        {roundList.map((r) => (
          <div key={r} className="flex-shrink-0 w-72">
            <h3 className="text-sm font-semibold mb-2 text-slate-400 uppercase tracking-wider">
              Round {r} {Number(r) === Number(data.tournament.bracket_rounds) ? '· FINAL' : ''}
            </h3>
            <div className="space-y-3">
              {rounds[r].map((m) => {
                const winnerA = m.winner_entry_id === m.entry_a_id;
                const winnerB = m.winner_entry_id === m.entry_b_id;
                return (
                  <div key={m.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm">
                    <div className={`flex justify-between items-center py-1 px-2 rounded ${winnerA ? 'bg-emerald-900/40 text-emerald-300' : ''}`}>
                      <span className="truncate">{nameOf(m, 'a')}</span>
                      {m.status !== 'done' && m.entry_a_id && m.entry_b_id && (
                        <button
                          className="text-emerald-400 hover:text-emerald-300 text-xs"
                          disabled={busy}
                          onClick={() => recordResult(m.id, m.entry_a_id)}>
                          ✓
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 text-center my-0.5">vs</div>
                    <div className={`flex justify-between items-center py-1 px-2 rounded ${winnerB ? 'bg-emerald-900/40 text-emerald-300' : ''}`}>
                      <span className="truncate">{nameOf(m, 'b')}</span>
                      {m.status !== 'done' && m.entry_a_id && m.entry_b_id && (
                        <button
                          className="text-emerald-400 hover:text-emerald-300 text-xs"
                          disabled={busy}
                          onClick={() => recordResult(m.id, m.entry_b_id)}>
                          ✓
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 mt-2 flex justify-between">
                      <span>#{m.match_no}</span>
                      <span className={
                        m.status === 'done' ? 'text-emerald-400' :
                        m.status === 'live' ? 'text-amber-400' : 'text-slate-500'
                      }>{m.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
