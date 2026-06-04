import React from 'react';

export default function StatusBadge({ status, children }) {
  const key = String(status || children || '').toLowerCase();
  const cls = key.includes('ban') || key.includes('inactive') || key.includes('cancel') || key.includes('down')
    ? 'border-red-500/40 bg-red-500/10 text-red-200'
    : key.includes('warn') || key.includes('scheduled') || key.includes('pending')
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
      : key.includes('admin') || key.includes('premium')
        ? 'border-purple-500/40 bg-purple-500/10 text-purple-100'
        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${cls}`}>
      {children || status || 'active'}
    </span>
  );
}
