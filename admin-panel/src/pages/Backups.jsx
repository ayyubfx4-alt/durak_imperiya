import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Backups() {
  const [rows, setRows] = useState([]);
  const toast = useToast();
  const confirm = useConfirm();
  async function load() { try { setRows(await api.backups()); } catch (err) { toast.error(err.message); } }
  useEffect(() => { load(); }, []);
  async function create(label, fn) { try { await fn(); toast.success(label); load(); } catch (err) { toast.error(err.message); } }
  async function restore(id) {
    if (!await confirm({ title: 'Restore request', message: 'Backup restore so\'rovi auditga yozilsinmi?', danger: true })) return;
    await create('Restore so\'rovi yozildi', () => api.restoreBackup(id));
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Backup</h1>
          <p className="text-sm text-slate-400">Database/source backup metadatasi, audit va restore request.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => create('Database backup yaratildi', () => api.createDatabaseBackup())}>Database backup</button>
          <button className="btn" onClick={() => create('Source backup yaratildi', () => api.createSourceBackup())}>Source backup</button>
        </div>
      </div>
      <DataTable rows={rows} columns={[
        { key: 'backup_type', label: 'Type' },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'metadata', label: 'Metadata', render: (r) => <span className="text-xs text-slate-400">{JSON.stringify(r.metadata || {}).slice(0, 180)}</span> },
        { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
        { key: 'actions', label: 'Amallar', render: (r) => <button className="btn btn-danger min-h-0 px-2 py-1" onClick={() => restore(r.id)}>Restore</button> },
      ]} />
    </div>
  );
}
