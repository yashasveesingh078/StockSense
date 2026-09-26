// Master data: categories, warehouses, locations, products.
const express = require('express');
const db = require('../db');
const engine = require('../engine');
const { requireManager } = require('../middleware');
 
const router = express.Router();
 
// ---------- Categories ----------
router.get('/categories', (req, res) => {
  res.json(
    db.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c ORDER BY c.name`
    ).all()
  );
});
 
router.post('/categories', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  if (db.prepare('SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE').get(name))
    return res.status(409).json({ error: 'Category already exists' });
  const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
  res.status(201).json({ id: info.lastInsertRowid, name });
});
 
router.delete('/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
 
// ---------- Warehouses ----------
router.get('/warehouses', (req, res) => {
  const whs = db.prepare('SELECT * FROM warehouses ORDER BY id').all();
  const locs = db.prepare("SELECT * FROM locations WHERE type = 'internal' ORDER BY full_name").all();
  res.json(whs.map((w) => ({ ...w, locations: locs.filter((l) => l.warehouse_id === w.id) })));
});
 
router.post('/warehouses', requireManager, (req, res) => {
  const name = (req.body.name || '').trim();
  const code = (req.body.short_code || '').trim().toUpperCase();
  if (!name || !code) return res.status(400).json({ error: 'Name and short code are required' });
  if (!/^[A-Z0-9]{1,6}$/.test(code)) return res.status(400).json({ error: 'Short code: 1-6 letters/digits' });
  if (db.prepare('SELECT 1 FROM warehouses WHERE short_code = ?').get(code))
    return res.status(409).json({ error: 'Short code already used' });
  const id = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO warehouses (name, short_code, address) VALUES (?, ?, ?)')
      .run(name, code, req.body.address || null);
    // every warehouse gets a default Stock location
    db.prepare("INSERT INTO locations (name, short_code, full_name, warehouse_id, type) VALUES ('Stock', 'Stock', ?, ?, 'internal')")
      .run(`${code}/Stock`, info.lastInsertRowid);
    return info.lastInsertRowid;
  })();
  res.status(201).json(db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id));
});
 
router.put('/warehouses/:id', requireManager, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.prepare('UPDATE warehouses SET name = ?, address = ? WHERE id = ?').run(name, req.body.address || null, req.params.id);
  res.json(db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id));
});
 
// ---------- Locations ----------
router.get('/locations', (req, res) => {
  const all = req.query.all === '1';
  res.json(
    db.prepare(
      `SELECT l.*, w.name AS warehouse_name FROM locations l LEFT JOIN warehouses w ON w.id = l.warehouse_id
       ${all ? '' : "WHERE l.type = 'internal'"} ORDER BY l.full_name`
    ).all()
  );
});
 
// Location = Name + Short Code + Warehouse. Full name is <warehouse code>/<location code>, e.g. WH/Stock1
router.post('/locations', requireManager, (req, res) => {
  const name = (req.body.name || '').trim();
  const code = (req.body.short_code || '').trim().replace(/\s+/g, '');
  const wh = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.body.warehouse_id);
  if (!name || !code || !wh) return res.status(400).json({ error: 'Name, short code and warehouse are required' });
  const full = `${wh.short_code}/${code}`;
  if (db.prepare('SELECT 1 FROM locations WHERE full_name = ?').get(full))
    return res.status(409).json({ error: `Location ${full} already exists` });
  const info = db
    .prepare("INSERT INTO locations (name, short_code, full_name, warehouse_id, type) VALUES (?, ?, ?, ?, 'internal')")
    .run(name, code, full, wh.id);
  res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(info.lastInsertRowid));
});
 
router.put('/locations/:id', requireManager, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.prepare("UPDATE locations SET name = ? WHERE id = ? AND type = 'internal'").run(name, req.params.id);
  res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id));
});
 
router.delete('/locations/:id', requireManager, (req, res) => {
  const used = db.prepare(
    'SELECT 1 FROM stock_moves WHERE from_location_id = ? OR to_location_id = ? LIMIT 1'
  ).get(req.params.id, req.params.id);
  const opUsed = db.prepare(
    'SELECT 1 FROM operations WHERE source_location_id = ? OR dest_location_id = ? LIMIT 1'
  ).get(req.params.id, req.params.id);
  if (used || opUsed) return res.status(400).json({ error: 'This location has stock history and cannot be deleted' });
  db.prepare("DELETE FROM locations WHERE id = ? AND type = 'internal'").run(req.params.id);
  res.json({ ok: true });
});
 
// ---------- Products ----------
// on_hand = total across all internal locations (optionally one warehouse / location)
router.get('/products', (req, res) => {
  const { search, category_id, warehouse_id, location_id, stock } = req.query;
  const locFilter = location_id
    ? 'AND l.id = @location_id'
    : warehouse_id
    ? 'AND l.warehouse_id = @warehouse_id'
    : '';
  const where = [];
  if (search) where.push('(p.name LIKE @search OR p.sku LIKE @search)');
  if (category_id) where.push('p.category_id = @category_id');
  // free_to_use = on hand minus quantities reserved by open (waiting/ready) deliveries & transfers
  let rows = db
    .prepare(
      `SELECT p.*, c.name AS category_name,
         COALESCE((SELECT SUM(q.quantity) FROM stock_quants q JOIN locations l ON l.id = q.location_id
                   WHERE q.product_id = p.id AND l.type = 'internal' ${locFilter}), 0) AS on_hand,
         COALESCE((SELECT SUM(ol.quantity) FROM operation_lines ol JOIN operations o ON o.id = ol.operation_id
                   JOIN locations l ON l.id = o.source_location_id
                   WHERE ol.product_id = p.id AND o.type IN ('delivery','internal') AND o.status IN ('waiting','ready')
                   AND l.type = 'internal' ${locFilter}), 0) AS reserved
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.name`
    )
    .all({ search: `%${search || ''}%`, category_id, warehouse_id, location_id });
  rows = rows.map((p) => ({
    ...p,
    free_to_use: Math.max(p.on_hand - p.reserved, 0),
    stock_status: p.on_hand <= 0 ? 'out' : p.on_hand <= p.min_qty ? 'low' : 'ok',
  }));
  if (stock === 'low') rows = rows.filter((p) => p.stock_status === 'low');
  if (stock === 'out') rows = rows.filter((p) => p.stock_status === 'out');
  if (stock === 'alert') rows = rows.filter((p) => p.stock_status !== 'ok');
  res.json(rows);
});
 
router.get('/products/:id', (req, res) => {
  const p = db
    .prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?')
    .get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  p.stock = db
    .prepare(
      `SELECT l.id AS location_id, l.full_name, w.name AS warehouse_name, q.quantity
       FROM stock_quants q JOIN locations l ON l.id = q.location_id LEFT JOIN warehouses w ON w.id = l.warehouse_id
       WHERE q.product_id = ? AND l.type = 'internal' AND q.quantity != 0 ORDER BY l.full_name`
    )
    .all(p.id);
  p.on_hand = p.stock.reduce((s, r) => s + r.quantity, 0);
  res.json(p);
});
 
function productPayload(body) {
  const cost = Number(body.unit_cost || 0);
  if (!Number.isFinite(cost) || cost < 0) throw new engine.StockError('Unit cost cannot be negative');
  const name = (body.name || '').trim();
  const sku = (body.sku || '').trim().toUpperCase();
  const uom = (body.uom || 'Units').trim();
  const min = Number(body.min_qty || 0);
  const max = Number(body.max_qty || 0);
  if (!name) throw new engine.StockError('Product name is required');
  if (!sku) throw new engine.StockError('SKU / code is required');
  if (min < 0 || max < 0) throw new engine.StockError('Reorder quantities cannot be negative');
  if (max && max < min) throw new engine.StockError('Max quantity must be at least the min quantity');
  return { name, sku, uom, cost, min, max, category_id: body.category_id || null };
}
 
router.post('/products', (req, res) => {
  const p = productPayload(req.body);
  if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(p.sku))
    return res.status(409).json({ error: 'SKU already exists' });
  const initial = Number(req.body.initial_qty || 0);
  if (initial < 0) return res.status(400).json({ error: 'Initial stock cannot be negative' });
  if (initial > 0 && !req.body.initial_location_id)
    return res.status(400).json({ error: 'Choose a location for the initial stock' });
 
  const id = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO products (name, sku, category_id, uom, unit_cost, min_qty, max_qty) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.name, p.sku, p.category_id, p.uom, p.cost, p.min, p.max);
    if (initial > 0) {
      // Initial stock is recorded as an inventory adjustment, so it shows in the ledger.
      engine.createAndValidate(
        {
          type: 'adjustment',
          location_id: req.body.initial_location_id,
          notes: 'Initial stock',
          lines: [{ product_id: info.lastInsertRowid, quantity: initial }],
        },
        req.user.id
      );
    }
    return info.lastInsertRowid;
  })();
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});
 
router.put('/products/:id', (req, res) => {
  const p = productPayload(req.body);
  if (db.prepare('SELECT 1 FROM products WHERE sku = ? AND id != ?').get(p.sku, req.params.id))
    return res.status(409).json({ error: 'SKU already exists' });
  db.prepare('UPDATE products SET name = ?, sku = ?, category_id = ?, uom = ?, unit_cost = ?, min_qty = ?, max_qty = ? WHERE id = ?')
    .run(p.name, p.sku, p.category_id, p.uom, p.cost, p.min, p.max, req.params.id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});
 
router.delete('/products/:id', (req, res) => {
  const used = db.prepare('SELECT 1 FROM operation_lines WHERE product_id = ? LIMIT 1').get(req.params.id);
  if (used) return res.status(400).json({ error: 'Product is used in operations and cannot be deleted' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
 
// "Update the stock from here" (Stock page): set the counted quantity at a location.
// Recorded as an inventory adjustment so it appears in the ledger.
router.post('/products/:id/set-stock', (req, res) => {
  const qty = Number(req.body.quantity);
  if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: 'Quantity must be zero or more' });
  if (!req.body.location_id) return res.status(400).json({ error: 'Choose a location' });
  const opId = engine.createAndValidate(
    { type: 'adjustment', location_id: req.body.location_id, notes: req.body.reason || 'Stock updated from Stock page',
      lines: [{ product_id: Number(req.params.id), quantity: qty }] },
    req.user.id
  );
  res.json({ ok: true, operation_id: opId });
});
 
// Reordering rule in action: create a draft receipt for every product at/below its minimum.
router.post('/products/reorder', (req, res) => {
  const dest = db.prepare("SELECT * FROM locations WHERE id = ? AND type = 'internal'").get(req.body.location_id);
  if (!dest) return res.status(400).json({ error: 'Choose the location to receive stock into' });
  const products = db
    .prepare(
      `SELECT p.*, COALESCE((SELECT SUM(q.quantity) FROM stock_quants q JOIN locations l ON l.id = q.location_id
                             WHERE q.product_id = p.id AND l.type = 'internal'), 0) AS on_hand
       FROM products p WHERE p.min_qty > 0`
    )
    .all()
    .filter((p) => p.on_hand <= p.min_qty);
  const lines = products
    .map((p) => ({ product_id: p.id, quantity: Math.max((p.max_qty || p.min_qty * 2) - p.on_hand, 1) }));
  if (!lines.length) return res.json({ message: 'All products are above their minimum. Nothing to reorder.' });
  const id = engine.createOperation(
    { type: 'receipt', dest_location_id: dest.id, partner: 'Auto reorder', notes: 'Created from reordering rules', lines },
    req.user.id
  );
  res.status(201).json({ id, message: `Draft receipt created for ${lines.length} product(s)` });
});
 
module.exports = router;