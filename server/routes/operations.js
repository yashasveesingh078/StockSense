// Operations (receipts, deliveries, internal transfers, adjustments), move history and dashboard.
const express = require('express');
const db = require('../db');
const engine = require('../engine');

const router = express.Router();
const OPEN = "('draft','waiting','ready')";

// ---------- Operations ----------
// Filters: type, status, warehouse_id, category_id, search, open=1
router.get('/operations', (req, res) => {
  const { type, status, warehouse_id, category_id, search, open, location_id, late, upcoming } = req.query;
  const where = [];
  if (late === '1') where.push(`o.status IN ${OPEN} AND date(o.scheduled_date) < date('now')`);
  if (upcoming === '1') where.push(`o.status IN ${OPEN} AND date(o.scheduled_date) > date('now')`);
  if (type) where.push('o.type = @type');
  if (status) where.push('o.status = @status');
  if (open === '1') where.push(`o.status IN ${OPEN}`);
  if (warehouse_id) where.push('o.warehouse_id = @warehouse_id');
  if (location_id) where.push('(o.source_location_id = @location_id OR o.dest_location_id = @location_id)');
  if (category_id)
    where.push(
      'EXISTS (SELECT 1 FROM operation_lines l JOIN products p ON p.id = l.product_id WHERE l.operation_id = o.id AND p.category_id = @category_id)'
    );
  if (search)
    where.push(
      `(o.reference LIKE @search OR o.partner LIKE @search OR EXISTS (SELECT 1 FROM operation_lines l JOIN products p ON p.id = l.product_id
        WHERE l.operation_id = o.id AND (p.name LIKE @search OR p.sku LIKE @search)))`
    );
  const rows = db
    .prepare(
      `SELECT o.*, s.full_name AS source_name, d.full_name AS dest_name, w.name AS warehouse_name,
              r.name AS responsible_name,
              (SELECT COUNT(*) FROM operation_lines l WHERE l.operation_id = o.id) AS line_count,
              (SELECT SUM(quantity) FROM operation_lines l WHERE l.operation_id = o.id) AS total_qty
       FROM operations o
       JOIN locations s ON s.id = o.source_location_id
       JOIN locations d ON d.id = o.dest_location_id
       LEFT JOIN warehouses w ON w.id = o.warehouse_id
       LEFT JOIN users r ON r.id = o.responsible_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY o.id DESC LIMIT 500`
    )
    .all({ type, status, warehouse_id, category_id, location_id, search: `%${search || ''}%` });
  res.json(rows);
});

router.get('/operations/:id', (req, res) => res.json(engine.getOperation(req.params.id)));

router.post('/operations', (req, res) => {
  const id = engine.createOperation(req.body, req.user.id);
  res.status(201).json(engine.getOperation(id));
});

router.put('/operations/:id', (req, res) => {
  engine.updateOperation(req.params.id, req.body);
  res.json(engine.getOperation(req.params.id));
});

router.post('/operations/:id/confirm', (req, res) => {
  engine.confirmOperation(req.params.id);
  res.json(engine.getOperation(req.params.id));
});

router.post('/operations/:id/pick-pack', (req, res) => {
  engine.setPickPack(req.params.id, req.body);
  res.json(engine.getOperation(req.params.id));
});

router.post('/operations/:id/validate', (req, res) => {
  engine.validateOperation(req.params.id, req.user.id);
  res.json(engine.getOperation(req.params.id));
});

router.post('/operations/:id/cancel', (req, res) => {
  engine.cancelOperation(req.params.id);
  res.json(engine.getOperation(req.params.id));
});

router.delete('/operations/:id', (req, res) => {
  const op = engine.getOperation(req.params.id);
  if (op.status !== 'draft') return res.status(400).json({ error: 'Only drafts can be deleted' });
  db.prepare('DELETE FROM operations WHERE id = ?').run(op.id);
  res.json({ ok: true });
});

// ---------- Move history (stock ledger) ----------
router.get('/moves', (req, res) => {
  const { product_id, type, warehouse_id, location_id, search, from, to } = req.query;
  const where = [];
  if (product_id) where.push('m.product_id = @product_id');
  if (type) where.push('o.type = @type');
  if (warehouse_id) where.push('(fl.warehouse_id = @warehouse_id OR tl.warehouse_id = @warehouse_id)');
  if (location_id) where.push('(m.from_location_id = @location_id OR m.to_location_id = @location_id)');
  if (search) where.push('(p.name LIKE @search OR p.sku LIKE @search OR o.reference LIKE @search OR o.partner LIKE @search)');
  if (from) where.push('date(m.created_at) >= date(@from)');
  if (to) where.push('date(m.created_at) <= date(@to)');
  res.json(
    db.prepare(
      `SELECT m.*, p.name AS product_name, p.sku, p.uom, fl.full_name AS from_name, tl.full_name AS to_name,
              fl.type AS from_type, tl.type AS to_type, o.reference, o.type AS op_type, o.partner, u.name AS user_name
       FROM stock_moves m
       JOIN products p ON p.id = m.product_id
       JOIN locations fl ON fl.id = m.from_location_id
       JOIN locations tl ON tl.id = m.to_location_id
       LEFT JOIN operations o ON o.id = m.operation_id
       LEFT JOIN users u ON u.id = m.user_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY m.id DESC LIMIT 1000`
    ).all({ product_id, type, warehouse_id, location_id, from, to, search: `%${search || ''}%` })
  );
});

