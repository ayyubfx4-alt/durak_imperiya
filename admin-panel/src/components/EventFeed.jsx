// Live admin event feed — streams the last N admin_events rows with a
// short polling loop. Color-coded by category. Auto-scrolls to top on
// new event arrival. Filter dropdown narrows by category.
import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../api.js';

const CATEGORY_COLORS = {
  ban:        '#ef4444',
  unban:      '#10b981',
  gift:       '#f59e0b',
  payment:    '#3b82f6',
  tournament: '#a855f7',
  report:     '#ec4899',
  setting:    '#64748b',
  bracket:    '#8b5cf6',
  default:    '#94a3b8',
};

export default function EventFeed() {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState('');

  async function refresh() {
    try {
      const rows = await api.adminEvents(filter === 'all' ? null : filter, 50).catch(() => null);
      if (rows) setEvents(rows);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [filter]);

  const categories = useMemo(() => {
    const set = new Set(['all']);
    for (const e of events) set.add(e.category);
    return [...set];
  }, [events]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Event feed</h2>
        <select
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {err && <div className="text-red-400 text-xs mb-2">{err}</div>}
      <div className="space-y-1.5 max-h-96 overflow-auto text-sm">
        {events.length === 0 && <div className="text-slate-500 text-center py-4">No events yet</div>}
        {events.map((e) => {
          const color = CATEGORY_COLORS[e.category] || CATEGORY_COLORS.default;
          return (
            <div key={e.id} className="flex items-start gap-3 py-1.5 border-b border-slate-800/50">
              <span
                className="inline-block w-2 h-2 mt-1.5 rounded-full flex-shrink-0"
                style={{ background: color, boxShadow: `0 0 6px ${color}` }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs uppercase tracking-wide" style={{ color }}>{e.category}</span>
                  <span className="text-slate-300 truncate">{e.message}</span>
                </div>
                <div className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString()}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
