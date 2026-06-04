import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatCard from '../components/StatCard.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Security() {
  const [data, setData] = useState(null);
  const toast = useToast();
  async function load() { try { setData(await api.securityOverview()); } catch (err) { toast.error(err.message); } }
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Security</h1>
          <p className="text-sm text-slate-400">Multiaccount, IP/device, suspicious user, mute va ban nazorati.</p>
        </div>
        <button className="btn btn-primary" onClick={load}>Yangilash</button>
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <StatCard label="IP multiaccount" value={data?.multiIp?.length || 0} accent="red" />
        <StatCard label="Device multiaccount" value={data?.multiDevice?.length || 0} accent="red" />
        <StatCard label="Suspicious" value={data?.suspicious?.length || 0} accent="gold" />
        <StatCard label="Muted" value={data?.muted?.length || 0} accent="purple" />
        <StatCard label="Banned" value={data?.banned?.length || 0} accent="red" />
      </div>
      <Section title="Multiaccount IP">
        <DataTable rows={data?.multiIp || []} rowKey={(r) => r.last_ip} columns={[
          { key: 'last_ip', label: 'IP' },
          { key: 'accounts', label: 'Accounts', sortable: true },
          { key: 'users', label: 'Users', render: (r) => (r.users || []).map((u) => `@${u.nickname || u.username}`).join(', ') },
        ]} />
      </Section>
      <Section title="Multiaccount Device ID">
        <DataTable rows={data?.multiDevice || []} rowKey={(r) => r.device_id} columns={[
          { key: 'device_id', label: 'Device' },
          { key: 'accounts', label: 'Accounts', sortable: true },
          { key: 'users', label: 'Users', render: (r) => (r.users || []).map((u) => `@${u.nickname || u.username}`).join(', ') },
        ]} />
      </Section>
      <Section title="Suspicious users">
        <DataTable rows={data?.suspicious || []} rowKey={(r) => r.user_id} columns={[
          { key: 'username', label: 'User', render: (r) => `@${r.nickname || r.username}` },
          { key: 'score', label: 'Score', sortable: true },
          { key: 'category', label: 'Category' },
          { key: 'last_ip', label: 'IP' },
          { key: 'device_id', label: 'Device' },
        ]} />
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return <section className="space-y-3"><h2 className="font-bold">{title}</h2>{children}</section>;
}
