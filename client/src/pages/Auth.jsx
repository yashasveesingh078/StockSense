import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Field } from '../components/ui';

function AuthCard({ title, subtitle, children }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand auth-brand">
          <div className="logo">S</div>
          <div>
            <div className="brand-name">StockSense</div>
            <div className="brand-sub">Inventory Management System</div>
          </div>
        </div>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ login_id: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: form });
      login(r.token, r.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Sign in" subtitle="Welcome back. Manage your stock in one place.">
      <form onSubmit={submit} className="stack">
        {error && <div className="alert alert-error">{error}</div>}
        <Field label="Login ID">
          <input required autoFocus autoComplete="username" value={form.login_id} onChange={(e) => setForm({ ...form, login_id: e.target.value })} />
        </Field>
        <Field label="Password">
          <input type="password" required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'SIGN IN'}</button>
        <p className="center muted"><Link to="/forgot-password">Forgot Password?</Link> | <Link to="/signup">Sign Up</Link></p>
        <p className="center small muted">Demo: demoadmin / Admin@123</p>
      </form>
    </AuthCard>
  );
}

// Same rules as the backend (from the wireframe), checked before sending.
function validateSignup(f) {
  if (!/^[A-Za-z0-9_.]{6,12}$/.test(f.login_id)) return 'Login ID must be 6-12 characters (letters, numbers, _ or .)';
  if (f.password.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-z]/.test(f.password)) return 'Password must contain a lowercase letter';
  if (!/[A-Z]/.test(f.password)) return 'Password must contain an uppercase letter';
  if (!/[^A-Za-z0-9]/.test(f.password)) return 'Password must contain a special character';
  if (f.password !== f.confirm_password) return 'Passwords do not match';
  return '';
}

export function Signup() {
  const { login } = useAuth();
  const [form, setForm] = useState({ login_id: '', email: '', password: '', confirm_password: '', role: 'manager' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const err = validateSignup(form);
    if (err) return setError(err);
    setBusy(true);
    try {
      const r = await api('/auth/signup', { method: 'POST', body: form });
      login(r.token, r.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthCard title="Create account" subtitle="Set up your StockSense workspace.">
      <form onSubmit={submit} className="stack">
        {error && <div className="alert alert-error">{error}</div>}
        <Field label="Login ID" hint="6–12 characters, must be unique"><input required autoFocus maxLength={12} value={form.login_id} onChange={set('login_id')} /></Field>
        <Field label="Email ID"><input type="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Role">
          <select value={form.role} onChange={set('role')}>
            <option value="manager">Inventory Manager</option>
            <option value="staff">Warehouse Staff</option>
          </select>
        </Field>
        <Field label="Password" hint="8+ characters with a lowercase, an uppercase and a special character">
          <input type="password" required value={form.password} onChange={set('password')} />
        </Field>
        <Field label="Re-enter Password"><input type="password" required value={form.confirm_password} onChange={set('confirm_password')} /></Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : 'SIGN UP'}</button>
        <p className="center muted">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const sendOtp = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setInfo(r.dev_otp ? `${r.message} (Demo mode, no email server configured. Your OTP is ${r.dev_otp})` : r.message);
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError('');
    try {
      await api('/auth/reset-password', { method: 'POST', body: { email, otp, password } });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Reset password" subtitle={step === 1 ? "We'll email you a 6-digit code." : 'Enter the code and choose a new password.'}>
      {error && <div className="alert alert-error">{error}</div>}
      {info && step === 2 && <div className="alert alert-info">{info}</div>}
      {step === 1 ? (
        <form onSubmit={sendOtp} className="stack">
          <Field label="Email"><input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send OTP'}</button>
        </form>
      ) : (
        <form onSubmit={reset} className="stack">
          <Field label="OTP code">
            <input className="otp" required inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="New password" hint="8+ characters with a lowercase, an uppercase and a special character">
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Re-enter password"><input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button>
          <button type="button" className="btn btn-link" onClick={sendOtp}>Resend code</button>
        </form>
      )}
      <p className="center muted"><Link to="/login">Back to login</Link></p>
    </AuthCard>
  );
}