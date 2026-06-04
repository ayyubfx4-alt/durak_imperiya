import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';

const KNOWN_PERMISSIONS = [
  'users.view',
  'users.moderate',
  'users.manage',
  'game.watch',
  'game.manage',
  'tournaments.manage',
  'economy.manage',
  'shop.manage',
  'reports.view',
  'reports.manage',
  'voice.manage',
  'security.view',
  'security.manage',
  'backup.manage',
  'roles.manage',
  'notifications.send',
];

export default function Roles() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  async function load() { try { setRows(await api.roles()); } catch (err) { toast.error(err.message); } }
  useEffect(() => { load(); }, []);
  async function save() {
    try {
      await api.updateRole(editing.role, editing.permissions);
      toast.success('Permission yangilandi');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black">Admin roles</h1>
        <p className="text-sm text-slate-400">Owner, Super Admin, Moderator va Support operator permissionlari.</p>
      </div>
      <DataTable rows={rows} rowKey={(r) => r.role} columns={[
        { key: 'role', label: 'Role' },
        { key: 'adminCount', label: 'Admins', sortable: true },
        { key: 'permissions', label: 'Permissions', render: (r) => (r.permissions || []).join(', ') },
        { key: 'actions', label: 'Amallar', render: (r) => <button className="btn min-h-0 px-2 py-1" onClick={() => setEditing({ role: r.role, permissions: [...(r.permissions || [])] })}>Edit</button> },
      ]} />
      <Modal
        open={!!editing}
        title={editing ? `${editing.role} permissions` : 'Permissions'}
        onClose={() => setEditing(null)}
        footer={<><button className="btn" onClick={() => setEditing(null)}>Bekor</button><button className="btn btn-primary" onClick={save}>Saqlash</button></>}
      >
        {editing && (
          <div className="grid gap-2 md:grid-cols-2">
            {KNOWN_PERMISSIONS.map((permission) => (
              <label key={permission} className="flex items-center gap-2 rounded border border-[#1e1e2e] bg-black/20 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={editing.permissions.includes('*') || editing.permissions.includes(permission)}
                  disabled={editing.permissions.includes('*')}
                  onChange={(e) => setEditing((cur) => ({
                    ...cur,
                    permissions: e.target.checked
                      ? [...new Set([...cur.permissions, permission])]
                      : cur.permissions.filter((p) => p !== permission),
                  }))}
                />
                {permission}
              </label>
            ))}
            <label className="flex items-center gap-2 rounded border border-[#1e1e2e] bg-black/20 p-3 text-sm">
              <input
                type="checkbox"
                checked={editing.permissions.includes('*')}
                onChange={(e) => setEditing((cur) => ({ ...cur, permissions: e.target.checked ? ['*'] : [] }))}
              />
              *
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
