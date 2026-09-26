import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDateTime, fmtQty, TYPE_META } from '../api';
import { Empty, StatusBadge, ViewToggle, useLoad, useViewMode } from '../components/ui';

export default function MoveHistory() {
  const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(['search', 'type', 'warehouse_id', 'product_id', 'from', 'to'].map((k) => [k, sp.get(k) || '']));
  const setFilter = (k, v) => {
    const n = new URLSearchParams(sp);
    v ? n.set(k, v) : n.delete(k);
    setSp(n, { replace: true });
  };
  const { data: moves, loading } = useLoad(() => api('/moves', { params: f }), [sp.toString()]);
  const { data: whs } = useLoad(() => api('/warehouses'), []);
  const { data: products } = useLoad(() => api('/products'), []);

  const navigate = useNavigate();
  const [view, setView] = useViewMode('moves-view');
  const [showSearch, setShowSearch] = useState(!!f.search);
  const whLocIds = f.warehouse_id ? new Set(whs?.find((w) => String(w.id) === f.warehouse_id)?.locations.map((l) => l.id)) : null;

  // Sign of a move relative to the warehouse: into internal stock = +, out of it = −
  const sign = (m) => {
    const inside = (id, t) => t === 'internal' && (!whLocIds || whLocIds.has(id));
    const fromIn = inside(m.from_location_id, m.from_type);
    const toIn = inside(m.to_location_id, m.to_type);
    if (fromIn && toIn) return 0;
    return toIn ? 1 : -1;
  };

  return (
    <>
      <div className="list-head">
        <div className="list-title">
          <h1>Move History</h1>
          <span className="muted small">Stock ledger · <span className="text-success">in = green</span> · <span className="text-danger">out = red</span></span>
        </div>
        <div className="list-tools">
          {showSearch && (
            <input className="search" autoFocus placeholder="Search reference, contact or product…" defaultValue={f.search}
              onChange={(e) => setFilter('search', e.target.value)} />
          )}
          <button className={`tool-btn ${showSearch ? 'on' : ''}`} title="Search" onClick={() => setShowSearch(!showSearch)}>🔍</button>
          <ViewToggle view={view} setView={setView} />
        </div>
      </div>
      <div className="filters">
        <select value={f.product_id} onChange={(e) => setFilter('product_id', e.target.value)}>
          <option value="">All products</option>
          {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={f.type} onChange={(e) => setFilter('type', e.target.value)}>
          <option value="">All operation types</option>
          {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={f.warehouse_id} onChange={(e) => setFilter('warehouse_id', e.target.value)}>
          <option value="">All warehouses</option>
          {whs?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input type="date" value={f.from} onChange={(e) => setFilter('from', e.target.value)} title="From date" />
        <input type="date" value={f.to} onChange={(e) => setFilter('to', e.target.value)} title="To date" />
      </div>

      {!loading && !moves?.length && <div className="card"><Empty>No stock moves match these filters.</Empty></div>}

      {!!moves?.length && view === 'list' && (
        <div className="card no-pad">
          <div className="table-wrap">
            <table className="table hover">
              <thead>
                <tr><th>Reference</th><th>Date</th><th>Contact</th><th>Product</th><th>From</th><th>To</th><th className="num">Quantity</th><th>Status</th></tr>
              </thead>
              <tbody>
                {moves.map((m) => {
                  const s = sign(m);
                  return (
                    <tr key={m.id} className={s > 0 ? 'row-in' : s < 0 ? 'row-out' : ''} onClick={() => navigate(`/operation/${m.operation_id}`)}>
                      <td className="mono"><strong>{m.reference}</strong><div className="small muted">{TYPE_META[m.op_type]?.single}</div></td>
                      <td className="nowrap">{fmtDateTime(m.created_at)}</td>
                      <td>{m.partner || '—'}</td>
                      <td>{m.product_name}<div className="small muted mono">{m.sku}</div></td>
                      <td>{m.from_name}</td>
                      <td>{m.to_name}</td>
                      <td className="num nowrap qty-cell">{s > 0 ? '+' : s < 0 ? '−' : ''}{fmtQty(m.quantity)} {m.uom}</td>
                      <td><StatusBadge status="done" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!!moves?.length && view === 'kanban' && (
        <div className="kanban">
          {Object.entries(TYPE_META).map(([t, meta]) => {
            const col = moves.filter((m) => m.op_type === t);
            return (
              <div className="kanban-col" key={t}>
                <div className="kanban-head"><strong>{meta.label}</strong> <span className="muted">{col.length}</span></div>
                {col.map((m) => {
                  const s = sign(m);
                  return (
                    <div key={m.id} className={`kanban-card ${s > 0 ? 'card-in' : s < 0 ? 'card-out' : ''}`} onClick={() => navigate(`/operation/${m.operation_id}`)}>
                      <div className="row-between"><span className="mono"><strong>{m.reference}</strong></span>
                        <strong className={s > 0 ? 'text-success' : s < 0 ? 'text-danger' : ''}>{s > 0 ? '+' : s < 0 ? '−' : ''}{fmtQty(m.quantity)} {m.uom}</strong></div>
                      <div>{m.product_name}</div>
                      <div className="small muted">{m.from_name} → {m.to_name}</div>
                      <div className="small muted">{fmtDateTime(m.created_at)}{m.partner ? ` · ${m.partner}` : ''}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}