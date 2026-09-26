// Database connection + schema. SQLite (file: stocksense.db) so the app runs with zero setup.
const Database = require('better-sqlite3');
const path = require('path');
 
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'stocksense.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
 
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  login_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('manager','staff')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
 
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
 
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_code TEXT NOT NULL UNIQUE,
  address TEXT
);
 
-- internal = real shelves/racks; vendor/customer/loss = virtual locations
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_code TEXT,
  full_name TEXT NOT NULL UNIQUE,     -- e.g. WH/Stock1 = <warehouse code>/<location code>
  warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('internal','vendor','customer','loss'))
);
 
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
 
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  uom TEXT NOT NULL DEFAULT 'Units',
  unit_cost REAL NOT NULL DEFAULT 0,
  min_qty REAL NOT NULL DEFAULT 0,   -- reordering rule: alert when on hand <= min_qty
  max_qty REAL NOT NULL DEFAULT 0,   -- reordering rule: reorder up to this quantity
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
 
CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('receipt','delivery','internal','adjustment')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','waiting','ready','done','canceled')),
  partner TEXT,                      -- contact: vendor (receipt) or customer (delivery)
  delivery_address TEXT,
  responsible_id INTEGER REFERENCES users(id),
  source_location_id INTEGER NOT NULL REFERENCES locations(id),
  dest_location_id INTEGER NOT NULL REFERENCES locations(id),
  warehouse_id INTEGER REFERENCES warehouses(id),
  scheduled_date TEXT,
  picked INTEGER NOT NULL DEFAULT 0,
  packed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at TEXT
);
 
-- For adjustments, quantity = the physically COUNTED quantity.
CREATE TABLE IF NOT EXISTS operation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK (quantity >= 0)
);
 
-- The stock ledger. Every stock change in the system is one row here.
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  from_location_id INTEGER NOT NULL REFERENCES locations(id),
  to_location_id INTEGER NOT NULL REFERENCES locations(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  operation_id INTEGER REFERENCES operations(id),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
 
-- Cached current stock per product per location (kept in sync by the engine).
CREATE TABLE IF NOT EXISTS stock_quants (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, location_id)
);
 
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_moves(product_id);
CREATE INDEX IF NOT EXISTS idx_ops_type_status ON operations(type, status);
`);
 
// Virtual locations must always exist.
const virtuals = [
  ['Vendors', 'Partners/Vendors', 'vendor'],
  ['Customers', 'Partners/Customers', 'customer'],
  ['Inventory Loss', 'Virtual/Inventory Loss', 'loss'],
];
const insVirtual = db.prepare(
  'INSERT OR IGNORE INTO locations (name, full_name, type) VALUES (?, ?, ?)'
);
for (const v of virtuals) insVirtual.run(...v);
 
db.virtualLocation = (type) =>
  db.prepare('SELECT * FROM locations WHERE type = ? AND warehouse_id IS NULL').get(type);
 
module.exports = db;