/* eslint-disable */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { STATUS_LABEL } from '../api';

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Small building blocks ----------
export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export function StockBadge({ status }) {
  if (status === 'out') return <span className="badge badge-canceled">Out of stock</span>;
  if (status === 'low') return <span className="badge badge-waiting">Low stock</span>;
  return <span className="badge badge-done">In stock</span>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}

/** Load data from the API, re-running when deps change. */
export function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    return fn()
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/** List / Kanban switch (remembered per page in this browser). */
export function useViewMode(key) {
  const [view, setViewState] = useState(() => {
    try { return localStorage.getItem(key) || 'list'; } catch { return 'list'; }
  });
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem(key, v); } catch { /* ignore */ }
  };
  return [view, setView];
}

export function ViewToggle({ view, setView }) {
  return (
    <div className="view-toggle">
      <button className={`tool-btn ${view === 'list' ? 'on' : ''}`} title="List view" onClick={() => setView('list')}>☰</button>
      <button className={`tool-btn ${view === 'kanban' ? 'on' : ''}`} title="Kanban view" onClick={() => setView('kanban')}>▦</button>
    </div>
  );
}