// ---------- Dashboard ----------
router.get('/dashboard', (req, res) => {
  const { warehouse_id, category_id } = req.query;
  const whLoc = warehouse_id ? 'AND l.warehouse_id = @warehouse_id' : '';
  const cat = category_id ? 'WHERE p.category_id = @category_id' : '';
  const params = { warehouse_id, category_id };

  const products = db
    .prepare(
      `SELECT p.id, p.name, p.sku, p.uom, p.min_qty,
         COALESCE((SELECT SUM(q.quantity) FROM stock_quants q JOIN locations l ON l.id = q.location_id
                   WHERE q.product_id = p.id AND l.type = 'internal' ${whLoc}), 0) AS on_hand
       FROM products p ${cat}`
    )
    .all(params);

  const opCatFilter = category_id
    ? 'AND EXISTS (SELECT 1 FROM operation_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.operation_id = o.id AND p.category_id = @category_id)'
    : '';
  const pending = (type) =>
    db.prepare(
      `SELECT COUNT(*) AS n FROM operations o WHERE o.type = @type AND o.status IN ${OPEN}
       ${warehouse_id ? 'AND o.warehouse_id = @warehouse_id' : ''} ${opCatFilter}`
    ).get({ ...params, type }).n;

  // Wireframe cards: Receipt / Delivery -> "N to receive", late, waiting, operations (scheduled in future)
  const card = (type) =>
    db.prepare(
      `SELECT
         SUM(CASE WHEN o.status = 'ready' THEN 1 ELSE 0 END) AS to_process,
         SUM(CASE WHEN o.scheduled_date IS NOT NULL AND date(o.scheduled_date) < date('now') THEN 1 ELSE 0 END) AS late,
         SUM(CASE WHEN o.status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
         SUM(CASE WHEN o.scheduled_date IS NOT NULL AND date(o.scheduled_date) > date('now') THEN 1 ELSE 0 END) AS upcoming,
         COUNT(*) AS open_total
       FROM operations o WHERE o.type = @type AND o.status IN ${OPEN}
       ${warehouse_id ? 'AND o.warehouse_id = @warehouse_id' : ''} ${opCatFilter}`
    ).get({ ...params, type });

  const late = db
    .prepare(
      `SELECT COUNT(*) AS n FROM operations o WHERE o.status IN ${OPEN} AND o.scheduled_date IS NOT NULL
       AND date(o.scheduled_date) < date('now') ${warehouse_id ? 'AND o.warehouse_id = @warehouse_id' : ''} ${opCatFilter}`
    )
    .get(params).n;

  const alerts = products
    .filter((p) => p.on_hand <= 0 || p.on_hand <= p.min_qty)
    .map((p) => ({ ...p, status: p.on_hand <= 0 ? 'out' : 'low' }))
    .sort((a, b) => a.on_hand - b.on_hand);

  res.json({
    total_products: products.length,
    in_stock: products.filter((p) => p.on_hand > 0).length,
    low_stock: products.filter((p) => p.on_hand > 0 && p.on_hand <= p.min_qty).length,
    out_of_stock: products.filter((p) => p.on_hand <= 0).length,
    pending_receipts: pending('receipt'),
    pending_deliveries: pending('delivery'),
    pending_transfers: pending('internal'),
    pending_adjustments: pending('adjustment'),
    late_operations: late,
    receipt_card: card('receipt'),
    delivery_card: card('delivery'),
    alerts: alerts.slice(0, 10),
    recent_moves: db
      .prepare(
        `SELECT m.id, m.quantity, m.created_at, p.name AS product_name, p.uom, fl.full_name AS from_name,
                tl.full_name AS to_name, o.reference, o.type AS op_type
         FROM stock_moves m JOIN products p ON p.id = m.product_id
         JOIN locations fl ON fl.id = m.from_location_id JOIN locations tl ON tl.id = m.to_location_id
         LEFT JOIN operations o ON o.id = m.operation_id ORDER BY m.id DESC LIMIT 8`
      )
      .all(),
  });
});

module.exports = router;