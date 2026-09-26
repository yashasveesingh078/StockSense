import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDateTime, fmtQty, TYPE_META } from '../api';
import { Empty, PageHeader, useLoad } from '../components/ui';

function Kpi({ label, value, tone, to, hint }) {
  const navigate = useNavigate();
  return (
    <button className={`kpi kpi-${tone || 'default'}`} onClick={() => to && navigate(to)}>
      <div className="kpi-value">{value ?? '–'}</div>
      <div className="kpi-label">{label}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </button>
  );
}

// Wireframe card: "Receipt  [4 to receive]  1 Late · 2 waiting · 6 operations"
function OpCard({ title, type, verb, c, q }) {
  const navigate = useNavigate();
  const go = (extra) => navigate(`/operations/${type}?${[q, extra].filter(Boolean).join('&')}`);
  return (
    <div className="card op-card">
      <h3>{title}</h3>
      <div className="op-card-body">
        <button className="btn btn-primary" onClick={() => go('status=ready')}>
          {c?.to_process ?? 0} to {verb}
        </button>
        <div className="op-card-stats">
          <button className="link-btn text-danger" onClick={() => go('late=1')}>{c?.late ?? 0} Late</button>
          {type === 'delivery' && <button className="link-btn text-warn" onClick={() => go('status=waiting')}>{c?.waiting ?? 0} Waiting</button>}
          <button className="link-btn" onClick={() => go('upcoming=1')}>{c?.upcoming ?? 0} Operations</button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [filters, setFilters] = useState({ warehouse_id: '', category_id: '' });
  const navigate = useNavigate();
  const { data: d, error } = useLoad(() => api('/dashboard', { params: filters }), [filters.warehouse_id, filters.category_id]);
  const { data: whs } = useLoad(() => api('/warehouses'), []);
  const { data: cats } = useLoad(() => api('/categories'), []);
  const [docType, setDocType] = useState('');
  const [docStatus, setDocStatus] = useState('');

  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const withQ = (path, extra = '') => `${path}?${[q, extra].filter(Boolean).join('&')}`;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Real-time snapshot of your inventory">
        <select value={filters.warehouse_id} onChange={(e) => setFilters({ ...filters, warehouse_id: e.target.value })}>
          <option value="">All warehouses</option>
          {whs?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={filters.category_id} onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}>
          <option value="">All categories</option>
          {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </PageHeader>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid-2 gap">
        <OpCard title="Receipt" type="receipt" verb="receive" c={d?.receipt_card} q={q} />
        <OpCard title="Delivery" type="delivery" verb="deliver" c={d?.delivery_card} q={q} />
      </div>
      <p className="small muted legend">
        <b>Late:</b> scheduled date is before today · <b>Operations:</b> scheduled after today · <b>Waiting:</b> waiting for stock
      </p>

      <div className="kpis">
        <Kpi label="Products in stock" value={d?.in_stock} hint={d && `of ${d.total_products} products`} to="/products" />
        <Kpi label="Low stock" value={d?.low_stock} tone="warn" to="/products?stock=low" hint="At or below reorder min" />
        <Kpi label="Out of stock" value={d?.out_of_stock} tone="danger" to="/products?stock=out" />
        <Kpi label="Pending receipts" value={d?.pending_receipts} tone="info" to={withQ('/operations/receipt', 'open=1')} />
        <Kpi label="Pending deliveries" value={d?.pending_deliveries} tone="info" to={withQ('/operations/delivery', 'open=1')} />
        <Kpi label="Internal transfers scheduled" value={d?.pending_transfers} tone="info" to={withQ('/operations/internal', 'open=1')} />
      </div>
      {d?.late_operations > 0 && (
        <div className="alert alert-warn">
          {d.late_operations} operation{d.late_operations > 1 ? 's are' : ' is'} past the scheduled date and not yet done.
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>Find documents</h3></div>
        <div className="filters">
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">All document types</option>
            {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={docStatus} onChange={(e) => setDocStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="waiting">Waiting</option>
            <option value="ready">Ready</option>
            <option value="done">Done</option>
            <option value="canceled">Canceled</option>
          </select>
          <button className="btn" onClick={() => navigate(withQ(`/operations${docType ? '/' + docType : ''}`, docStatus ? `status=${docStatus}` : ''))}>
            Show documents
          </button>
        </div>
      </div>

      <div className="grid-2 gap">
        <div className="card">
          <div className="card-head">
            <h3>Stock alerts</h3>
            <Link to="/products?stock=alert">View all</Link>
          </div>
          {d?.alerts?.length ? (
            <table className="table">
              <thead><tr><th>Product</th><th className="num">On hand</th><th className="num">Min</th><th /></tr></thead>
              <tbody>
                {d.alerts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}<div className="small muted">{a.sku}</div></td>
                    <td className="num">{fmtQty(a.on_hand)} {a.uom}</td>
                    <td className="num">{fmtQty(a.min_qty)}</td>
                    <td>{a.status === 'out' ? <span className="badge badge-canceled">Out</span> : <span className="badge badge-waiting">Low</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>All products are above their minimum levels.</Empty>}
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Recent stock moves</h3>
            <Link to="/moves">Move history</Link>
          </div>
          {d?.recent_moves?.length ? (
            <ul className="feed">
              {d.recent_moves.map((m) => (
                <li key={m.id}>
                  <div>
                    <strong>{m.product_name}</strong> · {fmtQty(m.quantity)} {m.uom}
                    <div className="small muted">{m.from_name} → {m.to_name}</div>
                  </div>
                  <div className="right small muted">
                    <div>{m.reference}</div>
                    <div>{fmtDateTime(m.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>No stock moves yet.</Empty>}
        </div>
      </div>
    </>
  );
}