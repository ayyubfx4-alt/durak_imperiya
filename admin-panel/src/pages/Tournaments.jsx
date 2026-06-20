import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';

const EMPTY_FORM = {
  name: '',
  startsAt: '',
  maxPlayers: 32,
  entryGoldCoins: 35,
  prizeFirstGoldCoins: 150,
  prizeSecondGoldCoins: 75,
  prizeThirdGoldCoins: 35,
  tableSize: 2,
  bluffEnabled: false,
};

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

export default function Tournaments() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [winners, setWinners] = useState(null);
  const [bracket, setBracket] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const toast = useToast();
  const confirm = useConfirm();

  async function load() {
    setLoading(true);
    try {
      const data = await api.tournaments();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.message || 'Turnirlar yuklanmadi');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!form?.name?.trim()) return toast.error('Turnir nomi kerak');
    setSaving(true);
    try {
      await api.createTournament({
        name: form.name.trim(),
        startsAt: form.startsAt || null,
        maxPlayers: Number(form.maxPlayers) || 32,
        entryGoldCoins: Number(form.entryGoldCoins) || 35,
        prizeFirstGoldCoins: Number(form.prizeFirstGoldCoins) || 150,
        prizeSecondGoldCoins: Number(form.prizeSecondGoldCoins) || 75,
        prizeThirdGoldCoins: Number(form.prizeThirdGoldCoins) || 35,
        tableSize: Number(form.tableSize) || 2,
        bluffEnabled: Boolean(form.bluffEnabled),
      });
      toast.success('Turnir yaratildi');
      setForm(null);
      load();
    } catch (err) {
      toast.error(err.message || 'Turnir yaratilmadi');
    } finally {
      setSaving(false);
    }
  }

  function setActionBusy(id, key, val) {
    setActionLoading((prev) => ({ ...prev, [`${id}_${key}`]: val }));
  }

  async function doAction(label, id, key, fn, needConfirm = false) {
    if (needConfirm) {
      const ok = await confirm({ title: label, message: `${label} amalini tasdiqlaysizmi?` });
      if (!ok) return;
    }
    setActionBusy(id, key, true);
    try {
      await fn();
      toast.success(`${label} bajarildi`);
      load();
    } catch (err) {
      toast.error(err.message || `${label} bajarilmadi`);
    } finally {
      setActionBusy(id, key, false);
    }
  }

  async function openWinners(row) {
    try {
      const existing = await api.tournamentWinners(row.id);
      setWinners({
        tournament: row,
        existing,
        rows: [1, 2, 3].map((placement) => ({
          placement,
          userId: String(existing.find((x) => Number(x.placement) === placement)?.user_id || ''),
        })),
      });
    } catch (err) {
      toast.error(err.message || "G'oliblar yuklanmadi");
    }
  }

  async function saveWinners() {
    const toSend = winners.rows.filter((r) => r.userId.trim());
    if (!toSend.length) return toast.error("Kamida bitta g'olib user ID kerak");
    setSaving(true);
    try {
      await api.setTournamentWinners(winners.tournament.id, toSend);
      toast.success("G'oliblar saqlandi");
      setWinners(null);
      load();
    } catch (err) {
      toast.error(err.message || "G'oliblar saqlanmadi");
    } finally {
      setSaving(false);
    }
  }

  async function openBracket(row) {
    try {
      const data = await api.tournamentBracket(row.id);
      setBracket({ tournament: row, data });
    } catch (err) {
      toast.error(err.message || 'Bracket yuklanmadi');
    }
  }

  async function seedBracket(row) {
    await doAction('Bracket seed', row.id, 'seed', () => api.tournamentSeed(row.id));
  }

  async function autoSettle(row) {
    await doAction('Auto settle', row.id, 'settle', () => api.tournamentAutoSettle(row.id));
  }

  function isBusy(id, key) {
    return Boolean(actionLoading[`${id}_${key}`]);
  }

  const statusColor = (s) => {
    if (s === 'running') return 'text-emerald-400';
    if (s === 'finished') return 'text-slate-400';
    if (s === 'cancelled') return 'text-red-400';
    return 'text-amber-400';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">🏆 Turnirlar</h1>
          <p className="mt-1 text-sm text-slate-400">
            Turnir yaratish, boshlash, to'xtatish, bracket va g'oliblarni boshqarish.
          </p>
        </div>
        <button
          className="btn btn-primary shrink-0"
          onClick={() => setForm({ ...EMPTY_FORM })}
        >
          + Yangi turnir
        </button>
      </div>

      {/* Stats row */}
      {rows.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Jami', value: rows.length, color: 'text-white' },
            { label: 'Jonli', value: rows.filter((r) => r.status === 'running').length, color: 'text-emerald-400' },
            { label: 'Rejalashtirilgan', value: rows.filter((r) => r.status === 'scheduled').length, color: 'text-amber-400' },
            { label: 'Tugatilgan', value: rows.filter((r) => r.status === 'finished').length, color: 'text-slate-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border border-[#1e1e2e] bg-[#13131a] px-4 py-3">
              <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
              <div className={`text-2xl font-black ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex h-32 items-center justify-center text-slate-400">
          Yuklanmoqda…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#1e1e2e] text-slate-400">
          <span className="text-4xl">🏆</span>
          <span>Hali turnir yo'q</span>
          <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY_FORM })}>
            Birinchi turnirni yarating
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#1e1e2e]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e2e] bg-[#0d0d14] text-left text-xs font-bold uppercase text-slate-500">
                {['Nomi', 'Status', 'O\'yinchilar', 'Kirish (GC)', '1-o\'rin (GC)', 'Boshlanish', 'Amallar'].map((h) => (
                  <th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e2e]">
              {rows.map((r) => (
                <tr key={r.id} className="bg-[#0a0a0f] transition hover:bg-[#0d0d14]">
                  <td className="px-4 py-3">
                    <div className="font-bold text-white">{r.name}</div>
                    <div className="text-xs text-slate-500">ID: {r.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-bold ${statusColor(r.status)}`}>
                      {r.status === 'running' ? '🟢 Jonli'
                        : r.status === 'scheduled' ? '🟡 Rejalashtirilgan'
                        : r.status === 'finished' ? '⚫ Tugatilgan'
                        : r.status === 'cancelled' ? '🔴 Bekor'
                        : r.status || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {r.entries || 0} / {r.max_players || '—'}
                  </td>
                  <td className="px-4 py-3 text-amber-400 font-bold">{r.entry_gold_coins ?? '—'}</td>
                  <td className="px-4 py-3 text-yellow-400 font-bold">{r.prize_first_gold_coins ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {r.starts_at ? new Date(r.starts_at).toLocaleString('uz-UZ') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {/* Start */}
                      {r.status === 'scheduled' && (
                        <button
                          className="btn min-h-0 px-2 py-1 text-xs bg-emerald-600 border-emerald-500 hover:bg-emerald-500"
                          disabled={isBusy(r.id, 'start')}
                          onClick={() => doAction('Boshlash', r.id, 'start', () => api.startTournament(r.id), true)}
                        >
                          {isBusy(r.id, 'start') ? '…' : '▶ Boshlash'}
                        </button>
                      )}
                      {/* End */}
                      {r.status === 'running' && (
                        <button
                          className="btn min-h-0 px-2 py-1 text-xs"
                          disabled={isBusy(r.id, 'end')}
                          onClick={() => doAction('Tugatish', r.id, 'end', () => api.endTournament(r.id), true)}
                        >
                          {isBusy(r.id, 'end') ? '…' : '■ Tugatish'}
                        </button>
                      )}
                      {/* Seed */}
                      {(r.status === 'scheduled' || r.status === 'running') && (
                        <button
                          className="btn min-h-0 px-2 py-1 text-xs"
                          disabled={isBusy(r.id, 'seed')}
                          onClick={() => seedBracket(r)}
                        >
                          {isBusy(r.id, 'seed') ? '…' : '⚙ Seed'}
                        </button>
                      )}
                      {/* Bracket */}
                      <button
                        className="btn min-h-0 px-2 py-1 text-xs"
                        disabled={isBusy(r.id, 'bracket')}
                        onClick={() => openBracket(r)}
                      >
                        📊 Bracket
                      </button>
                      {/* Auto Settle */}
                      {r.status === 'running' && (
                        <button
                          className="btn min-h-0 px-2 py-1 text-xs"
                          disabled={isBusy(r.id, 'settle')}
                          onClick={() => autoSettle(r)}
                        >
                          {isBusy(r.id, 'settle') ? '…' : '🤝 Auto settle'}
                        </button>
                      )}
                      {/* Winners */}
                      <button
                        className="btn min-h-0 px-2 py-1 text-xs"
                        onClick={() => openWinners(r)}
                      >
                        🥇 G'oliblar
                      </button>
                      {/* Cancel */}
                      {r.status !== 'cancelled' && r.status !== 'finished' && (
                        <button
                          className="btn btn-danger min-h-0 px-2 py-1 text-xs"
                          disabled={isBusy(r.id, 'cancel')}
                          onClick={() => doAction('Bekor qilish', r.id, 'cancel', () => api.cancelTournament(r.id), true)}
                        >
                          {isBusy(r.id, 'cancel') ? '…' : '✕ Bekor'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      <Modal
        open={!!form}
        title="Yangi turnir yaratish"
        onClose={() => !saving && setForm(null)}
        footer={
          <>
            <button className="btn" onClick={() => setForm(null)} disabled={saving}>Bekor</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saqlanmoqda…' : '✓ Yaratish'}
            </button>
          </>
        }
      >
        {form && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Turnir nomi *">
              <input
                className="h-10 rounded-lg border border-[#2a2a3a] bg-[#13131a] px-3 text-white"
                placeholder="Grand Cup 2026"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="Boshlanish vaqti">
              <input
                className="h-10 rounded-lg border border-[#2a2a3a] bg-[#13131a] px-3 text-white"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
            </Field>
            <Field label="Maksimal o'yinchilar">
              <input
                className="h-10 rounded-lg border border-[#2a2a3a] bg-[#13131a] px-3 text-white"
                type="number" min="2" max="1024"
                value={form.maxPlayers}
                onChange={(e) => setForm((f) => ({ ...f, maxPlayers: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Kirish narxi (GC)">
              <input
                className="h-10 rounded-lg border border-[#2a2a3a] bg-[#13131a] px-3 text-white"
                type="number" min="0"
                value={form.entryGoldCoins}
                onChange={(e) => setForm((f) => ({ ...f, entryGoldCoins: Number(e.target.value) }))}
              />
            </Field>
            <Field label="1-o'rin sovrin (GC)">
              <input
                className="h-10 rounded-lg border border-[#2a2a3a] bg-[#13131a] px-3 text-white"
                type="number" min="0"
                value={form.prizeFirstGoldCoins}
                onChange={(e) => setForm((f) => ({ ...f, prizeFirstGoldCoins: Number(e.target.value) }))}
              />
            </Field>
            <Field label="2-o'rin sovrin (GC)">
              <input
                className="h-10 rounded-lg border border-[#2a2a3a] bg-[#13131a] px-3 text-white"
                type="number" min="0"
                value={form.prizeSecondGoldCoins}
                onChange={(e) => setForm((f) => ({ ...f, prizeSecondGoldCoins: Number(e.target.value) }))}
              />
            </Field>
            <Field label="3-o'rin sovrin (GC)">
              <input
                className="h-10 rounded-lg border border-[#2a2a3a] bg-[#13131a] px-3 text-white"
                type="number" min="0"
                value={form.prizeThirdGoldCoins}
                onChange={(e) => setForm((f) => ({ ...f, prizeThirdGoldCoins: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Stol o'lchami">
              <select
                className="h-10 rounded-lg border border-[#2a2a3a] bg-[#13131a] px-3 text-white"
                value={form.tableSize}
                onChange={(e) => setForm((f) => ({ ...f, tableSize: Number(e.target.value) }))}
              >
                {[2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>{n} o'yinchi</option>
                ))}
              </select>
            </Field>
            <div className="flex items-center gap-3 md:col-span-2">
              <input
                id="bluff-check"
                type="checkbox"
                checked={form.bluffEnabled}
                onChange={(e) => setForm((f) => ({ ...f, bluffEnabled: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="bluff-check" className="text-sm text-slate-300 cursor-pointer">
                Bluff rejimi yoqilgan
              </label>
            </div>
          </div>
        )}
      </Modal>

      {/* Winners Modal */}
      <Modal
        open={!!winners}
        title={`G'oliblar — ${winners?.tournament?.name || ''}`}
        onClose={() => !saving && setWinners(null)}
        footer={
          <>
            <button className="btn" onClick={() => setWinners(null)} disabled={saving}>Bekor</button>
            <button className="btn btn-primary" onClick={saveWinners} disabled={saving}>
              {saving ? 'Saqlanmoqda…' : '✓ Saqlash'}
            </button>
          </>
        }
      >
        {winners && (
          <div className="space-y-3">
            {winners.rows.map((row, idx) => (
              <div key={row.placement} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-center text-lg font-black text-amber-400">
                  {row.placement === 1 ? '🥇' : row.placement === 2 ? '🥈' : '🥉'}
                  {' '}{row.placement}-o'rin
                </span>
                <input
                  className="h-10 flex-1 rounded-lg border border-[#2a2a3a] bg-[#13131a] px-3 text-white"
                  placeholder="User ID (raqam)"
                  value={row.userId}
                  onChange={(e) => setWinners((cur) => {
                    const next = [...cur.rows];
                    next[idx] = { ...next[idx], userId: e.target.value };
                    return { ...cur, rows: next };
                  })}
                />
              </div>
            ))}
            <p className="text-xs text-slate-500">
              * User ID ni foydalanuvchilar jadvalidan topish mumkin.
              Bo'sh qoldirilgan o'rinlar saqlanmaydi.
            </p>
          </div>
        )}
      </Modal>

      {/* Bracket Modal */}
      <Modal
        open={!!bracket}
        title={`Bracket — ${bracket?.tournament?.name || ''}`}
        wide
        onClose={() => setBracket(null)}
      >
        {bracket && (
          <div className="space-y-3">
            <div className="flex gap-3 text-sm text-slate-400">
              <span>Turnir ID: <b className="text-white">{bracket.tournament.id}</b></span>
              <span>Status: <b className="text-amber-400">{bracket.tournament.status}</b></span>
            </div>
            {bracket.data?.matches?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#2a2a3a] text-left text-slate-500">
                      <th className="py-2 pr-3">Round</th>
                      <th className="py-2 pr-3">A o'yinchi</th>
                      <th className="py-2 pr-3">B o'yinchi</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">G'olib</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e1e2e]">
                    {bracket.data.matches.map((m) => (
                      <tr key={m.id} className="text-slate-300">
                        <td className="py-2 pr-3 font-bold text-amber-400">{m.round_no}</td>
                        <td className="py-2 pr-3">{m.a_username || m.a_bot_name || '—'}</td>
                        <td className="py-2 pr-3">{m.b_username || m.b_bot_name || '—'}</td>
                        <td className="py-2 pr-3">
                          <span className={m.status === 'live' ? 'text-emerald-400' : m.status === 'done' ? 'text-slate-400' : 'text-amber-400'}>
                            {m.status || 'pending'}
                          </span>
                        </td>
                        <td className="py-2 text-emerald-400 font-bold">
                          {m.winner_entry_id
                            ? (m.winner_entry_id === m.entry_a_id ? (m.a_username || 'A') : (m.b_username || 'B'))
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#2a2a3a] py-8 text-center text-slate-400">
                Bracket hali yaratilmagan. "Seed" tugmasini bosing.
              </div>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500">JSON ko'rish</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/40 p-3 text-xs text-slate-300">
                {JSON.stringify(bracket.data || {}, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </Modal>
    </div>
  );
}
