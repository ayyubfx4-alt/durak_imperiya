import React, { useMemo, useState } from 'react';

export default function DataTable({
  rows = [],
  columns = [],
  loading = false,
  pagination,
  onPageChange,
  selected = [],
  onSelectedChange,
  rowKey = (row, index) => row.id ?? row.key ?? `${index}`,
}) {
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * (sort.dir === 'asc' ? 1 : -1);
    });
  }, [rows, sort]);
  const selectable = !!onSelectedChange;
  const toggleAll = () => {
    const ids = sorted.map((row, index) => rowKey(row, index));
    const all = ids.every((id) => selectedSet.has(id));
    onSelectedChange(all ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  };
  const toggleOne = (id) => {
    onSelectedChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-[#181820] text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              {selectable && (
                <th className="w-10 px-3 py-3">
                  <input type="checkbox" checked={sorted.length > 0 && sorted.every((row) => selectedSet.has(rowKey(row)))} onChange={toggleAll} />
                </th>
              )}
              {columns.map((col) => (
                <th key={col.key} className={col.className || 'px-4 py-3'}>
                  <button
                    className="flex items-center gap-1 font-bold uppercase"
                    onClick={() => col.sortable && setSort((cur) => ({ key: col.key, dir: cur.key === col.key && cur.dir === 'asc' ? 'desc' : 'asc' }))}
                  >
                    {col.label}
                    {col.sortable && <span className="text-[#f5a623]">{sort.key === col.key ? (sort.dir === 'asc' ? '^' : 'v') : '-'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 6 }).map((_, idx) => (
              <tr key={idx} className="border-t border-[#1e1e2e]">
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-3">
                  <div className="skeleton h-8 rounded" />
                </td>
              </tr>
            ))}
            {!loading && sorted.map((row, index) => {
              const id = rowKey(row, index);
              return (
                <tr key={id} className="border-t border-[#1e1e2e] hover:bg-white/[.025]">
                  {selectable && (
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selectedSet.has(id)} onChange={() => toggleOne(id)} />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={col.cellClassName || 'px-4 py-3'}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-10 text-center text-slate-500">
                  Ma'lumot topilmadi
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1e1e2e] px-4 py-3 text-sm text-slate-400">
          <span>{pagination.total || 0} ta yozuv</span>
          <div className="flex gap-2">
            <button className="btn min-h-0 px-3 py-1.5" disabled={pagination.page <= 1} onClick={() => onPageChange?.(pagination.page - 1)}>Oldingi</button>
            <span className="px-2 py-1.5">{pagination.page} / {pagination.pages}</span>
            <button className="btn min-h-0 px-3 py-1.5" disabled={pagination.page >= pagination.pages} onClick={() => onPageChange?.(pagination.page + 1)}>Keyingi</button>
          </div>
        </div>
      )}
    </div>
  );
}
