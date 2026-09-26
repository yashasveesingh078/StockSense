// Settings ▾ Warehouse · Locations · Product Categories
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, Field, Modal, PageHeader, useLoad, useToast } from '../components/ui';

function useManager() {
  const { user } = useAuth();
  return user.role === 'manager';
}

// ---------- Warehouse: Name · Short Code · Address ----------
export function Warehouses() {
  const toast = useToast();
  const isManager = useManager();
  const { data: whs, reload } = useLoad(() => api('/warehouses'), []);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (form.id) await api(`/warehouses/${form.id}`, { method: 'PUT', body: form });
      else await api('/warehouses', { method: 'POST', body: form });
      toast('Warehouse saved');
      setForm(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader title="Warehouse" subtitle="Your warehouses. The short code is used in references like WH/IN/0001.">
        {isManager && <button className="btn btn-primary" onClick={() => { setError(''); setForm({ name: '', short_code: '', address: '' }); }}>NEW</button>}
      </PageHeader>
      {!isManager && <div className="alert alert-info">Only inventory managers can change warehouses.</div>}
      <div className="card no-pad">
        {whs?.length ? (
          <table className="table hover">
            <thead><tr><th>Name</th><th>Short Code</th><th>Address</th><th className="num">Locations</th></tr></thead>
            <tbody>
              {whs.map((w) => (
                <tr key={w.id} onClick={() => isManager && setForm(w)}>
                  <td><strong>{w.name}</strong></td>
                  <td className="mono">{w.short_code}</td>
                  <td>{w.address || '—'}</td>
                  <td className="num">{w.locations.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : whs && <Empty>No warehouses yet.</Empty>}
      </div>

      {form && (
        <Modal title={form.id ? 'Warehouse' : 'New warehouse'} onClose={() => setForm(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" form="wh-form">Save</button></>}>
          <form id="wh-form" className="stack" onSubmit={save}>
            {error && <div className="alert alert-error">{error}</div>}
            <Field label="Name"><input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Short Code" hint="1-6 letters/digits. Cannot be changed later.">
              <input required disabled={!!form.id} maxLength={6} value={form.short_code} onChange={(e) => setForm({ ...form, short_code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Address"><input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            {!form.id && <p className="small muted">A default “Stock” location is created automatically.</p>}
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------- Locations: Name · Short Code · Warehouse ----------
export function Locations() {
  const toast = useToast();
  const isManager = useManager();
  const { data: locs, reload } = useLoad(() => api('/locations'), []);
  const { data: whs } = useLoad(() => api('/warehouses'), []);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (form.id) await api(`/locations/${form.id}`, { method: 'PUT', body: form });
      else await api('/locations', { method: 'POST', body: form });
      toast('Location saved');
      setForm(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };
  const remove = async () => {
    try {
      await api(`/locations/${form.id}`, { method: 'DELETE' });
      toast('Location deleted');
      setForm(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };
  const wh = whs?.find((w) => String(w.id) === String(form?.warehouse_id));

  return (
    <>
      <PageHeader title="Locations" subtitle="Rooms, racks and shelves inside each warehouse, e.g. WH/Stock1.">
        {isManager && <button className="btn btn-primary" onClick={() => { setError(''); setForm({ name: '', short_code: '', warehouse_id: whs?.[0]?.id || '' }); }}>NEW</button>}
      </PageHeader>
      <div className="card no-pad">
        {locs?.length ? (
          <table className="table hover">
            <thead><tr><th>Location</th><th>Name</th><th>Short Code</th><th>Warehouse</th></tr></thead>
            <tbody>
              {locs.map((l) => (
                <tr key={l.id} onClick={() => isManager && setForm(l)}>
                  <td className="mono"><strong>{l.full_name}</strong></td>
                  <td>{l.name}</td>
                  <td className="mono">{l.short_code}</td>
                  <td>{l.warehouse_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : locs && <Empty>No locations yet.</Empty>}
      </div>

      {form && (
        <Modal title={form.id ? form.full_name : 'New location'} onClose={() => setForm(null)}
          footer={<>
            {form.id && <button className="btn btn-danger-ghost" onClick={remove}>Delete</button>}
            <span className="spacer" /><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" form="loc-form">Save</button></>}>
          <form id="loc-form" className="stack" onSubmit={save}>
            {error && <div className="alert alert-error">{error}</div>}
            <Field label="Name"><input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Stock Room 1" /></Field>
            <Field label="Short Code" hint={!form.id && wh && form.short_code ? `Full name will be ${wh.short_code}/${form.short_code.replace(/\s+/g, '')}` : 'Cannot be changed later.'}>
              <input required disabled={!!form.id} value={form.short_code || ''} onChange={(e) => setForm({ ...form, short_code: e.target.value })} placeholder="e.g. Stock1" />
            </Field>
            <Field label="Warehouse">
              <select required disabled={!!form.id} value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
                {whs?.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.short_code})</option>)}
              </select>
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------- Product categories ----------
export function Categories() {
  const toast = useToast();
  const { data: cats, reload } = useLoad(() => api('/categories'), []);
  const [name, setName] = useState('');

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/categories', { method: 'POST', body: { name } });
      setName('');
      toast('Category added');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async (id) => {
    await api(`/categories/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <>
      <PageHeader title="Product Categories" subtitle="Used to group products and filter the dashboard and lists." />
      <div className="card">
        <form className="input-row" onSubmit={add}>
          <input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} required />
          <button className="btn btn-primary">Add</button>
        </form>
        <div className="chips">
          {cats?.map((c) => (
            <span className="chip" key={c.id}>
              {c.name} <span className="muted">({c.product_count})</span>
              <button className="icon-btn" onClick={() => remove(c.id)} title="Remove">×</button>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}