import React from 'react';

export default function StatCard({ label, value, hint, accent = 'gold' }) {
  const colors = {
    gold: 'border-[#f5a623]/35 text-[#f5a623]',
    green: 'border-emerald-500/35 text-emerald-300',
    red: 'border-red-500/35 text-red-300',
    purple: 'border-purple-500/35 text-purple-300',
  };
  return (
    <div className={`card border-t-2 p-4 ${colors[accent] || colors.gold}`}>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value ?? '-'}</div>
      {hint && <div className="mt-2 text-xs font-semibold text-emerald-300">{hint}</div>}
    </div>
  );
}
