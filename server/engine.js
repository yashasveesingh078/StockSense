// The stock engine. Receipts, deliveries, transfers and adjustments all go through here.
// Core rule: stock only changes when an operation is VALIDATED, and every change is a
// stock_moves row + a stock_quants update, written together in ONE transaction.
const db = require('./db');

class StockError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const TYPE_CODES = { receipt: 'IN', delivery: 'OUT', internal: 'INT', adjustment: 'ADJ' };

function getQuant(productId, locationId) {
  const row = db
    .prepare('SELECT quantity FROM stock_quants WHERE product_id = ? AND location_id = ?')
    .get(productId, locationId);
  return row ? row.quantity : 0;
}

function addQuant(productId, locationId, delta) {
  db.prepare(
    `INSERT INTO stock_quants (product_id, location_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(product_id, location_id) DO UPDATE SET quantity = quantity + excluded.quantity`
  ).run(productId, locationId, delta);
}

/** Write one ledger move and update both quants. Must be called inside a transaction. */
function moveStock({ productId, fromId, toId, qty, operationId, userId }) {
  if (qty <= 0) return;
  const from = db.prepare('SELECT * FROM locations WHERE id = ?').get(fromId);
  if (from.type === 'internal') {
    const available = getQuant(productId, fromId);
    if (available + 1e-9 < qty) {
      const p = db.prepare('SELECT name, uom FROM products WHERE id = ?').get(productId);
      throw new StockError(
        `Not enough stock of "${p.name}" at ${from.full_name}: available ${available} ${p.uom}, required ${qty} ${p.uom}`
      );
    }
  }
  db.prepare(
    `INSERT INTO stock_moves (product_id, from_location_id, to_location_id, quantity, operation_id, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(productId, fromId, toId, qty, operationId, userId);
  addQuant(productId, fromId, -qty);
  addQuant(productId, toId, qty);
}

/** Next reference like WH/IN/0003, numbered per warehouse + type. */
function nextReference(warehouseId, type) {
  const wh = warehouseId
    ? db.prepare('SELECT short_code FROM warehouses WHERE id = ?').get(warehouseId)
    : null;
  const prefix = `${wh ? wh.short_code : 'GEN'}/${TYPE_CODES[type]}/`;
  const last = db
    .prepare('SELECT reference FROM operations WHERE reference LIKE ? ORDER BY id DESC LIMIT 1')
    .get(prefix + '%');
  const n = last ? parseInt(last.reference.split('/').pop(), 10) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}

/** Fill in / check source & destination based on operation type. */
function resolveLocations(type, sourceId, destId, locationId) {
  const loc = (id) => (id ? db.prepare('SELECT * FROM locations WHERE id = ?').get(id) : null);
  let src, dst;
  if (type === 'receipt') {
    src = db.virtualLocation('vendor');
    dst = loc(destId);
    if (!dst || dst.type !== 'internal') throw new StockError('Receipt needs a destination warehouse location');
  } else if (type === 'delivery') {
    src = loc(sourceId);
    dst = db.virtualLocation('customer');
    if (!src || src.type !== 'internal') throw new StockError('Delivery needs a source warehouse location');
  } else if (type === 'internal') {
    src = loc(sourceId);
    dst = loc(destId);
    if (!src || !dst || src.type !== 'internal' || dst.type !== 'internal')
      throw new StockError('Internal transfer needs source and destination warehouse locations');
    if (src.id === dst.id) throw new StockError('Source and destination must be different');
  } else if (type === 'adjustment') {
    // Adjustment is done for ONE location; loss location is the counterpart.
    const l = loc(locationId || destId || sourceId);
    if (!l || l.type !== 'internal') throw new StockError('Adjustment needs a warehouse location');
    src = l;
    dst = l;
  } else {
    throw new StockError('Invalid operation type');
  }
  const warehouseId = (src.type === 'internal' ? src : dst).warehouse_id;
  return { src, dst, warehouseId };
}

function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new StockError('Add at least one product line');
  const seen = new Set();
  for (const l of lines) {
    const q = Number(l.quantity);
    if (!l.product_id) throw new StockError('Every line needs a product');
    if (!Number.isFinite(q) || q < 0) throw new StockError('Quantities must be zero or more');
    if (seen.has(Number(l.product_id))) throw new StockError('The same product appears twice; merge the lines');
    seen.add(Number(l.product_id));
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(l.product_id))
      throw new StockError('Unknown product in lines');
  }
}

function getOperation(id) {
  const op = db
    .prepare(
      `SELECT o.*, s.full_name AS source_name, d.full_name AS dest_name, w.name AS warehouse_name,
              u.name AS created_by_name
       FROM operations o
       JOIN locations s ON s.id = o.source_location_id
       JOIN locations d ON d.id = o.dest_location_id
       LEFT JOIN warehouses w ON w.id = o.warehouse_id
       LEFT JOIN users u ON u.id = o.created_by
       WHERE o.id = ?`
    )
    .get(id);
  if (!op) throw new StockError('Operation not found', 404);
  op.lines = db
    .prepare(
      `SELECT l.id, l.product_id, l.quantity, p.name AS product_name, p.sku, p.uom
       FROM operation_lines l JOIN products p ON p.id = l.product_id
       WHERE l.operation_id = ? ORDER BY l.id`
    )
    .all(id)
    .map((l) => ({ ...l, available: getQuant(l.product_id, op.source_location_id) }));
  return op;
}

const createOperation = db.transaction((data, userId) => {
  const { type, partner, scheduled_date, notes, lines } = data;
  const { src, dst, warehouseId } = resolveLocations(
    type, data.source_location_id, data.dest_location_id, data.location_id
  );
  validateLines(lines);
  const reference = nextReference(warehouseId, type);
  const info = db
    .prepare(
      `INSERT INTO operations (reference, type, partner, source_location_id, dest_location_id, warehouse_id,
                               scheduled_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(reference, type, partner || null, src.id, dst.id, warehouseId, scheduled_date || null, notes || null, userId);
  const ins = db.prepare('INSERT INTO operation_lines (operation_id, product_id, quantity) VALUES (?, ?, ?)');
  for (const l of lines) ins.run(info.lastInsertRowid, l.product_id, Number(l.quantity));
  return info.lastInsertRowid;
});

const updateOperation = db.transaction((id, data) => {
  const op = getOperation(id);
  if (op.status !== 'draft') throw new StockError('Only draft operations can be edited');
  const { src, dst, warehouseId } = resolveLocations(
    op.type, data.source_location_id, data.dest_location_id, data.location_id
  );
  validateLines(data.lines);
  db.prepare(
    `UPDATE operations SET partner = ?, source_location_id = ?, dest_location_id = ?, warehouse_id = ?,
       scheduled_date = ?, notes = ? WHERE id = ?`
  ).run(data.partner || null, src.id, dst.id, warehouseId, data.scheduled_date || null, data.notes || null, id);
  db.prepare('DELETE FROM operation_lines WHERE operation_id = ?').run(id);
  const ins = db.prepare('INSERT INTO operation_lines (operation_id, product_id, quantity) VALUES (?, ?, ?)');
  for (const l of data.lines) ins.run(id, l.product_id, Number(l.quantity));
});

/** Is there enough stock at the source for every line? Receipts/adjustments always are. */
function isAvailable(op) {
  if (op.type === 'receipt' || op.type === 'adjustment') return true;
  return op.lines.every((l) => getQuant(l.product_id, op.source_location_id) + 1e-9 >= l.quantity);
}

/** Draft -> Ready (stock available) or Waiting (not enough stock yet). Also used to re-check. */
function confirmOperation(id) {
  const op = getOperation(id);
  if (!['draft', 'waiting', 'ready'].includes(op.status))
    throw new StockError(`Cannot confirm an operation that is ${op.status}`);
  const status = isAvailable(op) ? 'ready' : 'waiting';
  db.prepare('UPDATE operations SET status = ? WHERE id = ?').run(status, id);
  return status;
}

function setPickPack(id, { picked, packed }) {
  const op = getOperation(id);
  if (op.type !== 'delivery') throw new StockError('Pick/Pack only applies to deliveries');
  if (['done', 'canceled'].includes(op.status)) throw new StockError(`Operation is already ${op.status}`);
  if (packed && !(picked ?? op.picked)) throw new StockError('Pick the items before packing');
  db.prepare('UPDATE operations SET picked = ?, packed = ? WHERE id = ?').run(
    picked !== undefined ? (picked ? 1 : 0) : op.picked,
    packed !== undefined ? (packed ? 1 : 0) : op.packed,
    id
  );
}

/** Validate = actually move the stock. All-or-nothing. */
const validateOperation = db.transaction((id, userId) => {
  const op = getOperation(id);
  if (op.status === 'done') throw new StockError('Operation is already done');
  if (op.status === 'canceled') throw new StockError('Canceled operations cannot be validated');
  if (op.type === 'delivery' && !(op.picked && op.packed))
    throw new StockError('Pick and pack the items before validating the delivery');

  const loss = db.virtualLocation('loss');
  for (const l of op.lines) {
    if (op.type === 'adjustment') {
      // counted - recorded = difference, booked against Inventory Loss
      const current = getQuant(l.product_id, op.source_location_id);
      const diff = l.quantity - current;
      if (diff > 0) moveStock({ productId: l.product_id, fromId: loss.id, toId: op.source_location_id, qty: diff, operationId: id, userId });
      if (diff < 0) moveStock({ productId: l.product_id, fromId: op.source_location_id, toId: loss.id, qty: -diff, operationId: id, userId });
    } else {
      moveStock({ productId: l.product_id, fromId: op.source_location_id, toId: op.dest_location_id, qty: l.quantity, operationId: id, userId });
    }
  }
  db.prepare("UPDATE operations SET status = 'done', validated_at = datetime('now') WHERE id = ?").run(id);
});

function cancelOperation(id) {
  const op = getOperation(id);
  if (op.status === 'done') throw new StockError('Done operations cannot be canceled');
  db.prepare("UPDATE operations SET status = 'canceled' WHERE id = ?").run(id);
}

/** Convenience: create + validate in one go (used for initial stock and quick adjustments). */
function createAndValidate(data, userId) {
  return db.transaction(() => {
    const id = createOperation(data, userId);
    validateOperation(id, userId);
    return id;
  })();
}

module.exports = {
  StockError,
  getQuant,
  getOperation,
  createOperation,
  updateOperation,
  confirmOperation,
  setPickPack,
  validateOperation,
  cancelOperation,
  createAndValidate,
};