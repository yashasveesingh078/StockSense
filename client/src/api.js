// Tiny fetch wrapper. Token is stored in localStorage and sent as a Bearer header.
const TOKEN_KEY = 'stocksense_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(path, { method = 'GET', body, params } = {}) {
  let url = '/api' + path;
  if (params) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    if ([...qs].length) url += '?' + qs;
  }
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && getToken()) {
    setToken(null);
    window.location.href = '/login';
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const TYPE_META = {
  receipt: { label: 'Receipts', single: 'Receipt', code: 'IN' },
  delivery: { label: 'Deliveries', single: 'Delivery', code: 'OUT' },
  internal: { label: 'Internal Transfers', single: 'Internal Transfer', code: 'INT' },
  adjustment: { label: 'Adjustments', single: 'Inventory Adjustment', code: 'ADJ' },
};

export const STATUS_LABEL = { draft: 'Draft', waiting: 'Waiting', ready: 'Ready', done: 'Done', canceled: 'Canceled' };

export const fmtQty = (n) => (Number.isInteger(Number(n)) ? Number(n) : Number(n).toFixed(2));
export const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T') + (s.length > 10 ? 'Z' : '')).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (s) =>
  s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';