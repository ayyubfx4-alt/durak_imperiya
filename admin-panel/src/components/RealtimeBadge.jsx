// Realtime badge — pulses every time the parent receives fresh data. A
// small "LIVE" pill with a heartbeat dot. Color reflects scaling mode.
import React, { useEffect, useState } from 'react';

export default function RealtimeBadge({ pulse, scaling }) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 350);
    return () => clearTimeout(t);
  }, [pulse]);
  const isRedis = scaling?.redis;
  return (
    <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{
          background: isRedis ? '#10b981' : '#f59e0b',
          boxShadow: flash ? `0 0 12px ${isRedis ? '#10b981' : '#f59e0b'}` : 'none',
          transition: 'box-shadow 0.3s',
        }}
      />
      <span className={isRedis ? 'text-emerald-400' : 'text-amber-400'}>
        LIVE {isRedis ? '· REDIS' : '· LOCAL'}
      </span>
    </div>
  );
}
