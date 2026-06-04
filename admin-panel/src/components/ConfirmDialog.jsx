import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import Modal from './Modal.jsx';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback((options) => new Promise((resolve) => {
    setState({ ...options, resolve });
  }), []);
  const close = (value) => {
    state?.resolve(value);
    setState(null);
  };
  const value = useMemo(() => ({ confirm }), [confirm]);
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={!!state}
        title={state?.title || 'Tasdiqlash'}
        onClose={() => close(false)}
        footer={(
          <>
            <button className="btn" onClick={() => close(false)}>Bekor qilish</button>
            <button className={state?.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => close(true)}>
              Tasdiqlash
            </button>
          </>
        )}
      >
        <p className="text-sm text-slate-300">{state?.message}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const value = useContext(ConfirmContext);
  if (!value) throw new Error('useConfirm must be used inside ConfirmProvider');
  return value.confirm;
}
