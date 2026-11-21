import { z } from 'zod';
import { Db, insert, one, q, tx, update } from '../db';
import { ApiError, bad, notFound, parse, route } from './router';
import * as s from './schemas';

/* Buying side of the shop: suppliers, their bills (purchases) and what the gym pays them.
   The selling side is the normal bill (see /products/sell), so members' dues stay in one place. */

const paise = (n: number) => Math.round(n * 100);

const supplierSchema = z.object({ name: s.reqText, phone: s.phoneOpt, gstin: s.text, address: s.text, notes: s.text });
const payOne = z.object({ amount: s.money.positive('must be more than 0'), method: s.method.default('cash'), reference: s.text, paid_on: s.date });
type PayIn = z.output<typeof payOne>;

/* ---------- Suppliers ---------- */

route('GET', '/suppliers', 'inventory', async () => q(`
  SELECT sp.*,
    COALESCE(x.owed, 0) AS owed, COALESCE(x.bought, 0) AS bought, x.last_purchase
  FROM suppliers sp
  LEFT JOIN LATERAL (
    SELECT sum(balance) AS owed, sum(total) AS bought, max(purchase_date) AS last_purchase
    FROM purchases p WHERE p.supplier_id = sp.id AND p.status <> 'cancelled'
  ) x ON true
  WHERE sp.active
  ORDER BY COALESCE(x.owed, 0) DESC, sp.name`));

route('POST', '/suppliers', 'inventory', async ({ body }) => insert('suppliers', parse(supplierSchema, body)));
route('PUT', '/suppliers/:id', 'inventory', async ({ params, body }) => update('suppliers', params.id, parse(supplierSchema, body)));
route('DELETE', '/suppliers/:id', 'inventory', async ({ params }) => {
  const owed = await one<{ n: number }>(`SELECT COALESCE(sum(balance),0) n FROM purchases WHERE supplier_id=$1 AND status <> 'cancelled'`, [params.id]);
  if (owed && owed.n > 0) throw bad(`You still owe this supplier ₹${owed.n}. Pay or cancel those bills first.`);
  await update('suppliers', params.id, { active: false });
});

route('GET', '/suppliers/:id', 'inventory', async ({ params }) => {
  const supplier = await one('SELECT * FROM suppliers WHERE id=$1', [params.id]);
  if (!supplier) throw notFound('Supplier not found');
  const [purchases, payments] = await Promise.all([
    q(`SELECT * FROM purchases WHERE supplier_id=$1 ORDER BY purchase_date DESC, id DESC LIMIT 200`, [params.id]),
    q(`SELECT sp.*, p.bill_no FROM supplier_payments sp JOIN purchases p ON p.id=sp.purchase_id
       WHERE sp.supplier_id=$1 AND NOT sp.voided ORDER BY sp.paid_on DESC, sp.id DESC LIMIT 200`, [params.id]),
  ]);
  return { supplier, purchases, payments };
});

/** One amount paid to a supplier, used up against their oldest unpaid bills first. */
route('POST', '/suppliers/:id/pay', 'inventory', async ({ params, body, user }) => {
  const v = parse(payOne, body);
  return tx(async (db) => {
    const open = await q<any>(`SELECT id, balance FROM purchases WHERE supplier_id=$1 AND status IN ('unpaid','partial')
      ORDER BY purchase_date, id FOR UPDATE`, [params.id], db);
    const owed = open.reduce((a, p) => a + paise(p.balance), 0);
    if (!open.length) throw bad('Nothing is owed to this supplier');
    if (paise(v.amount) > owed) throw bad(`Amount is more than what you owe (₹${owed / 100})`);
    let left = paise(v.amount);
    for (const p of open) {
      if (left <= 0) break;
      const part = Math.min(left, paise(p.balance));
      await payPurchase(db, p.id, { ...v, amount: part / 100 }, user.id);
      left -= part;
    }
  });
});

/* ---------- Purchases ---------- */

async function refreshPaid(db: Db, purchaseId: number) {
  await db.query(
    `UPDATE purchases pu SET paid = x.sum,
       status = CASE WHEN x.sum >= pu.total THEN 'paid' WHEN x.sum > 0 THEN 'partial' ELSE 'unpaid' END
     FROM (SELECT COALESCE(sum(amount),0) AS sum FROM supplier_payments WHERE purchase_id=$1 AND NOT voided) x
     WHERE pu.id=$1`, [purchaseId]);
}

