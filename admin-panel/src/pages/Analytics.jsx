import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatCard from '../components/StatCard.jsx';
import { useToast } from '../components/Toast.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const mins = (seconds) => `${Math.round(Number(seconds || 0) / 60)} min`;
const usd = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const dateTime = (value) => (value ? new Date(value).toLocaleString() : '-');

// ISO 3166-1 alpha-2 -> davlat nomi (asosiy davlatlar)
const COUNTRY_NAMES = {
  UZ: "O'zbekiston", RU: 'Rossiya', US: 'AQSh',
  KZ: "Qozog'iston", KG: "Qirg'iziston", TJ: 'Tojikiston',
  TM: 'Turkmaniston', AZ: 'Ozarbayjon', TR: 'Turkiya',
  DE: 'Germaniya', FR: 'Fransiya', GB: 'Britaniya',
  UA: 'Ukraina', BY: 'Belarus', PL: 'Polsha',
  CN: 'Xitoy', IN: 'Hindiston', BR: 'Braziliya',
  SA: 'Saudiya', AE: 'BAA', IR: 'Eron',
  IL: 'Isroil', EG: 'Misr', NG: 'Nigeriya',
  CA: 'Kanada', AU: 'Avstraliya', MX: 'Meksika',
  JP: 'Yaponiya', KR: 'Janubiy Koreya', XX: "Noma'lum",
};

function countryName(code) {
  return COUNTRY_NAMES[code] || code || "Noma'lum";
}

function flagEmoji(code) {
  if (!code || code === 'XX') return '--';
  try {
    return String.fromCodePoint(
      ...code.toUpperCase().split('').map((c) => 0x1F1E6 - 65 + c.charCodeAt(0))
    );
  } catch (_) {
    return '--';
  }
}

function userLabel(row) {
  const name = row?.nickname || row?.username || row?.display_name || row?.email || 'Noma\'lum';
  return name.startsWith('@') ? name : `@${name}`;
}

