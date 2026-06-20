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
    <div className="admin-modal-backdrop fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 sm:place-items-center sm:p-4">
      <div className={`admin-modal card flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-b-none shadow-2xl sm:max-h-[90vh] sm:rounded-b-lg ${wide ? 'sm:max-w-5xl' : 'sm:max-w-xl'}`}>
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-[#1e1e2e] px-4 py-3 sm:px-5 sm:py-4">
          <h2 className="min-w-0 truncate text-base font-bold sm:text-lg">{title}</h2>
          <button className="btn h-9 min-h-0 w-9 p-0" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">{children}</div>
        {footer && <div className="flex flex-shrink-0 flex-col-reverse gap-2 border-t border-[#1e1e2e] px-3 py-3 sm:flex-row sm:justify-end sm:px-5 sm:py-4">{footer}</div>}
      </div>
    </div>
  );
}
