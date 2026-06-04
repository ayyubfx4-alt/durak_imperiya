import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Settings() {
  const [data, setData] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [resetPreview, setResetPreview] = useState(null);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  async function load() {
    try {
      const [settings, preview] = await Promise.all([
        api.settings(),
        api.productionResetPreview().catch(() => null),
      ]);
      setData(settings);
      if (preview) setResetPreview(preview);
    } catch (err) { toast.error(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function save(key, fn) {
    try {
      await fn(data[key]);
      toast.success('Sozlama saqlandi');
      await load();
    } catch (err) { toast.error(err.message); }
  }

  if (!data) return <div className="text-slate-400">Yuklanmoqda...</div>;
  const set = (key, patch) => setData((cur) => ({ ...cur, [key]: { ...cur[key], ...patch } }));

  async function changePassword(event) {
    event.preventDefault();
    setPasswordSaving(true);
    try {
      await api.changePassword(passwordForm);
      toast.success('Admin parol yangilandi. Keyingi kirishda yangi paroldan foydalaning.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error(err.message || 'Parol yangilanmadi');
    } finally {
      setPasswordSaving(false);
    }
  }

  async function refreshResetPreview() {
    try {
      setResetPreview(await api.productionResetPreview());
    } catch (err) {
      toast.error(err.message || 'Reset preview yuklanmadi');
    }
  }

  async function runProductionReset() {
    const required = resetPreview?.confirmation || 'REAL_PRODUCTION_RESET';
    if (resetConfirmation.trim() !== required) {
      toast.error(`Tasdiq kodi: ${required}`);
      return;
    }
    const ok = await confirm({
      title: 'Production reset',
      message: 'Barcha playerlar, o\'yinlar, tranzaksiyalar, support ticketlar va katalog/stiker yozuvlari 0 holatga qaytariladi. Admin hisoblar va tizim sozlamalari qoladi.',
      danger: true,
    });
    if (!ok) return;
    setResetLoading(true);
    try {
      const result = await api.productionReset({ confirmation: resetConfirmation.trim() });
      setResetConfirmation('');
      setResetPreview({ confirmation: required, counts: result.after || {} });
      toast.success('Production data 0 holatga qaytarildi');
      await load();
    } catch (err) {
      toast.error(err.message || 'Production reset bajarilmadi');
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-black">Sozlamalar</h1><p className="text-sm text-slate-400">JSON emas, aniq runtime boshqaruv formalar.</p></div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-4">
          <div className="mb-4">
            <h2 className="font-bold">Admin parolini o'zgartirish</h2>
            <p className="mt-1 text-xs text-slate-400">Default parol: 2202. Yangilagandan keyin panelga yangi parol bilan kirasiz.</p>
          </div>
          <form className="space-y-4" onSubmit={changePassword}>
            <Field label="Hozirgi parol">
              <input
                type="password"
                className="h-10 w-full px-3"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((cur) => ({ ...cur, currentPassword: e.target.value }))}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="Yangi parol">
              <input
                type="password"
                className="h-10 w-full px-3"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((cur) => ({ ...cur, newPassword: e.target.value }))}
                autoComplete="new-password"
                minLength={4}
                maxLength={128}
                required
              />
            </Field>
            <Field label="Yangi parolni takrorlang">
              <input
                type="password"
                className="h-10 w-full px-3"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((cur) => ({ ...cur, confirmPassword: e.target.value }))}
                autoComplete="new-password"
                minLength={4}
                maxLength={128}
                required
              />
            </Field>
            <button className="btn btn-primary w-full" disabled={passwordSaving}>
              {passwordSaving ? 'Saqlanmoqda...' : 'Parolni yangilash'}
            </button>
          </form>
        </section>
        <section className="card overflow-hidden border-red-500/30 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-red-500/20 bg-red-500/[.06] p-4">
            <div>
              <h2 className="font-black text-red-100">Real ishga tushirish reseti</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-300">
                Test va eski yozuvlarni tozalab, loyiha metrikalarini 0 dan boshlatadi. Adminlar, rollar, parol va runtime sozlamalar saqlanadi.
              </p>
            </div>
            <button className="btn" type="button" onClick={refreshResetPreview}>Yangilash</button>
          </div>
          <div className="space-y-4 p-4">
            <ResetPreview counts={resetPreview?.counts} />
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <Field label={`Tasdiq kodi: ${resetPreview?.confirmation || 'REAL_PRODUCTION_RESET'}`}>
                <input
                  className="h-11 w-full px-3"
                  value={resetConfirmation}
                  onChange={(e) => setResetConfirmation(e.target.value)}
                  placeholder="REAL_PRODUCTION_RESET"
                  autoComplete="off"
                />
              </Field>
              <button
                className="btn btn-danger self-end"
                type="button"
                disabled={resetLoading || resetConfirmation.trim() !== (resetPreview?.confirmation || 'REAL_PRODUCTION_RESET')}
                onClick={runProductionReset}
              >
                {resetLoading ? 'Tozalanmoqda...' : 'Real 0 dan boshlash'}
              </button>
            </div>
          </div>
        </section>
        <Panel title="Fake bots" action={() => save('fake_bots', api.saveFakeBots)}>
          <Toggle label="Enabled" checked={data.fake_bots.enabled} onChange={(v) => set('fake_bots', { enabled: v })} />
          <NumberField label="Count" value={data.fake_bots.count} min={0} max={100} onChange={(v) => set('fake_bots', { count: v })} />
          <Field label="Bot level"><select className="h-10 w-full px-3" value={data.fake_bots.level} onChange={(e) => set('fake_bots', { level: e.target.value })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></Field>
        </Panel>
        <Panel title="Fake donations" action={() => save('fake_donations', api.saveFakeDonations)}>
          <Toggle label="Enabled" checked={data.fake_donations.enabled} onChange={(v) => set('fake_donations', { enabled: v })} />
          <NumberField label="Count per hour" value={data.fake_donations.countPerHour ?? data.fake_donations.count ?? 0} min={0} max={1000} onChange={(v) => set('fake_donations', { countPerHour: v })} />
        </Panel>
        <Panel title="Maintenance mode" action={() => save('maintenance', api.saveMaintenance)}>
          <Toggle label="Enabled" checked={data.maintenance.enabled} onChange={(v) => set('maintenance', { enabled: v })} />
          <Field label="Message"><textarea className="min-h-24 w-full p-3" value={data.maintenance.message || ''} onChange={(e) => set('maintenance', { message: e.target.value })} /></Field>
        </Panel>
        <Panel title="Game config" action={() => save('game_config', api.saveGameConfig)}>
          <NumberField label="Starting cards" value={data.game_config.startingCards} min={1} max={12} onChange={(v) => set('game_config', { startingCards: v })} />
          <NumberField label="Max players per room" value={data.game_config.maxPlayersPerRoom} min={2} max={6} onChange={(v) => set('game_config', { maxPlayersPerRoom: v })} />
          <Toggle label="Allow bots" checked={data.game_config.allowBots} onChange={(v) => set('game_config', { allowBots: v })} />
          <Toggle label="Voice chat" checked={data.game_config.voiceChat} onChange={(v) => set('game_config', { voiceChat: v })} />
          <NumberField label="Turn time limit (sec)" value={data.game_config.turnTimeLimit} min={5} max={180} onChange={(v) => set('game_config', { turnTimeLimit: v })} />
        </Panel>
        <Panel title="Anti-bot" action={() => save('antibot', api.saveAntibot)}>
          <Toggle label="Enabled" checked={data.antibot.enabled} onChange={(v) => set('antibot', { enabled: v })} />
          <Field label={`Sensitivity: ${data.antibot.sensitivity}`}>
            <input type="range" min="1" max="10" className="w-full" value={data.antibot.sensitivity} onChange={(e) => set('antibot', { sensitivity: Number(e.target.value) })} />
          </Field>
        </Panel>
      </div>
    </div>
  );
}

function ResetPreview({ counts = {} }) {
  const items = [
    ['Real userlar', counts.realUsers],
    ['O\'yinlar', counts.games],
    ['Stikerlar', counts.stickers],
    ['Katalog itemlar', counts.catalogItems],
    ['Tranzaksiyalar', counts.transactions],
    ['Donatlar', counts.donations],
    ['Support ticketlar', counts.supportTickets],
    ['Telegram userlar', counts.telegramUsers],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[#252538] bg-black/20 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-black">{Number(value || 0).toLocaleString('ru-RU')}</div>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, children, action }) {
  return <section className="card p-4"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{title}</h2><button className="btn btn-primary" onClick={action}>Saqlash</button></div><div className="space-y-4">{children}</div></section>;
}
function Field({ label, children }) {
  return <label className="block"><span className="field-label">{label}</span>{children}</label>;
}
function NumberField({ label, value, onChange, min, max }) {
  return <Field label={label}><input className="h-10 w-full px-3" type="number" min={min} max={max} value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} /></Field>;
}
function Toggle({ label, checked, onChange }) {
  return <label className="flex items-center justify-between rounded border border-[#1e1e2e] p-3"><span className="font-bold">{label}</span><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /></label>;
}
