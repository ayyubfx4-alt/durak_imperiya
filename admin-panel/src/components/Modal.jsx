import React, { useEffect } from 'react';

export default function Modal({ open, title, children, footer, onClose, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className={`card max-h-[90vh] w-full overflow-hidden shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>
        <div className="flex items-center justify-between border-b border-[#1e1e2e] px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn h-9 min-h-0 w-9 p-0" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="max-h-[calc(90vh-132px)] overflow-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[#1e1e2e] px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
