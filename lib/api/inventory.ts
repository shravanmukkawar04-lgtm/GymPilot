import { z } from 'zod';
import { insert, one, q, tx, update } from '../db';
import { bad, notFound, parse, route } from './router';
import * as s from './schemas';
import { createInvoice, Line } from '../services/billing';

const productSchema = z.object({
  sku: s.text, name: s.reqText, category: s.reqText, unit: s.text.transform((v) => v ?? 'pcs'), hsn: s.text,
  cost_price: s.money.default(0), sale_price: s.money.default(0), gst_rate: z.coerce.number().min(0).max(40).default(18),
  reorder_level: s.int.default(5), supplier: s.text, active: s.bool,
});

route('GET', '/products', 'inventory', async () => q(`SELECT *, stock <= reorder_level AS low FROM products WHERE active ORDER BY (stock <= reorder_level) DESC, name`));

route('POST', '/products', 'inventory', async ({ body, user }) => {
  const { opening_stock } = parse(z.object({ opening_stock: s.int.nullish() }), body);
  const data = parse(productSchema, body);
  return tx(async (db) => {
    const p = await insert('products', { ...data, stock: opening_stock ?? 0 }, db);
    if (opening_stock) await db.query(`INSERT INTO stock_movements (product_id, type, qty, unit_cost, note, created_by) VALUES ($1,'adjustment',$2,$3,'Opening stock',$4)`, [p.id, opening_stock, data.cost_price, user.id]);
    return p;
  });
});

route('PUT', '/products/:id', 'inventory', async ({ params, body }) => update('products', params.id, parse(productSchema, body)));
route('DELETE', '/products/:id', 'inventory', async ({ params }) => { await update('products', params.id, { active: false }); });

route('POST', '/products/:id/stock', 'inventory', async ({ params, body, user }) => {
  const v = parse(z.object({
    type: z.enum(['purchase', 'adjustment', 'damage']), qty: z.coerce.number().int().refine((n) => n !== 0, 'cannot be zero'),
    unit_cost: s.moneyOpt, note: s.text, record_expense: s.bool,
  }), body);
  if (v.type !== 'adjustment' && v.qty < 0) throw bad('Enter a positive quantity');
  const change = v.type === 'damage' ? -v.qty : v.qty;
  return tx(async (db) => {
    const p = await one<any>('SELECT * FROM products WHERE id=$1 FOR UPDATE', [params.id], db);
    if (!p) throw notFound('Product not found');
    if (p.stock + change < 0) throw bad(`Only ${p.stock} ${p.unit} in stock`);
    const cost = v.unit_cost ?? p.cost_price;
    await db.query('UPDATE products SET stock=stock+$2, cost_price=CASE WHEN $3 THEN $4 ELSE cost_price END WHERE id=$1', [p.id, change, v.type === 'purchase', cost]);
    await db.query('INSERT INTO stock_movements (product_id, type, qty, unit_cost, note, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [p.id, v.type, change, cost, v.note, user.id]);
    if (v.type === 'purchase' && v.record_expense && cost > 0) {
      await db.query(`INSERT INTO expenses (category, description, vendor, amount, created_by) VALUES ('Stock purchase',$1,$2,$3,$4)`, [`${v.qty} x ${p.name}`, p.supplier, v.qty * cost, user.id]);
    }
  });
});

route('POST', '/products/sell', 'inventory', async ({ body, user }) => {
  const v = parse(z.object({
    member_id: s.idOpt, customer_name: s.text, customer_phone: s.phoneOpt, discount: s.moneyOpt, payment: s.payment,
    items: z.array(z.object({ product_id: s.id, qty: z.coerce.number().int().min(1) })).min(1, 'add at least one product'),
  }), body);
  return tx(async (db) => {
    const member = v.member_id ? await one<any>('SELECT * FROM members WHERE id=$1', [v.member_id], db) : null;
    const lines: Line[] = [];
    for (const it of v.items) {
      const p = await one<any>('SELECT * FROM products WHERE id=$1 AND active FOR UPDATE', [it.product_id], db);
      if (!p) throw notFound('Product not found');
      if (p.stock < it.qty) throw bad(`Only ${p.stock} ${p.unit} of ${p.name} in stock`);
      lines.push({ description: p.name, qty: it.qty, rate: p.sale_price, type: 'product', ref_id: p.id, gst_rate: p.gst_rate, sac_hsn: p.hsn });
    }
    const invoice = await createInvoice(db, {
      member_id: member?.id ?? null, customer_name: member?.name ?? v.customer_name ?? 'Walk-in customer', customer_phone: member?.phone ?? v.customer_phone,
      items: lines, discount: v.discount ?? 0, payment: v.payment, user_id: user.id,
    });
    for (const it of v.items) {
      await db.query('UPDATE products SET stock=stock-$2 WHERE id=$1', [it.product_id, it.qty]);
      await db.query(`INSERT INTO stock_movements (product_id, type, qty, invoice_id, note, created_by) VALUES ($1,'sale',$2,$3,$4,$5)`, [it.product_id, -it.qty, invoice.id, `Bill ${invoice.invoice_no}`, user.id]);
    }
    return { invoice };
  });
});

route('GET', '/stock-movements', 'inventory', async () => q(`
  SELECT sm.*, p.name product_name, p.unit FROM stock_movements sm JOIN products p ON p.id=sm.product_id ORDER BY sm.id DESC LIMIT 200`));
