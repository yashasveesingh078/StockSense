// One form for all four operation types (wireframe layout):
//   [New] Receipt
//   [To Do | Validate] [Print] [Cancel]                      Draft > Ready > Done
//   WH/IN/0001 · Receive From · Schedule Date · Responsible · Products table
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, fmtDateTime, fmtQty, TYPE_META } from '../api';
import { useAuth } from '../auth';
import { Field, StatusBadge, useLoad, useToast } from '../components/ui';

const today = () => new Date().toISOString().slice(0, 10);

function StatusBar({ type, status }) {
  const steps = type === 'delivery' || type === 'internal' ? ['draft', 'waiting', 'ready', 'done'] : type === 'adjustment' ? ['draft', 'done'] : ['draft', 'ready', 'done'];
  if (status === 'canceled') return <StatusBadge status="canceled" />;
  const idx = steps.indexOf(status);
  return (
    <div className="statusbar">
      {steps.map((s, i) => (
        <span key={s} className={`step ${i === idx ? 'current' : ''} ${i < idx ? 'past' : ''}`}>
          {s[0].toUpperCase() + s.slice(1)}
        </span>
      ))}
    </div>
  );
}

export default function OperationForm() {
  const { id, type: newType } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const isNew = !id;

  const [op, setOp] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: locations } = useLoad(() => api('/locations'), []);
  const { data: products } = useLoad(() => api('/products'), []);

  const load = async () => {
    if (isNew) {
      setOp(null);
      setForm({ type: newType, partner: '', delivery_address: '', source_location_id: '', dest_location_id: '', location_id: '',
        scheduled_date: today(), notes: '', lines: [{ product_id: '', quantity: 1 }] });
      return;
    }
    const o = await api(`/operations/${id}`);
    setOp(o);
    setForm({
      type: o.type, partner: o.partner || '', delivery_address: o.delivery_address || '',
      source_location_id: o.source_location_id, dest_location_id: o.dest_location_id, location_id: o.source_location_id,
      scheduled_date: o.scheduled_date || '', notes: o.notes || '',
      lines: o.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
    });
  };
  useEffect(() => { load().catch((e) => setError(e.message)); /* eslint-disable-next-line */ }, [id, newType]);

  // Default locations once they load
  useEffect(() => {
    if (!isNew || !locations?.length || !form) return;
    // default to the first warehouse's first location (e.g. WH/Stock)
    const sorted = [...locations].sort((a, b) => a.warehouse_id - b.warehouse_id || a.id - b.id);
    const first = sorted[0].id;
    setForm((f) => ({
      ...f,
      source_location_id: f.source_location_id || first,
      dest_location_id: f.dest_location_id || (f.type === 'internal' ? sorted[1]?.id || first : first),
      location_id: f.location_id || first,
    }));
    // eslint-disable-next-line
  }, [locations, isNew, form?.type]);

  const type = form?.type;
  const status = op?.status || 'draft';
  const open = !['done', 'canceled'].includes(status);
  const editable = isNew || status === 'draft';
  const srcLoc = type === 'adjustment' ? form?.location_id : form?.source_location_id;

  // Live stock at the source location (for "available" and red out-of-stock lines)
  const { data: stockAtSrc } = useLoad(
    () => (srcLoc && type !== 'receipt' ? api('/products', { params: { location_id: srcLoc } }) : Promise.resolve([])),
    [srcLoc, type, status]
  );
  const available = useMemo(() => Object.fromEntries((stockAtSrc || []).map((p) => [p.id, p.on_hand])), [stockAtSrc]);
  const productMap = useMemo(() => Object.fromEntries((products || []).map((p) => [p.id, p])), [products]);

  if (!form) return error ? <div className="alert alert-error">{error}</div> : <div className="muted">Loading…</div>;
  const meta = TYPE_META[type];

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setLine = (i, k, v) => setForm({ ...form, lines: form.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const addLine = () => setForm({ ...form, lines: [...form.lines, { product_id: '', quantity: 1 }] });
  const removeLine = (i) => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) });
  const payload = () => ({ ...form, lines: form.lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) })) });

  // Lines that need more stock than is available (delivery / transfer) -> shown in red
  const shortLines = type === 'delivery' || type === 'internal'
    ? form.lines.filter((l) => l.product_id && open && Number(l.quantity) > (available[l.product_id] ?? 0))
    : [];

  const run = async (fn, okMsg) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (okMsg) toast(okMsg);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  /** Save the draft (create or update). Returns the operation id. */
  const saveDraft = async () => {
    if (isNew) return (await api('/operations', { method: 'POST', body: payload() })).id;
    if (status === 'draft') await api(`/operations/${id}`, { method: 'PUT', body: payload() });
    return Number(id);
  };

  const onSave = () => run(async () => {
    const oid = await saveDraft();
    if (isNew) navigate(`/operation/${oid}`, { replace: true });
    else await load();
  }, 'Saved');

  const action = (name, msg, body) => run(async () => {
    const oid = await saveDraft();
    await api(`/operations/${oid}/${name}`, { method: 'POST', body: body || {} });
    if (isNew) navigate(`/operation/${oid}`, { replace: true });
    else await load();
  }, msg);

  const onDelete = () => run(async () => {
    if (!window.confirm('Delete this draft?')) return;
    await api(`/operations/${id}`, { method: 'DELETE' });
    navigate(`/operations/${type}`);
  });

  const locOpt = locations?.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>);
  const responsible = op ? op.responsible_name : user.name;

  return (
    <>
      <div className="list-head no-print">
        <div className="list-title">
          <Link className="btn" to={`/operation/new/${type}`}>New</Link>
          <h1><Link to={`/operations/${type}`} className="plain">{meta.label}</Link> <span className="muted">/ {op ? op.reference : 'New'}</span></h1>
        </div>
      </div>

      <div className="form-toolbar no-print">
        <div className="actions">
          {status === 'draft' && type !== 'adjustment' && (
            <button className="btn btn-primary" disabled={busy} onClick={() => action('confirm', 'Moved to To Do')} title="Draft → Ready">To Do</button>
          )}
          {status === 'waiting' && <button className="btn" disabled={busy} onClick={() => action('confirm', 'Availability checked')}>Check availability</button>}
          {(status === 'ready' || status === 'waiting' || (type === 'adjustment' && status === 'draft')) && (
            <button className="btn btn-primary" disabled={busy}
              onClick={() => action('validate', type === 'adjustment' ? 'Stock adjusted' : 'Validated. Stock updated')}>
              {type === 'adjustment' ? 'Apply' : 'Validate'}
            </button>
          )}
          {status === 'done' && <button className="btn" onClick={() => window.print()}>Print</button>}
          {editable && <button className="btn" disabled={busy} onClick={onSave}>Save</button>}
          {!isNew && open && <button className="btn" disabled={busy} onClick={() => action('cancel', 'Canceled')}>Cancel</button>}
          {!isNew && status === 'draft' && <button className="btn btn-danger-ghost" disabled={busy} onClick={onDelete}>Delete</button>}
        </div>
        <StatusBar type={type} status={status} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {shortLines.length > 0 && (
        <div className="alert alert-error">
          Not in stock at the source location: {shortLines.map((l) => productMap[l.product_id]?.name).join(', ')}. These lines are marked red.
          {status === 'waiting' && ' Receive or transfer stock, then click “Check availability”.'}
        </div>
      )}

      <div className="card print-area">
        <div className="print-only print-brand">StockSense · {meta.single}</div>
        <h2 className="op-title">{op ? op.reference : `New ${meta.single}`}</h2>
        <div className="grid-2">
          {type === 'receipt' && (
            <Field label="Receive From">
              <input disabled={!editable} value={form.partner} onChange={set('partner')} placeholder="Vendor / supplier" />
            </Field>
          )}
          {type === 'delivery' && (
            <Field label="Contact (customer)">
              <input disabled={!editable} value={form.partner} onChange={set('partner')} placeholder="Customer name" />
            </Field>
          )}
          {type !== 'adjustment' && (
            <Field label="Schedule Date">
              <input type="date" disabled={!editable} value={form.scheduled_date} onChange={set('scheduled_date')} />
            </Field>
          )}
          {type === 'delivery' && (
            <Field label="Delivery Address">
              <input disabled={!editable} value={form.delivery_address} onChange={set('delivery_address')} placeholder="Shipping address" />
            </Field>
          )}
          <Field label="Responsible">
            <input disabled value={responsible || ''} />
          </Field>
          {type === 'delivery' && (
            <Field label="Operation type"><input disabled value="Delivery Order" /></Field>
          )}
          {(type === 'delivery' || type === 'internal') && (
            <Field label="Source location">
              <select disabled={!editable} value={form.source_location_id} onChange={set('source_location_id')}>{locOpt}</select>
            </Field>
          )}
          {(type === 'receipt' || type === 'internal') && (
            <Field label="Destination location">
              <select disabled={!editable} value={form.dest_location_id} onChange={set('dest_location_id')}>{locOpt}</select>
            </Field>
          )}
          {type === 'adjustment' && (
            <Field label="Location counted">
              <select disabled={!editable} value={form.location_id} onChange={set('location_id')}>{locOpt}</select>
            </Field>
          )}
          {(type === 'adjustment' || type === 'internal') && (
            <Field label={type === 'adjustment' ? 'Reason' : 'Notes'}>
              <input disabled={!editable} value={form.notes} onChange={set('notes')} placeholder={type === 'adjustment' ? 'e.g. 3 kg damaged' : ''} />
            </Field>
          )}
        </div>

        {type === 'delivery' && op && open && status !== 'draft' && (
          <div className="pickpack no-print">
            <label className="check">
              <input type="checkbox" checked={!!op.picked} disabled={busy}
                onChange={(e) => action('pick-pack', e.target.checked ? 'Items picked' : null, { picked: e.target.checked, packed: e.target.checked ? !!op.packed : false })} />
              <span><strong>Pick</strong> items</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={!!op.packed} disabled={busy || !op.picked}
                onChange={(e) => action('pick-pack', e.target.checked ? 'Items packed' : null, { packed: e.target.checked })} />
              <span><strong>Pack</strong> items</span>
            </label>
            <span className="muted small">then Validate to ship</span>
          </div>
        )}

        <h4>Products</h4>
        <div className="table-wrap">
          <table className="table lines">
            <thead>
              <tr>
                <th>Product</th>
                {type !== 'receipt' && open && <th className="num">{type === 'adjustment' ? 'Recorded qty' : 'Available'}</th>}
                <th className="num">{type === 'adjustment' ? 'Counted qty' : 'Quantity'}</th>
                {type === 'adjustment' && open && <th className="num">Difference</th>}
                <th>Unit</th>
                {editable && <th className="no-print" />}
              </tr>
            </thead>
            <tbody>
              {form.lines.map((l, i) => {
                const p = productMap[l.product_id];
                const avail = available[l.product_id] ?? 0;
                const short = shortLines.includes(l);
                const diff = Number(l.quantity) - avail;
                return (
                  <tr key={i} className={short ? 'row-danger' : ''}>
                    <td>
                      {editable ? (
                        <select value={l.product_id} onChange={(e) => setLine(i, 'product_id', e.target.value)}>
                          <option value="">Select a product…</option>
                          {products?.map((pp) => <option key={pp.id} value={pp.id}>[{pp.sku}] {pp.name}</option>)}
                        </select>
                      ) : p ? `[${p.sku}] ${p.name}` : '…'}
                    </td>
                    {type !== 'receipt' && open && <td className="num">{l.product_id ? fmtQty(avail) : '—'}</td>}
                    <td className="num">
                      {editable ? (
                        <input className="qty" type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
                      ) : fmtQty(l.quantity)}
                    </td>
                    {type === 'adjustment' && open && (
                      <td className={`num ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-success' : 'muted'}`}>
                        {l.product_id ? (diff > 0 ? '+' : '') + fmtQty(diff) : '—'}
                      </td>
                    )}
                    <td className="muted">{p?.uom}</td>
                    {editable && <td className="right no-print"><button className="icon-btn" onClick={() => removeLine(i)} aria-label="Remove line">×</button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && <button className="btn btn-link no-print" onClick={addLine}>+ New Product</button>}

        {op && (
          <div className="meta muted small">
            Created by {op.created_by_name || '—'} · {fmtDateTime(op.created_at)}
            {op.scheduled_date && <> · Scheduled {fmtDate(op.scheduled_date)}</>}
            {op.validated_at && <> · Done {fmtDateTime(op.validated_at)} <span className="no-print">· <Link to={`/moves?search=${op.reference}`}>see ledger entries</Link></span></>}
          </div>
        )}
      </div>
    </>
  );
}