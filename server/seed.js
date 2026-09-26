// Resets the database and loads realistic demo data.  Run: npm run seed
const fs = require('fs');
const path = require('path');
const dbFile = process.env.DB_PATH || path.join(__dirname, 'stocksense.db');
for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
 
const bcrypt = require('bcryptjs');
const db = require('./db');
const engine = require('./engine');
 
const user = db
  .prepare("INSERT INTO users (name, login_id, email, password_hash, role) VALUES (?, ?, ?, ?, 'manager')")
  .run('Demo Manager', 'demoadmin', 'admin@stocksense.com', bcrypt.hashSync('Admin@123', 10)).lastInsertRowid;
db.prepare("INSERT INTO users (name, login_id, email, password_hash, role) VALUES (?, ?, ?, ?, 'staff')")
  .run('Warehouse Staff', 'demostaff', 'staff@stocksense.com', bcrypt.hashSync('Staff@123', 10));
 
// Warehouses + locations
function warehouse(name, code, address, extraLocations) {
  const id = db.prepare('INSERT INTO warehouses (name, short_code, address) VALUES (?, ?, ?)').run(name, code, address).lastInsertRowid;
  const locs = {};
  // extraLocations: [display name, short code]
  for (const [n, c] of [['Stock', 'Stock'], ...extraLocations]) {
    locs[n] = db
      .prepare("INSERT INTO locations (name, short_code, full_name, warehouse_id, type) VALUES (?, ?, ?, ?, 'internal')")
      .run(n, c, `${code}/${c}`, id).lastInsertRowid;
  }
  return locs;
}
const wh = warehouse('Main Warehouse', 'WH', 'Plot 12, Industrial Area, Jalandhar', [['Rack A', 'RackA'], ['Rack B', 'RackB'], ['Production Rack', 'Prod']]);
const wh2 = warehouse('Phagwara Depot', 'PGW', 'GT Road, Phagwara', []);
 
// Categories
const cat = {};
for (const c of ['Raw Materials', 'Furniture', 'Electronics', 'Packaging', 'Office Supplies'])
  cat[c] = db.prepare('INSERT INTO categories (name) VALUES (?)').run(c).lastInsertRowid;
 
