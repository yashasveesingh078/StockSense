// Receipts / Deliveries / Transfers / Adjustments list — wireframe: [NEW] Title ....... 🔍 ☰ ▦ (list / kanban)
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, STATUS_LABEL, TYPE_META } from '../api';
import { Empty, StatusBadge, ViewToggle, useLoad, useViewMode } from '../components/ui';

const STATUSES = ['draft', 'waiting', 'ready', 'done', 'canceled'];
const isLate = (o) => o.scheduled_date && !['done', 'canceled'].includes(o.status) && o.scheduled_date < new Date().toISOString().slice(0, 10);

export default function Operations() {
  const { type } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const keys = ['status', 'open', 'late', 'upcoming', 'warehouse_id', 'category_id', 'search'];
  const f = { type: type || '', ...Object.fromEntries(keys.map((k) => [k, sp.get(k) || ''])) };
  const setFilter = (k, v) => {
    const n = new URLSearchParams(sp);
    v ? n.set(k, v) : n.delete(k);
    if (k === 'status') ['open', 'late', 'upcoming'].forEach((x) => n.delete(x));
    setSp(n, { replace: true });
  };

  const [view, setView] = useViewMode('ops-view');
  const [showSearch, setShowSearch] = useState(!!f.search);
  const { data: ops, loading, error } = useLoad(() => api('/operations', { params: f }), [type, sp.toString()]);
  const { data: whs } = useLoad(() => api('/warehouses'), []);
  const { data: cats } = useLoad(() => api('/categories'), []);
  const meta = TYPE_META[type] || { label: 'All Operations' };
  const quick = f.late ? 'Late' : f.upcoming ? 'Upcoming' : f.open ? 'Pending' : '';

  return (
    <>
      <div className="list-head">
        <div className="list-title">
          {type && <Link className="btn btn-primary" to={`/operation/new/${type}`}>NEW</Link>}
          <h1>{meta.label}</h1>
          {quick && <span className="chip">{quick} <button className="icon-btn" onClick={() => setSp({}, { replace: true })}>×</button></span>}
        </div>
        <div className="list-tools">
          {showSearch && (
            <input className="search" autoFocus placeholder="Search reference or contact…" defaultValue={f.search}
              onChange={(e) => setFilter('search', e.target.value)} />
          )}
          <button className={`tool-btn ${showSearch ? 'on' : ''}`} title="Search" onClick={() => setShowSearch(!showSearch)}>🔍</button>
          <ViewToggle view={view} setView={setView} />
        </div>
      </div>

      <div className="filters">
        <select value={f.status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {!type && (
          <select value="" onChange={(e) => navigate(`/operations/${e.target.value}?${sp}`)}>
            <option value="">All document types</option>
            {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        )}
        <select value={f.warehouse_id} onChange={(e) => setFilter('warehouse_id', e.target.value)}>
          <option value="">All warehouses</option>
          {whs?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={f.category_id} onChange={(e) => setFilter('category_id', e.target.value)}>
          <option value="">All product categories</option>
          {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!loading && !ops?.length && <div className="card"><Empty>No {meta.label.toLowerCase()} found.</Empty></div>}

      {!!ops?.length && view === 'list' && (
        <div className="card no-pad">
          <div className="table-wrap">
            <table className="table hover">
              <thead>
                <tr>
                  <th>Reference</th>
                  {!type && <th>Type</th>}
                  <th>From</th>
                  <th>To</th>
                  <th>Contact</th>
                  <th>Schedule date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.id} onClick={() => navigate(`/operation/${o.id}`)}>
                    <td className="mono"><strong>{o.reference}</strong></td>
                    {!type && <td>{TYPE_META[o.type].single}</td>}
                    <td>{o.source_name}</td>
                    <td>{o.type === 'adjustment' ? 'Inventory adjustment' : o.dest_name}</td>
                    <td>{o.partner || '—'}</td>
                    <td className={isLate(o) ? 'text-danger' : ''}>{fmtDate(o.scheduled_date)}{isLate(o) && ' · Late'}</td>
                    <td><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!!ops?.length && view === 'kanban' && (
        <div className="kanban">
          {STATUSES.map((s) => {
            const col = ops.filter((o) => o.status === s);
            return (
              <div className="kanban-col" key={s}>
                <div className="kanban-head"><StatusBadge status={s} /> <span className="muted">{col.length}</span></div>
                {col.map((o) => (
                  <div key={o.id} className="kanban-card" onClick={() => navigate(`/operation/${o.id}`)}>
                    <div className="mono"><strong>{o.reference}</strong></div>
                    <div>{o.partner || (o.type === 'internal' ? `${o.source_name} → ${o.dest_name}` : o.source_name)}</div>
                    <div className={`small ${isLate(o) ? 'text-danger' : 'muted'}`}>{fmtDate(o.scheduled_date)}{isLate(o) && ' · Late'}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}