/** Records a payment to the supplier and the matching expense, so Reports count it. */
async function payPurchase(db: Db, purchaseId: number, p: PayIn, userId: number) {
  const pu = await one<any>(`SELECT pu.*, s.name supplier_name FROM purchases pu JOIN suppliers s ON s.id=pu.supplier_id WHERE pu.id=$1 FOR UPDATE OF pu`, [purchaseId], db);
  if (!pu) throw notFound('Purchase not found');
  if (pu.status === 'cancelled') throw bad('This purchase is cancelled');
  if (paise(p.amount) > paise(pu.balance)) throw bad(`Amount is more than the balance due on this bill (₹${pu.balance})`);
  const pay = (await one<any>(
    `INSERT INTO supplier_payments (purchase_id, supplier_id, amount, method, reference, paid_on, paid_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, gym_today()),$7) RETURNING *`,
    [pu.id, pu.supplier_id, p.amount, p.method, p.reference ?? null, p.paid_on ?? null, userId], db))!;
  await q(
    `INSERT INTO expenses (expense_date, category, description, vendor, amount, method, reference, created_by, branch_id, supplier_payment_id)
     VALUES ($1,'Stock purchase',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [pay.paid_on, `Paid for supplier bill${pu.bill_no ? ` ${pu.bill_no}` : ''}`, pu.supplier_name, p.amount, p.method, p.reference ?? null, userId, pu.branch_id, pay.id], db);
  await refreshPaid(db, pu.id);
  return pay;
}

route('GET', '/purchases', 'inventory', async () => {
  const rows = await q(`SELECT p.*, s.name supplier_name,
      (SELECT string_agg(pr.name || ' × ' || pi.qty, ', ' ORDER BY pi.id) FROM purchase_items pi JOIN products pr ON pr.id=pi.product_id WHERE pi.purchase_id=p.id) items
    FROM purchases p JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.purchase_date DESC, p.id DESC LIMIT 200`);
  const summary = await one(`SELECT
      COALESCE((SELECT sum(balance) FROM purchases WHERE status IN ('unpaid','partial')),0) owed,
      COALESCE((SELECT sum(total) FROM purchases WHERE status <> 'cancelled' AND date_trunc('month',purchase_date)=date_trunc('month',gym_today()::timestamp)),0) AS month`);
  return { rows, summary };
});

route('GET', '/purchases/:id', 'inventory', async ({ params }) => {
  const purchase = await one(`SELECT p.*, s.name supplier_name, s.phone supplier_phone FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=$1`, [params.id]);
  if (!purchase) throw notFound('Purchase not found');
  const [items, payments] = await Promise.all([
    q(`SELECT pi.*, pr.name product_name, pr.unit FROM purchase_items pi JOIN products pr ON pr.id=pi.product_id WHERE pi.purchase_id=$1 ORDER BY pi.id`, [params.id]),
    q(`SELECT * FROM supplier_payments WHERE purchase_id=$1 ORDER BY id`, [params.id]),
  ]);
  return { purchase, items, payments };
});

/** Stock comes in from a supplier: stock goes up, buying prices update, and anything paid now is recorded. */
route('POST', '/purchases', 'inventory', async ({ body, user }) => {
  const v = parse(z.object({
    supplier_id: s.id, bill_no: s.text, purchase_date: s.date, notes: s.text,
    items: z.array(z.object({ product_id: s.id, qty: z.coerce.number().int().min(1, 'must be at least 1'), unit_cost: s.money })).min(1, 'add at least one product'),
    payment: payOne.nullish(),
  }), body);
  return tx(async (db) => {
    const supplier = await one<any>('SELECT * FROM suppliers WHERE id=$1 AND active', [v.supplier_id], db);
    if (!supplier) throw notFound('Supplier not found');
    let branch: number | null = null;
    let total = 0;
    const products: any[] = [];
    for (const it of v.items) {
      const p = await one<any>('SELECT * FROM products WHERE id=$1 AND active FOR UPDATE', [it.product_id], db);
      if (!p) throw notFound('Product not found');
      if (branch !== null && p.branch_id !== branch) throw bad('All products in one purchase must belong to the same branch');
      branch = p.branch_id;
      products.push(p);
      total += paise(it.qty * it.unit_cost);
    }
    const pu = await insert<any>('purchases', {
      supplier_id: supplier.id, bill_no: v.bill_no, purchase_date: v.purchase_date ?? undefined, notes: v.notes,
      total: total / 100, status: total === 0 ? 'paid' : 'unpaid', created_by: user.id, branch_id: branch,
    }, db);
    for (const [i, it] of v.items.entries()) {
      const p = products[i];
      await db.query('INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost, amount) VALUES ($1,$2,$3,$4,$5)',
        [pu.id, p.id, it.qty, it.unit_cost, paise(it.qty * it.unit_cost) / 100]);
      await db.query('UPDATE products SET stock=stock+$2, cost_price=$3 WHERE id=$1', [p.id, it.qty, it.unit_cost]);
      await db.query(`INSERT INTO stock_movements (product_id, type, qty, unit_cost, note, purchase_id, created_by) VALUES ($1,'purchase',$2,$3,$4,$5,$6)`,
        [p.id, it.qty, it.unit_cost, `From ${supplier.name}${v.bill_no ? `, bill ${v.bill_no}` : ''}`, pu.id, user.id]);
    }
    if (v.payment && v.payment.amount > 0) await payPurchase(db, pu.id, v.payment, user.id);
    return pu;
  });
});

route('POST', '/purchases/:id/payments', 'inventory', async ({ params, body, user }) =>
  tx((db) => payPurchase(db, Number(params.id), parse(payOne, body), user.id)));

/** Undo a payment to a supplier. Its expense entry goes with it. */
route('POST', '/supplier-payments/:id/void', 'inventory', async ({ params }) => {
  await tx(async (db) => {
    const pay = await one<any>('UPDATE supplier_payments SET voided=true WHERE id=$1 AND NOT voided RETURNING purchase_id', [params.id], db);
    if (!pay) throw notFound('Payment not found');
    await db.query('DELETE FROM expenses WHERE supplier_payment_id=$1', [params.id]);
    await one('SELECT id FROM purchases WHERE id=$1 FOR UPDATE', [pay.purchase_id], db);
    await refreshPaid(db, pay.purchase_id);
  });
});

/** Cancel a purchase entered by mistake or returned to the supplier. Takes the stock back out. */
route('POST', '/purchases/:id/cancel', 'inventory', async ({ params, user }) => {
  await tx(async (db) => {
    const pu = await one<any>('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [params.id], db);
    if (!pu) throw notFound('Purchase not found');
    if (pu.status === 'cancelled') throw bad('This purchase is already cancelled');
    if (pu.paid > 0) throw new ApiError(409, 'This purchase has payments. Undo the payments first, then cancel it.');
    const items = await q<any>('SELECT pi.*, p.name, p.stock, p.unit FROM purchase_items pi JOIN products p ON p.id=pi.product_id WHERE pi.purchase_id=$1 FOR UPDATE OF p', [pu.id], db);
    for (const it of items) {
      if (it.stock < it.qty) throw bad(`Only ${it.stock} ${it.unit} of ${it.name} left, so this purchase of ${it.qty} cannot be taken back out. Correct the stock first.`);
    }
    for (const it of items) {
      await db.query('UPDATE products SET stock=stock-$2 WHERE id=$1', [it.product_id, it.qty]);
      await db.query(`INSERT INTO stock_movements (product_id, type, qty, unit_cost, note, purchase_id, created_by) VALUES ($1,'return',$2,$3,$4,$5,$6)`,
        [it.product_id, -it.qty, it.unit_cost, `Purchase${pu.bill_no ? ` ${pu.bill_no}` : ''} cancelled`, pu.id, user.id]);
    }
    await db.query(`UPDATE purchases SET status='cancelled' WHERE id=$1`, [pu.id]);
  });
});

/* ---------- Selling side ---------- */

/** Bills that include shop products, with what each customer still owes. */
route('GET', '/product-sales', 'inventory', async () => {
  const rows = await q(`SELECT i.id, i.invoice_no, i.invoice_date, i.customer_name, i.customer_phone, i.member_id, i.gross, i.discount, i.total, i.paid, i.balance, i.status,
      (SELECT string_agg(ii.description || ' × ' || ii.qty::int, ', ' ORDER BY ii.id) FROM invoice_items ii WHERE ii.invoice_id=i.id AND ii.item_type='product') items
    FROM invoices i
    WHERE EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id=i.id AND ii.item_type='product')
    ORDER BY i.invoice_date DESC, i.id DESC LIMIT 200`);
  const summary = await one(`SELECT
      COALESCE(sum(balance) FILTER (WHERE status IN ('unpaid','partial')),0) owed,
      COALESCE(sum(total) FILTER (WHERE status <> 'cancelled' AND date_trunc('month',invoice_date)=date_trunc('month',gym_today()::timestamp)),0) AS month,
      COALESCE(sum(paid) FILTER (WHERE status <> 'cancelled' AND date_trunc('month',invoice_date)=date_trunc('month',gym_today()::timestamp)),0) AS month_paid,
      COALESCE(sum(total) FILTER (WHERE status <> 'cancelled' AND invoice_date=gym_today()),0) AS today,
      count(*) FILTER (WHERE status <> 'cancelled' AND date_trunc('month',invoice_date)=date_trunc('month',gym_today()::timestamp)) AS month_bills
    FROM invoices i WHERE EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id=i.id AND ii.item_type='product')`);
  return { rows, summary };
});