// Products: [name, sku, category, uom, min, max, unit cost in Rs]
const P = {};
const products = [
  ['Steel Rods', 'RM-STEEL-01', 'Raw Materials', 'kg', 30, 200, 85],
  ['Aluminium Sheets', 'RM-ALU-02', 'Raw Materials', 'sheets', 20, 100, 1200],
  ['Copper Wire', 'RM-CU-03', 'Raw Materials', 'm', 100, 500, 45],
  ['Office Chair', 'FUR-CHR-01', 'Furniture', 'Units', 5, 30, 4500],
  ['Office Desk', 'FUR-DSK-02', 'Furniture', 'Units', 3, 15, 3000],
  ['Filing Cabinet', 'FUR-CAB-03', 'Furniture', 'Units', 2, 10, 6500],
  ['LED Monitor 24"', 'ELE-MON-01', 'Electronics', 'Units', 5, 25, 9500],
  ['Wireless Keyboard', 'ELE-KBD-02', 'Electronics', 'Units', 10, 50, 1200],
  ['USB-C Cable', 'ELE-CBL-03', 'Electronics', 'Units', 25, 150, 250],
  ['Cardboard Box (L)', 'PKG-BOX-01', 'Packaging', 'Units', 50, 300, 40],
  ['Bubble Wrap Roll', 'PKG-BWR-02', 'Packaging', 'rolls', 10, 40, 600],
  ['A4 Paper Ream', 'OFF-PPR-01', 'Office Supplies', 'reams', 20, 100, 280],
];
for (const [name, sku, c, uom, min, max, cost] of products)
  P[sku] = db
    .prepare('INSERT INTO products (name, sku, category_id, uom, min_qty, max_qty, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, sku, cat[c], uom, min, max, cost).lastInsertRowid;
 
const L = (sku, qty) => ({ product_id: P[sku], quantity: qty });
const daysFromNow = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
 
function op(data, action = 'validate') {
  const id = engine.createOperation(data, user);
  if (action === 'draft') return id;
  if (data.type !== 'adjustment') engine.confirmOperation(id);
  if (action === 'confirm') return id;
  if (data.type === 'delivery') engine.setPickPack(id, { picked: true, packed: true });
  engine.validateOperation(id, user);
  return id;
}
 
// Completed history
op({ type: 'receipt', partner: 'Tata Steel Ltd', dest_location_id: wh.Stock, scheduled_date: daysFromNow(-6),
  lines: [L('RM-ALU-02', 60), L('RM-CU-03', 400)] });
op({ type: 'receipt', partner: 'Godrej Interio', dest_location_id: wh['Rack A'], scheduled_date: daysFromNow(-5),
  lines: [L('FUR-CHR-01', 25), L('FUR-DSK-02', 10), L('FUR-CAB-03', 6)] });
op({ type: 'receipt', partner: 'Dell India', dest_location_id: wh['Rack B'], scheduled_date: daysFromNow(-4),
  lines: [L('ELE-MON-01', 20), L('ELE-KBD-02', 40), L('ELE-CBL-03', 100)] });
op({ type: 'receipt', partner: 'PackRight Supplies', dest_location_id: wh2.Stock, scheduled_date: daysFromNow(-4),
  lines: [L('PKG-BOX-01', 200), L('PKG-BWR-02', 8), L('OFF-PPR-01', 60)] });
op({ type: 'delivery', partner: 'LPU Admin Block', delivery_address: 'Block 32, LPU, Phagwara', source_location_id: wh['Rack A'], scheduled_date: daysFromNow(-2),
  lines: [L('FUR-CHR-01', 12), L('FUR-DSK-02', 4)] });
op({ type: 'delivery', partner: 'Infosys Mohali', delivery_address: 'Phase 8, Industrial Area, Mohali', source_location_id: wh['Rack B'], scheduled_date: daysFromNow(-1),
  lines: [L('ELE-MON-01', 16), L('ELE-KBD-02', 10)] });
op({ type: 'internal', source_location_id: wh.Stock, dest_location_id: wh['Production Rack'], scheduled_date: daysFromNow(-1),
  lines: [L('RM-ALU-02', 25)] });
op({ type: 'adjustment', location_id: wh['Rack B'], notes: 'Cycle count', lines: [L('ELE-CBL-03', 97)] });
 
// Pending work (drives dashboard KPIs)
op({ type: 'receipt', partner: 'Jindal Steel', dest_location_id: wh.Stock, scheduled_date: daysFromNow(1),
  lines: [L('RM-STEEL-01', 150)] }, 'confirm');
op({ type: 'receipt', partner: 'Dell India', dest_location_id: wh['Rack B'], scheduled_date: daysFromNow(3),
  lines: [L('ELE-MON-01', 10)] }, 'draft');
op({ type: 'delivery', partner: 'Lovely Professional University', delivery_address: 'Uni Stores, LPU, Phagwara', source_location_id: wh['Rack A'], scheduled_date: daysFromNow(-1),
  lines: [L('FUR-CHR-01', 10), L('FUR-CAB-03', 2)] }, 'confirm');
op({ type: 'delivery', partner: 'CT Group', delivery_address: 'Shahpur Campus, Jalandhar', source_location_id: wh['Rack B'], scheduled_date: daysFromNow(2),
  lines: [L('ELE-MON-01', 8)] }, 'confirm'); // not enough stock -> Waiting
op({ type: 'internal', source_location_id: wh2.Stock, dest_location_id: wh.Stock, scheduled_date: daysFromNow(1),
  lines: [L('PKG-BOX-01', 50)] }, 'confirm');
 
console.log('Seeded demo data.');
console.log('Login ID: demoadmin / Admin@123  (manager)');
console.log('Login ID: demostaff / Staff@123  (staff)');