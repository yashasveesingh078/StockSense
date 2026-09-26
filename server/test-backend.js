// StockSense backend test: checks every requirement from the problem statement.
// Run with the server running:   node test-backend.js
const BASE = 'http://localhost:4000/api';
let TOKEN = '';
let passed = 0;
let failed = 0;

async function call(method, path, body, token = TOKEN) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b || {});

function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? `  →  ${detail}` : ''}`);
}
const section = (t) => console.log(`\n━━ ${t} ━━`);

async function stockOf(productId) {
  const { data } = await get(`/products/${productId}`);
  const byLoc = Object.fromEntries(data.stock.map((s) => [s.full_name, s.quantity]));
  return { total: data.on_hand, byLoc };
}

async function main() {
  const t = Date.now().toString().slice(-6);

  // ───────────────────────── 1. AUTHENTICATION ─────────────────────────
  section('1. Authentication (sign up, log in, OTP password reset)');
  let r = await post('/auth/signup', { login_id: 'abc', email: `a${t}@x.com`, password: 'Aa@12345' });
  check('Rejects Login ID shorter than 6 characters', r.status === 400, r.data.error);
  r = await post('/auth/signup', { login_id: `user${t}`, email: `a${t}@x.com`, password: 'weakpass' });
  check('Rejects weak password (needs upper, lower, special, 8+)', r.status === 400, r.data.error);
  r = await post('/auth/signup', { login_id: 'demoadmin', email: `a${t}@x.com`, password: 'Aa@12345' });
  check('Rejects duplicate Login ID', r.status === 409, r.data.error);
  r = await post('/auth/signup', { login_id: `user${t}`, email: `user${t}@test.com`, password: 'Test@1234' });
  check('Signs up a new user with valid details', r.status === 201 && !!r.data.token, `created ${r.data.user?.login_id}`);
  r = await post('/auth/signup', { login_id: `other${t}`, email: `user${t}@test.com`, password: 'Test@1234' });
  check('Rejects duplicate email', r.status === 409, r.data.error);

  r = await post('/auth/login', { login_id: `user${t}`, password: 'wrong' });
  check('Wrong password is refused', r.status === 401, r.data.error);
  r = await post('/auth/login', { login_id: `user${t}`, password: 'Test@1234' });
  check('Correct Login ID + password logs in and returns a token', r.status === 200 && !!r.data.token);

  r = await post('/auth/forgot-password', { email: `user${t}@test.com` });
  const otp = r.data.dev_otp;
  check('Forgot password generates a 6-digit OTP', /^\d{6}$/.test(otp || ''), `OTP ${otp} (shown because no email server is set)`);
  r = await post('/auth/reset-password', { email: `user${t}@test.com`, otp: '000000', password: 'New@12345' });
  check('Wrong OTP is refused', r.status === 400, r.data.error);
  r = await post('/auth/reset-password', { email: `user${t}@test.com`, otp, password: 'New@12345' });
  check('Correct OTP resets the password', r.status === 200, r.data.message);
  r = await post('/auth/reset-password', { email: `user${t}@test.com`, otp, password: 'New@67890' });
  check('The same OTP cannot be used twice', r.status === 400, r.data.error);
  r = await post('/auth/login', { login_id: `user${t}`, password: 'New@12345' });
  check('Can log in with the new password', r.status === 200);

  r = await call('GET', '/dashboard', null, '');
  check('API refuses requests without login (no token)', r.status === 401, r.data.error);

  r = await post('/auth/login', { login_id: 'demoadmin', password: 'Admin@123' });
  TOKEN = r.data.token;
  check('Demo manager logs in (demoadmin)', !!TOKEN);
  if (!TOKEN) return console.log('\nCannot continue: run "npm run seed" first.');

  // Look up locations by name
  const locs = (await get('/locations')).data;
  const L = (name) => locs.find((l) => l.full_name === name)?.id;
  const STOCK = L('WH/Stock');
  const PROD = L('WH/Prod');
  check('Warehouse locations exist (WH/Stock, WH/Prod)', !!STOCK && !!PROD);

  // ───────────────────────── 2. PRODUCT MANAGEMENT ─────────────────────────
  section('2. Product management (name, SKU, category, unit, initial stock)');
  const cat = (await get('/categories')).data.find((c) => c.name === 'Raw Materials');
  r = await post('/products', { name: `Steel Rods ${t}`, sku: `STEEL-${t}`, category_id: cat.id, uom: 'kg', unit_cost: 85, min_qty: 30, max_qty: 200 });
  const steel = r.data;
  check('Creates a product with name, SKU, category, unit, cost, reorder rule', r.status === 201, `${steel.name} [${steel.sku}] in kg`);
  r = await post('/products', { name: 'Duplicate', sku: `STEEL-${t}` });
  check('Rejects a duplicate SKU', r.status === 409, r.data.error);
  r = await post('/products', { name: `Chairs ${t}`, sku: `CHAIR-${t}`, uom: 'Units', initial_qty: 25, initial_location_id: STOCK });
  const chair = r.data;
  let s = await stockOf(chair.id);
  check('Initial stock (optional) is added on creation', s.total === 25, `Chairs on hand = ${s.total}`);
  r = await get(`/moves?product_id=${chair.id}`);
  check('Initial stock is recorded in the ledger as an adjustment', r.data.length === 1 && r.data[0].op_type === 'adjustment', r.data[0]?.reference);
  r = await get(`/products?search=STEEL-${t}`);
  check('SKU search finds the product', r.data.length === 1 && r.data[0].id === steel.id);

  // ───────────────────────── 3. RECEIPTS ─────────────────────────
  section('3. Receipt: receive 100 kg steel from vendor (stock +100)');
  r = await post('/operations', { type: 'receipt', partner: 'Jindal Steel', dest_location_id: STOCK, lines: [{ product_id: steel.id, quantity: 100 }] });
  const rec = r.data;
  check('Creates a receipt with supplier + products, reference auto-generated', r.status === 201 && /^WH\/IN\/\d{4}$/.test(rec.reference), `${rec.reference}, status ${rec.status}`);
  s = await stockOf(steel.id);
  check('Draft receipt does NOT change stock yet', s.total === 0, `stock = ${s.total}`);
  r = await post(`/operations/${rec.id}/validate`);
  check('Cannot validate straight from Draft (must click To Do first)', r.status === 400, r.data.error);
  r = await post(`/operations/${rec.id}/confirm`);
  check('To Do moves it Draft → Ready', r.data.status === 'ready');
  r = await post(`/operations/${rec.id}/validate`);
  s = await stockOf(steel.id);
  check('Validate → Done and stock increases automatically', r.data.status === 'done' && s.total === 100, `steel = ${s.total} kg at WH/Stock`);
  r = await post(`/operations/${rec.id}/validate`);
  check('A done receipt cannot be validated twice', r.status === 400, r.data.error);

  // ───────────────────────── 4. INTERNAL TRANSFER ─────────────────────────
  section('4. Internal transfer: Main Store → Production Rack (total unchanged)');
  r = await post('/operations', { type: 'internal', source_location_id: STOCK, dest_location_id: PROD, lines: [{ product_id: steel.id, quantity: 100 }] });
  const int = r.data;
  await post(`/operations/${int.id}/confirm`);
  await post(`/operations/${int.id}/validate`);
  s = await stockOf(steel.id);
  check('Total stock unchanged', s.total === 100, `total = ${s.total}`);
  check('Location updated (0 at WH/Stock, 100 at WH/Prod)', (s.byLoc['WH/Stock'] || 0) === 0 && s.byLoc['WH/Prod'] === 100, JSON.stringify(s.byLoc));

  // ───────────────────────── 5. DELIVERIES ─────────────────────────
  section('5. Delivery: deliver 20 kg to customer (stock −20)');
  r = await post('/operations', { type: 'delivery', partner: 'LPU', delivery_address: 'Block 32', source_location_id: PROD, lines: [{ product_id: steel.id, quantity: 500 }] });
  const big = r.data;
  r = await post(`/operations/${big.id}/confirm`);
  check('Delivery of 500 kg (only 100 in stock) goes to Waiting', r.data.status === 'waiting');
  r = await post(`/operations/${big.id}/validate`);
  s = await stockOf(steel.id);
  check('Validating it is blocked, stock NOT reduced (no negative stock)', r.status === 400 && s.total === 100, r.data.error);
  await post(`/operations/${big.id}/cancel`);

  r = await post('/operations', { type: 'delivery', partner: 'LPU', delivery_address: 'Block 32', source_location_id: PROD, lines: [{ product_id: steel.id, quantity: 20 }] });
  const del = r.data;
  r = await post(`/operations/${del.id}/confirm`);
  check('Delivery of 20 kg goes to Ready (stock available)', r.data.status === 'ready', del.reference);
  r = await post(`/operations/${del.id}/pick-pack`, { picked: true, packed: true });
  check('Pick and pack steps are recorded', r.data.picked === 1 && r.data.packed === 1);
  r = await post(`/operations/${del.id}/validate`);
  s = await stockOf(steel.id);
  check('Validate → Done and stock decreases automatically', r.data.status === 'done' && s.total === 80, `steel = ${s.total} kg`);

  // All-or-nothing: 2 lines, second one fails → first must not be applied either
  r = await post('/operations', { type: 'delivery', partner: 'Test', source_location_id: STOCK,
    lines: [{ product_id: chair.id, quantity: 5 }, { product_id: steel.id, quantity: 999 }] });
  const multi = r.data;
  await post(`/operations/${multi.id}/confirm`);
  await post(`/operations/${multi.id}/validate`);
  const chairs = (await stockOf(chair.id)).total;
  check('All-or-nothing: if one line fails, no line is applied (transaction)', chairs === 25, `chairs still ${chairs}, not 20`);
  await post(`/operations/${multi.id}/cancel`);

  // ───────────────────────── 6. ADJUSTMENT ─────────────────────────
  section('6. Stock adjustment: 3 kg damaged (counted 77, recorded 80)');
  r = await post('/operations', { type: 'adjustment', location_id: PROD, notes: '3 kg damaged', lines: [{ product_id: steel.id, quantity: 77 }] });
  const adj = r.data;
  r = await post(`/operations/${adj.id}/validate`);
  s = await stockOf(steel.id);
  check('Stock auto-updated to the counted quantity', s.total === 77, `steel = ${s.total} kg`);
  r = await get(`/moves?search=${adj.reference}`);
  check('Difference (−3) is logged, moved to Inventory Loss', r.data.length === 1 && r.data[0].quantity === 3 && r.data[0].to_name === 'Virtual/Inventory Loss',
    `${r.data[0]?.from_name} → ${r.data[0]?.to_name}: ${r.data[0]?.quantity}`);

  // ───────────────────────── 7. STOCK LEDGER ─────────────────────────
  section('7. Move History / stock ledger ("everything logged")');
  r = await get(`/moves?product_id=${steel.id}`);
  const ledger = r.data.slice().reverse();
  check('Ledger has exactly 4 moves for steel (receive, transfer, deliver, adjust)', ledger.length === 4);
  ledger.forEach((m) => console.log(`       ${m.reference.padEnd(12)} ${m.from_name.padEnd(24)} → ${m.to_name.padEnd(24)} ${m.quantity} ${m.uom}  by ${m.user_name}`));
  r = await get('/moves?search=LPU');
  check('Ledger can be searched by contact', r.data.length > 0);

  // ───────────────────────── 8. DASHBOARD & ALERTS ─────────────────────────
  section('8. Dashboard KPIs, low-stock alerts, filters');
  await post(`/products/${steel.id}/set-stock`, { location_id: PROD, quantity: 10 });
  r = await get('/dashboard');
  const d = r.data;
  console.log(`       products in stock: ${d.in_stock} | low: ${d.low_stock} | out: ${d.out_of_stock} | pending receipts: ${d.pending_receipts} | pending deliveries: ${d.pending_deliveries} | transfers: ${d.pending_transfers}`);
  console.log(`       Receipt card: ${JSON.stringify(d.receipt_card)}`);
  console.log(`       Delivery card: ${JSON.stringify(d.delivery_card)}`);
  check('Dashboard returns all KPIs from the problem statement',
    ['in_stock', 'low_stock', 'out_of_stock', 'pending_receipts', 'pending_deliveries', 'pending_transfers'].every((k) => typeof d[k] === 'number'));
  check('Low-stock alert: steel at 10 kg (min 30) appears in alerts', d.alerts.some((a) => a.id === steel.id && a.status === 'low'));
  r = await get('/products?stock=low');
  check('Products can be filtered to low stock', r.data.some((p) => p.id === steel.id));
  r = await get('/operations?type=delivery&status=done');
  check('Filter operations by document type + status', r.data.length > 0 && r.data.every((o) => o.type === 'delivery' && o.status === 'done'));
  r = await get(`/operations?category_id=${cat.id}`);
  check('Filter operations by product category', r.data.length > 0);
  r = await get('/operations?search=Jindal');
  check('Search operations by contact', r.data.some((o) => o.partner === 'Jindal Steel'));
  r = await get(`/dashboard?warehouse_id=${locs.find((l) => l.id === STOCK).warehouse_id}`);
  check('Dashboard can be filtered by warehouse', r.status === 200);

  // ───────────────────────── 9. MULTI-WAREHOUSE ─────────────────────────
  section('9. Multi-warehouse: Warehouse 1 → Warehouse 2');
  const code = 'W' + t.slice(-4);
  r = await post('/warehouses', { name: `Test Warehouse ${t}`, short_code: code, address: 'Phagwara' });
  check('Creates a new warehouse (with default Stock location)', r.status === 201, `${r.data.name} (${code})`);
  const wh2 = r.data;
  r = await post('/locations', { warehouse_id: wh2.id, name: 'Rack 1', short_code: 'R1' });
  check('Adds a location with short code', r.data.full_name === `${code}/R1`, r.data.full_name);
  const W2R1 = r.data.id;
  r = await post('/operations', { type: 'internal', source_location_id: STOCK, dest_location_id: W2R1, lines: [{ product_id: chair.id, quantity: 10 }] });
  await post(`/operations/${r.data.id}/confirm`);
  await post(`/operations/${r.data.id}/validate`);
  s = await stockOf(chair.id);
  check('Transfer between warehouses works', s.byLoc['WH/Stock'] === 15 && s.byLoc[`${code}/R1`] === 10, JSON.stringify(s.byLoc));
  r = await get(`/products?warehouse_id=${wh2.id}`);
  check('Stock can be viewed per warehouse', r.data.find((p) => p.id === chair.id)?.on_hand === 10);

  // ───────────────────────── 10. REORDERING RULES ─────────────────────────
  section('10. Reordering rules: replenish low stock');
  r = await post('/products/reorder', { location_id: STOCK });
  const draft = r.data.id ? (await get(`/operations/${r.data.id}`)).data : null;
  const line = draft?.lines.find((l) => l.product_id === steel.id);
  check('Creates a draft receipt topping steel up to its max (200)', !!line && line.quantity === 190, `${draft?.reference}: steel ${line?.quantity} kg`);
  if (draft) await post(`/operations/${draft.id}/cancel`);

  console.log(`\n━━ RESULT: ${passed} passed, ${failed} failed ━━\n`);
}

main().catch((e) => {
  console.error('\nCould not reach the server. Is "npm run dev" running in the server folder?\n', e.message);
});