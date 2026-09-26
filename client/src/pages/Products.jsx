import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtQty } from '../api';
import { Empty, Field, Modal, PageHeader, StockBadge, useLoad, useToast } from '../components/ui';

const blank = { name: '', sku: '', category_id: '', uom: 'Units', unit_cost: 0, min_qty: 0, max_qty: 0, initial_qty: '', initial_location_id: '' };
const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

export default function Products() {
  const toast = useToast();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const filters = {
    search: sp.get('search') || '',
    category_id: sp.get('category_id') || '',
    warehouse_id: sp.get('warehouse_id') || '',
    stock: sp.get('stock') || '',
  };
  const setFilter = (k, v) => {
    const n = new URLSearchParams(sp);
    v ? n.set(k, v) : n.delete(k);
    setSp(n, { replace: true });
  };

  const { data: products, reload, loading } = useLoad(() => api('/products', { params: filters }), [sp.toString()]);
  const { data: cats, reload: reloadCats } = useLoad(() => api('/categories'), []);
  const { data: whs } = useLoad(() => api('/warehouses'), []);
  const { data: locations } = useLoad(() => api('/locations'), []);

  const [editing, setEditing] = useState(null); // product form
  const [viewing, setViewing] = useState(null); // product detail
  const [reorder, setReorder] = useState(null);
  const [stockEdit, setStockEdit] = useState(null); // { product, location_id, quantity }
  const [error, setError] = useState('');

  const openEdit = (p) => { setError(''); setEditing(p ? { ...p, category_id: p.category_id || '' } : { ...blank }); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing.id) await api(`/products/${editing.id}`, { method: 'PUT', body: editing });
      else await api('/products', { method: 'POST', body: editing });
      toast(editing.id ? 'Product updated' : 'Product created');
      setEditing(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete ${p.name}?`)) return;
    try {
      await api(`/products/${p.id}`, { method: 'DELETE' });
      toast('Product deleted');
      setEditing(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const addCategory = async () => {
    const name = window.prompt('New category name');
    if (!name) return;
    try {
      const c = await api('/categories', { method: 'POST', body: { name } });
      await reloadCats();
      setEditing((ed) => ({ ...ed, category_id: c.id }));
    } catch (err) {
      setError(err.message);
    }
  };

  const view = async (p) => setViewing(await api(`/products/${p.id}`));

  const runReorder = async () => {
    try {
      const r = await api('/products/reorder', { method: 'POST', body: { location_id: reorder } });
      toast(r.message);
      setReorder(null);
      if (r.id) navigate(`/operation/${r.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const set = (k) => (e) => setEditing({ ...editing, [k]: e.target.value });

  // "User must be able to update the stock from here" -> records an adjustment
  const openStockEdit = async (p) => {
    const loc = locations?.[0]?.id || '';
    const detail = await api(`/products/${p.id}`);
    const at = (id) => detail.stock.find((s) => String(s.location_id) === String(id))?.quantity ?? 0;
    setStockEdit({ product: p, detail, location_id: loc, quantity: at(loc), at });
  };
  const saveStock = async () => {
    try {
      await api(`/products/${stockEdit.product.id}/set-stock`, { method: 'POST', body: { location_id: stockEdit.location_id, quantity: stockEdit.quantity } });
      toast(`Stock updated for ${stockEdit.product.name}`);
      setStockEdit(null);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Stock" subtitle="Products, stock per location, reordering rules. Click a row to see stock by location.">
        <button className="btn" onClick={() => setReorder(locations?.[0]?.id || '')}>Replenish low stock</button>
        <button className="btn btn-primary" onClick={() => openEdit(null)}>+ New product</button>
      </PageHeader>

      <div className="filters card">
        <input className="search" placeholder="Search by name or SKU…" defaultValue={filters.search}
          onChange={(e) => setFilter('search', e.target.value)} />
        <select value={filters.category_id} onChange={(e) => setFilter('category_id', e.target.value)}>
          <option value="">All categories</option>
          {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.warehouse_id} onChange={(e) => setFilter('warehouse_id', e.target.value)}>
          <option value="">All warehouses</option>
          {whs?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={filters.stock} onChange={(e) => setFilter('stock', e.target.value)}>
          <option value="">Any stock level</option>
          <option value="alert">Low or out of stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
      </div>

      <div className="card no-pad">
        {products?.length ? (
          <div className="table-wrap">
            <table className="table hover">
              <thead>
                <tr><th>Product</th><th>SKU</th><th>Category</th><th className="num">Per unit cost</th><th className="num">On hand</th><th className="num">Free to use</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} onClick={() => view(p)}>
                    <td><strong>{p.name}</strong></td>
                    <td className="mono">{p.sku}</td>
                    <td>{p.category_name || '—'}</td>
                    <td className="num">{rs(p.unit_cost)}</td>
                    <td className="num">{fmtQty(p.on_hand)} {p.uom}</td>
                    <td className="num">{fmtQty(p.free_to_use)}</td>
                    <td><StockBadge status={p.stock_status} /></td>
                    <td className="right nowrap">
                      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openStockEdit(p); }}>Update stock</button>{' '}
                      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(p); }}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading && <Empty>No products match. Create your first product to get started.</Empty>}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit product' : 'New product'} onClose={() => setEditing(null)}
          footer={<>
            {editing.id && <button className="btn btn-danger-ghost" onClick={() => remove(editing)}>Delete</button>}
            <span className="spacer" />
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" form="product-form">Save</button>
          </>}>
          <form id="product-form" onSubmit={save} className="stack">
            {error && <div className="alert alert-error">{error}</div>}
            <Field label="Name"><input required autoFocus value={editing.name} onChange={set('name')} placeholder="e.g. Steel Rods" /></Field>
            <div className="grid-2">
              <Field label="SKU / Code"><input required value={editing.sku} onChange={set('sku')} placeholder="RM-STEEL-01" /></Field>
              <Field label="Unit of measure">
                <input list="uoms" required value={editing.uom} onChange={set('uom')} />
                <datalist id="uoms">{['Units', 'kg', 'g', 'm', 'litres', 'boxes', 'sheets', 'rolls', 'reams'].map((u) => <option key={u} value={u} />)}</datalist>
              </Field>
            </div>
            <Field label="Category">
              <div className="input-row">
                <select value={editing.category_id} onChange={set('category_id')}>
                  <option value="">— None —</option>
                  {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" className="btn" onClick={addCategory}>+ New</button>
              </div>
            </Field>
            <Field label="Per unit cost (₹)">
              <input type="number" min="0" step="any" value={editing.unit_cost} onChange={set('unit_cost')} />
            </Field>
            <div className="grid-2">
              <Field label="Reorder min qty" hint="Alert when stock falls to this level">
                <input type="number" min="0" step="any" value={editing.min_qty} onChange={set('min_qty')} />
              </Field>
              <Field label="Reorder max qty" hint="Replenish up to this level">
                <input type="number" min="0" step="any" value={editing.max_qty} onChange={set('max_qty')} />
              </Field>
            </div>
            {!editing.id && (
              <div className="grid-2">
                <Field label="Initial stock (optional)">
                  <input type="number" min="0" step="any" value={editing.initial_qty} onChange={set('initial_qty')} />
                </Field>
                <Field label="Initial stock location">
                  <select value={editing.initial_location_id} onChange={set('initial_location_id')}>
                    <option value="">— Select —</option>
                    {locations?.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
                  </select>
                </Field>
              </div>
            )}
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)}
          footer={<>
            <Link className="btn" to={`/moves?product_id=${viewing.id}`}>View stock ledger</Link>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => { setViewing(null); openEdit(viewing); }}>Edit</button>
          </>}>
          <div className="detail-grid">
            <div><span className="muted">SKU</span><div className="mono">{viewing.sku}</div></div>
            <div><span className="muted">Category</span><div>{viewing.category_name || '—'}</div></div>
            <div><span className="muted">Unit</span><div>{viewing.uom}</div></div>
            <div><span className="muted">Per unit cost</span><div>{rs(viewing.unit_cost)}</div></div>
            <div><span className="muted">Reorder rule</span><div>min {fmtQty(viewing.min_qty)} · max {fmtQty(viewing.max_qty)}</div></div>
          </div>
          <h4>Stock by location</h4>
          {viewing.stock.length ? (
            <table className="table">
              <thead><tr><th>Location</th><th>Warehouse</th><th className="num">Quantity</th></tr></thead>
              <tbody>
                {viewing.stock.map((s) => (
                  <tr key={s.location_id}><td>{s.full_name}</td><td>{s.warehouse_name}</td><td className="num">{fmtQty(s.quantity)} {viewing.uom}</td></tr>
                ))}
                <tr className="total"><td colSpan={2}>Total on hand</td><td className="num">{fmtQty(viewing.on_hand)} {viewing.uom}</td></tr>
              </tbody>
            </table>
          ) : <Empty>No stock on hand.</Empty>}
        </Modal>
      )}

      {stockEdit && (
        <Modal title={`Update stock · ${stockEdit.product.name}`} onClose={() => setStockEdit(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setStockEdit(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveStock}>Update</button></>}>
          <div className="stack">
            <p className="muted small">Enter the quantity physically counted at a location. The difference is saved as an inventory adjustment and shows in Move History.</p>
            <Field label="Location">
              <select value={stockEdit.location_id} onChange={(e) => setStockEdit({ ...stockEdit, location_id: e.target.value, quantity: stockEdit.at(e.target.value) })}>
                {locations?.map((l) => <option key={l.id} value={l.id}>{l.full_name} (now {fmtQty(stockEdit.at(l.id))})</option>)}
              </select>
            </Field>
            <Field label={`Counted quantity (${stockEdit.product.uom})`}>
              <input type="number" min="0" step="any" autoFocus value={stockEdit.quantity} onChange={(e) => setStockEdit({ ...stockEdit, quantity: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {reorder !== null && (
        <Modal title="Replenish low stock" onClose={() => setReorder(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setReorder(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={runReorder}>Create draft receipt</button></>}>
          <p className="muted">Creates one draft receipt for every product at or below its reorder minimum, topping each up to its max quantity.</p>
          <Field label="Receive into">
            <select value={reorder} onChange={(e) => setReorder(e.target.value)}>
              {locations?.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </>
  );
}