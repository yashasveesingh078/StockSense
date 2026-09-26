import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Field, PageHeader, useToast } from '../components/ui';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, current_password: '', new_password: '' });
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const u = await api('/auth/me', { method: 'PUT', body: form });
      setUser(u);
      setForm({ ...form, current_password: '', new_password: '' });
      toast('Profile updated');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader title="My Profile" />
      <div className="card narrow">
        <div className="profile-head">
          <div className="avatar avatar-lg">{user.name[0]?.toUpperCase()}</div>
          <div>
            <h3>{user.name}</h3>
            <div className="muted">{user.login_id} · {user.email} · {user.role === 'manager' ? 'Inventory Manager' : 'Warehouse Staff'}</div>
          </div>
        </div>
        <form className="stack" onSubmit={save}>
          {error && <div className="alert alert-error">{error}</div>}
          <Field label="Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><input disabled value={user.email} /></Field>
          <div className="grid-2">
            <Field label="Current password"><input type="password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} /></Field>
            <Field label="New password" hint="Leave blank to keep current"><input type="password" value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} /></Field>
          </div>
          <div><button className="btn btn-primary">Save changes</button></div>
        </form>
      </div>
    </>
  );
}