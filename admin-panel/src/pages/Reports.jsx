import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';

const types = [
  ['all', 'Hammasi'],
  ['toxic', 'Toxic'],
  ['voice_abuse', 'Voice abuse'],
  ['cheat', 'Cheat'],
  ['spam', 'Spam'],
];

export default function Reports() {
  const [tab, setTab] = useState('business');
  const [reportType, setReportType] = useState('all');
  const [revenue, setRevenue] = useState([]);
  const [retention, setRetention] = useState([]);
  const [funnel, setFunnel] = useState(null);
  const [moderation, setModeration] = useState({ data: [], counts: [] });
  const toast = useToast();

  async function load() {
    try {
      const [r, ret, f, m] = await Promise.all([
        api.revenueReport(),
        api.retentionReport(),
        api.funnelReport(),
        api.moderationReports({ type: reportType }),
      ]);
      setRevenue(r);
      setRetention(ret);
      setFunnel(f);
      setModeration(m);
    } catch (err) { toast.error(err.message); }
  }

  useEffect(() => { load(); }, [reportType]);

  async function exportCsv() {
    try {
      const csv = await api.exportReport();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'admin-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast.error(err.message); }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Hisobotlar</h1>
          <p className="text-sm text-slate-400">Revenue, retention, funnel, toxic/voice/cheat/spam reportlar.</p>
        </div>
        <button className="btn btn-primary" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={`btn ${tab === 'business' ? 'btn-primary' : ''}`} onClick={() => setTab('business')}>Business</button>
        <button className={`btn ${tab === 'moderation' ? 'btn-primary' : ''}`} onClick={() => setTab('moderation')}>Moderation</button>
      </div>
      {tab === 'business' && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Registered" value={funnel?.registered} />
            <StatCard label="Played" value={funnel?.played} accent="green" />
            <StatCard label="Purchased" value={funnel?.purchased} accent="gold" />
            <StatCard label="Premium" value={funnel?.premium} accent="purple" />
          </div>
          <h2 className="font-bold">Revenue</h2>
          <DataTable rows={revenue} columns={[{ key: 'day', label: 'Day' }, { key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount' }]} />
          <h2 className="font-bold">Retention</h2>
          <DataTable rows={retention} columns={[{ key: 'cohort', label: 'Cohort' }, { key: 'registered', label: 'Registered' }, { key: 'd1', label: 'D1' }, { key: 'd7', label: 'D7' }, { key: 'd30', label: 'D30' }]} />
        </>
      )}
      {tab === 'moderation' && (
        <>
          <div className="flex flex-wrap gap-2">
            {types.map(([value, label]) => <button key={value} className={`btn ${reportType === value ? 'btn-primary' : ''}`} onClick={() => setReportType(value)}>{label}</button>)}
          </div>
          <DataTable rows={moderation.data || []} columns={[
            { key: 'reason', label: 'Reason', render: (r) => <StatusBadge status={r.reason}>{r.reason}</StatusBadge> },
            { key: 'reporter_username', label: 'Reporter', render: (r) => `@${r.reporter_nickname || r.reporter_username || '-'}` },
            { key: 'reported_username', label: 'Reported', render: (r) => `@${r.reported_nickname || r.reported_username || '-'}` },
            { key: 'details', label: 'Details', render: (r) => <span className="text-xs text-slate-400">{r.details || '-'}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status}>{r.status}</StatusBadge> },
            { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
          ]} />
        </>
      )}
    </div>
  );
}
