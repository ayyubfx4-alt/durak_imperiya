import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Audit() {
  const [rows, setRows] = useState([]);
  const toast = useToast();
  useEffect(() => { api.audit({ limit: 200 }).then(setRows).catch((err) => toast.error(err.message)); }, []);
  return <div className="space-y-5"><div><h1 className="text-2xl font-black">Audit log</h1><p className="text-sm text-slate-400">Admin qilgan barcha amallar tarixi.</p></div><DataTable rows={rows} columns={[{ key: 'created_at', label: 'Time', render: (r) => new Date(r.created_at).toLocaleString() }, { key: 'admin_id', label: 'Admin' }, { key: 'action', label: 'Action', sortable: true }, { key: 'target_id', label: 'Target' }, { key: 'metadata', label: 'Details', render: (r) => <code className="text-xs text-slate-400">{JSON.stringify(r.metadata || {})}</code> }]} /></div>;
}
