import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { useToast } from '../components/Toast.jsx';

export default function Login() {
  const [mode, setMode] = useState('pin');
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('admin@durak.local');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const result = mode === 'pin' ? await api.pinLogin(pin) : await api.login(username, password);
      setToken(result.token);
      toast.success('Admin panelga kirdingiz');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Login xato');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#0a0a0f] p-4">
      <form onSubmit={submit} className="card w-full max-w-md p-6 shadow-2xl">
        <div className="mb-6">
          <div className="text-2xl font-black text-[#f5a623]">Durak Admin</div>
          <p className="mt-1 text-sm text-slate-400">O'yinni to'liq boshqarish paneli</p>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-2 rounded-lg bg-black/30 p-1">
          <button type="button" className={`rounded-md px-3 py-2 text-sm font-bold ${mode === 'pin' ? 'bg-[#f5a623] text-black' : 'text-slate-300'}`} onClick={() => setMode('pin')}>PIN</button>
          <button type="button" className={`rounded-md px-3 py-2 text-sm font-bold ${mode === 'password' ? 'bg-[#f5a623] text-black' : 'text-slate-300'}`} onClick={() => setMode('password')}>Parol</button>
        </div>
        {mode === 'pin' ? (
          <label className="block">
            <span className="field-label">Admin PIN</span>
            <input className="h-11 w-full px-3" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
          </label>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="field-label">Username yoki email</span>
              <input className="h-11 w-full px-3" value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className="block">
              <span className="field-label">Parol</span>
              <input type="password" className="h-11 w-full px-3" value={password} placeholder="2202 yoki yangi parol" onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
        )}
        <button className="btn btn-primary mt-6 w-full" disabled={loading}>{loading ? 'Tekshirilmoqda...' : 'Kirish'}</button>
      </form>
    </div>
  );
}
