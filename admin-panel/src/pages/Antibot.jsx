import { useState, useEffect } from 'react';
import { api } from '../api.js';

const CATEGORIES = ['bot', 'suspicious', 'watch'];
const CAT_COLOR  = { bot: 'text-red-400', suspicious: 'text-yellow-400', watch: 'text-blue-400' };
const CAT_LABEL  = { bot: '🤖 Bot', suspicious: '⚠️ Shubhali', watch: '👁 Kuzatuv' };

export default function Antibot() {
  const [list, setList]       = useState([]);
  const [filter, setFilter]   = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg]         = useState('');

  async function load(cat) {
    setLoading(true);
    try {
      const data = await api.antibot(cat);
      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      setList([]);
      setMsg(`Xato: ${e.message}`);
    }
    setSelected(new Set());
    setLoading(false);
  }

  useEffect(() => { load(filter); }, [filter]);

  function toggleSelect(userId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === list.length) setSelected(new Set());
    else setSelected(new Set(list.map(u => u.user_id)));
  }

  async function clearScores() {
    if (!selected.size) return;
    if (!window.confirm(`${selected.size} ta foydalanuvchi antibot skorini o'chirish?`)) return;
    for (const id of selected) await api.antibotClearUser(id);
    setMsg(`✓ ${selected.size} ta skor o'chirildi`);
    load(filter);
  }

  async function deleteUsers() {
    if (!selected.size) return;
    if (!window.confirm(`${selected.size} ta foydalanuvchini BAZADAN O'CHIRISH? Bu qaytarib bo'lmaydi!`)) return;
    for (const id of selected) await api.antibotDeleteUser(id);
    setMsg(`✓ ${selected.size} ta foydalanuvchi o'chirildi`);
    load(filter);
  }

  async function bulkDelete(cat) {
    if (!window.confirm(`Barcha "${cat}" foydalanuvchilarni bazadan o'chirasizmi?`)) return;
    const r = await api.antibotBulkDelete(cat);
    setMsg(`✓ ${r.affected ?? 0} ta o'chirildi`);
    load(filter);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 text-white sm:p-6">
      <h1 className="text-2xl font-bold mb-1">🤖 Antibot Panel</h1>
      <p className="text-gray-400 text-sm mb-5">
        Tizim botlari (is_bot=TRUE) bu ro'yxatda ko'rinmaydi.
      </p>

      {msg && (
        <div className="bg-green-900 border border-green-600 text-green-300 rounded-lg px-4 py-2 mb-4 text-sm">
          {msg} <button onClick={() => setMsg('')} className="ml-2 text-green-500">✕</button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {['all', ...CATEGORIES].map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all ${
              filter === cat
                ? 'bg-yellow-500 text-black border-yellow-500'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-yellow-600'
            }`}
          >
            {cat === 'all' ? '📋 Barchasi' : CAT_LABEL[cat]}
          </button>
        ))}
        <div className="flex w-full flex-wrap gap-2 lg:ml-auto lg:w-auto">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => bulkDelete(cat)}
              className="px-3 py-1 text-xs rounded border border-red-700 text-red-400 hover:bg-red-900 transition"
            >
              Barcha {CAT_LABEL[cat]}ni o'chirish
            </button>
          ))}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="checkbox" checked={selected.size === list.length && list.length > 0}
          onChange={selectAll} className="w-4 h-4 accent-yellow-400" />
        <span className="text-sm text-gray-400">{selected.size} ta tanlangan</span>
        <button onClick={clearScores}
          className="px-3 py-1 text-xs rounded bg-blue-900 border border-blue-700 text-blue-300 hover:bg-blue-800 disabled:opacity-40"
          disabled={!selected.size}>Skor o'chirish</button>
        <button onClick={deleteUsers}
          className="px-3 py-1 text-xs rounded bg-red-900 border border-red-700 text-red-300 hover:bg-red-800 disabled:opacity-40"
          disabled={!selected.size}>Foydalanuvchini o'chirish</button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Yuklanmoqda…</div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 text-gray-600">Hech kim topilmadi</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-800">
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <th className="p-3 w-8"></th>
                <th className="p-3 text-left">Foydalanuvchi</th>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-center">Ball</th>
                <th className="p-3 text-center">Kategoriya</th>
                <th className="p-3 text-left">Sabab</th>
                <th className="p-3 text-left">Oxirgi yangilanish</th>
              </tr>
            </thead>
            <tbody>
              {list.map(u => (
                <tr key={u.user_id}
                  className={`border-t border-gray-800 hover:bg-gray-900 transition cursor-pointer ${selected.has(u.user_id) ? 'bg-yellow-950' : ''}`}
                  onClick={() => toggleSelect(u.user_id)}>
                  <td className="p-3">
                    <input type="checkbox" checked={selected.has(u.user_id)}
                      onChange={() => {}} className="w-4 h-4 accent-yellow-400 pointer-events-none" />
                  </td>
                  <td className="p-3 font-semibold">{u.username}</td>
                  <td className="p-3 text-gray-400">{u.email}</td>
                  <td className="p-3 text-center">
                    <span className={`font-bold text-lg ${u.score >= 90 ? 'text-red-400' : u.score >= 70 ? 'text-yellow-400' : 'text-blue-400'}`}>
                      {u.score}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <span className={`text-sm font-bold ${CAT_COLOR[u.category] || 'text-gray-400'}`}>
                      {CAT_LABEL[u.category] || u.category}
                    </span>
                  </td>
                  <td className="p-3 text-gray-400 max-w-xs truncate text-xs">
                    {Object.entries(u.details || {}).map(([k, v]) =>
                      <span key={k} className="mr-2">{k}: {v?.pts ?? JSON.stringify(v)}</span>
                    )}
                  </td>
                  <td className="p-3 text-gray-500 text-xs">
                    {u.last_updated ? new Date(u.last_updated).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="md:hidden">
            {list.map((u) => (
              <article
                key={u.user_id}
                className={`border-b border-gray-800 p-3 text-sm last:border-b-0 ${selected.has(u.user_id) ? 'bg-yellow-950' : ''}`}
                onClick={() => toggleSelect(u.user_id)}
              >
                <div className="mb-3 flex items-start gap-3">
                  <input type="checkbox" checked={selected.has(u.user_id)}
                    onChange={() => {}} className="mt-1 h-4 w-4 flex-shrink-0 accent-yellow-400 pointer-events-none" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white">{u.username || u.user_id}</div>
                    <div className="truncate text-xs text-gray-400">{u.email || '-'}</div>
                  </div>
                  <span className={`font-bold ${u.score >= 90 ? 'text-red-400' : u.score >= 70 ? 'text-yellow-400' : 'text-blue-400'}`}>
                    {u.score}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className={`text-sm font-bold ${CAT_COLOR[u.category] || 'text-gray-400'}`}>
                    {CAT_LABEL[u.category] || u.category}
                  </div>
                  <div className="break-words text-xs text-gray-400">
                    {Object.entries(u.details || {}).map(([k, v]) =>
                      <span key={k} className="mr-2">{k}: {v?.pts ?? JSON.stringify(v)}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {u.last_updated ? new Date(u.last_updated).toLocaleString() : '-'}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