function itemLabel(row) {
  const meta = row?.metadata || {};
  return row?.item_id
    || meta.itemId
    || meta.packId
    || meta.bundleId
    || meta.tierId
    || meta.productId
    || row?.item_type
    || row?.type
    || '-';
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [geo, setGeo] = useState(null);
  const [activity, setActivity] = useState(null);
  const [geoLoading, setGeoLoading] = useState(true);
  const toast = useToast();

  async function load() {
    try { setData(await api.analyticsOverview()); }
    catch (err) { toast.error(err.message); }
  }

  async function loadGeo() {
    try {
      setGeoLoading(true);
      setGeo(await api.analyticsGeo());
    } catch (err) {
      toast.error(`Geo: ${err.message}`);
    } finally {
      setGeoLoading(false);
    }
  }

  async function loadCustomerActivity() {
    try {
      setActivity(await api.analyticsCustomerActivity({ limit: 50 }));
    } catch (err) {
      toast.error(`Mijoz talabi: ${err.message}`);
    }
  }

  async function loadAll() {
    await Promise.all([load(), loadGeo(), loadCustomerActivity()]);
  }

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 30000);
    return () => clearInterval(timer);
  }, []);

  const maxUsers = geo && geo.length > 0 ? geo[0].users : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Analytics</h1>
          <p className="text-sm text-slate-400">
            DAU/MAU, session time, donorlar, aktiv userlar va davlatlar statistikasi.
          </p>
        </div>
        <button className="btn btn-primary" onClick={loadAll}>Yangilash</button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="DAU" value={fmt(data?.activity?.dau)} accent="green" />
        <StatCard label="MAU" value={fmt(data?.activity?.mau)} accent="purple" />
        <StatCard label="Yangi userlar" value={fmt(data?.activity?.new_today)} />
        <StatCard label="Avg session" value={mins(data?.sessionTime?.avg_seconds)} accent="gold" />
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <StatCard label="Donat qilganlar" value={fmt(activity?.summary?.donor_users)} accent="gold" />
        <StatCard label="Donat summa" value={usd(activity?.summary?.donation_cents)} accent="green" />
        <StatCard label="Premium olganlar" value={fmt(activity?.summary?.premium_buyers)} accent="purple" />
        <StatCard label="Stiker xaridlari" value={fmt(activity?.summary?.sticker_purchases)} />
        <StatCard label="Boshqa xaridlar" value={fmt(activity?.summary?.other_purchase_events)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Eng ko'p donat qilgan userlar">
          <DataTable rows={data?.topDonators || []} columns={[
            { key: 'username', label: 'User', render: (r) => `@${r.nickname || r.username}` },
            { key: 'amount_cents', label: 'USD', render: (r) => `$${(Number(r.amount_cents || 0) / 100).toFixed(2)}` },
          ]} />
        </Section>
        <Section title="Eng aktiv userlar">
          <DataTable rows={data?.activeUsers || []} columns={[
            { key: 'username', label: 'User', render: (r) => `@${r.nickname || r.username}` },
            { key: 'games_played', label: 'Games', sortable: true },
            { key: 'games_won', label: 'Wins', sortable: true },
          ]} />
        </Section>
      </div>

      <Section title="Eng ko'p o'ynalgan stol">
        <DataTable rows={data?.popularTables || []} columns={[
          { key: 'stake', label: 'Stavka', sortable: true, render: (r) => fmt(r.stake) },
          { key: 'mode', label: 'Mode' },
          { key: 'games', label: 'Games', sortable: true },
        ]} />
      </Section>

      <Section title="Eng ko'p o'yinchi kirayotgan davlatlar">
        {geoLoading && !geo ? (
          <div className="text-slate-400 text-sm py-4 text-center">Yuklanmoqda...</div>
        ) : !geo || geo.length === 0 ? (
          <div className="text-slate-400 text-sm py-4 text-center">
            Hali davlat ma'lumotlari yo'q. Foydalanuvchilar tizimga kirishi bilan to'ldiriladi.
          </div>
        ) : (
          <div className="space-y-2">
            {geo.map((row, idx) => (
              <GeoRow
                key={`${row.country_code || 'XX'}-${idx}`}
                rank={idx + 1}
                code={row.country_code}
                users={row.users}
                percent={row.percent}
                maxUsers={maxUsers}
                active24h={row.active_24h}
                premiumUsers={row.premium_users}
                donatedCents={row.donated_cents}
              />
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Donat qilgan o'yinchilar">
          <DataTable rows={activity?.donations || []} columns={[
            { key: 'username', label: 'User', render: userLabel },
            { key: 'country_code', label: 'Davlat', render: (r) => `${flagEmoji(r.country_code)} ${countryName(r.country_code)}` },
            { key: 'amount_usd_cents', label: 'Summa', sortable: true, render: (r) => usd(r.amount_usd_cents) },
            { key: 'created_at', label: 'Sana', render: (r) => dateTime(r.created_at) },
          ]} />
        </Section>

        <Section title="Premium sotib olganlar">
          <DataTable rows={activity?.premium || []} columns={[
            { key: 'username', label: 'User', render: userLabel },
            { key: 'country_code', label: 'Davlat', render: (r) => `${flagEmoji(r.country_code)} ${countryName(r.country_code)}` },
            { key: 'item_id', label: 'Tarif', render: itemLabel },
            { key: 'days', label: 'Kun', render: (r) => r.days || r.metadata?.days || '-' },
            { key: 'created_at', label: 'Sana', render: (r) => dateTime(r.created_at) },
          ]} />
        </Section>

        <Section title="Stiker sotib olganlar">
          <DataTable rows={activity?.stickers || []} columns={[
            { key: 'username', label: 'User', render: userLabel },
            { key: 'country_code', label: 'Davlat', render: (r) => `${flagEmoji(r.country_code)} ${countryName(r.country_code)}` },
            { key: 'item_id', label: 'Pack', render: itemLabel },
            { key: 'amount', label: 'Gold', sortable: true, render: (r) => fmt(Math.abs(Number(r.amount || 0))) },
            { key: 'created_at', label: 'Sana', render: (r) => dateTime(r.created_at) },
          ]} />
        </Section>

        <Section title="Boshqa narsalar sotib olganlar">
          <DataTable rows={activity?.otherPurchases || []} columns={[
            { key: 'username', label: 'User', render: userLabel },
            { key: 'country_code', label: 'Davlat', render: (r) => `${flagEmoji(r.country_code)} ${countryName(r.country_code)}` },
            { key: 'item_type', label: 'Tur', render: (r) => r.item_type || r.type || '-' },
            { key: 'item_id', label: 'Item', render: itemLabel },
            { key: 'amount', label: 'Miqdor', sortable: true, render: (r) => `${fmt(Math.abs(Number(r.amount || 0)))} ${r.currency === 'gold' ? 'Gold' : '$'}` },
            { key: 'created_at', label: 'Sana', render: (r) => dateTime(r.created_at) },
          ]} />
        </Section>
      </div>
    </div>
  );
}

function GeoRow({ rank, code, users, percent, maxUsers, active24h = 0, premiumUsers = 0, donatedCents = 0 }) {
  const barWidth = maxUsers > 0 ? Math.max(2, Math.round((users / maxUsers) * 100)) : 0;
  const isTop3 = rank <= 3;
  const barColors = {
    1: 'bg-yellow-400',
    2: 'bg-slate-300',
    3: 'bg-amber-600',
  };
  const barColor = barColors[rank] || 'bg-indigo-500';

  return (
    <div className="flex items-center gap-3 group">
      <span
        className={`w-6 text-center text-xs font-bold shrink-0 ${
          isTop3 ? 'text-yellow-400' : 'text-slate-500'
        }`}
      >
        {rank}
      </span>

      <div className="flex items-center gap-2 w-40 shrink-0">
        <span className="text-xl leading-none">{flagEmoji(code)}</span>
        <div>
          <div className="text-sm font-semibold leading-tight">{countryName(code)}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">{code || 'XX'}</div>
        </div>
      </div>

      <div className="flex-1 h-5 bg-slate-800 rounded-full overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor} opacity-80 group-hover:opacity-100`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <span className="text-xs text-slate-400 w-12 text-right shrink-0 font-mono">
        {percent}%
      </span>

      <span className="text-sm font-bold w-16 text-right shrink-0 tabular-nums">
        {fmt(users)}
      </span>

      <span className="hidden w-44 text-right text-[11px] text-slate-500 md:inline">
        24h: {fmt(active24h)} | P: {fmt(premiumUsers)} | {usd(donatedCents)}
      </span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}
