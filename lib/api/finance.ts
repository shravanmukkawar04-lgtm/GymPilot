import { z } from 'zod';
import { insert, one, q, tx, update } from '../db';
import { notFound, parse, route } from './router';
import * as s from './schemas';
import { addPayment, addPayments, cancelInvoice, createInvoice, getSettings, voidPayment } from '../services/billing';

const invoiceSchema = z.object({
  member_id: s.idOpt, customer_name: s.text, customer_phone: s.phoneOpt, due_date: s.date, notes: s.text, discount: s.moneyOpt, payment: s.payment,
  items: z.array(z.object({ description: s.reqText, qty: z.coerce.number().positive('must be more than 0'), rate: s.money, gst_rate: z.coerce.number().min(0).max(40).nullish() })).min(1, 'add at least one item'),
});
const expenseSchema = z.object({
  expense_date: s.date, category: s.reqText, description: s.text, vendor: s.text, amount: s.money.positive('must be more than 0'), method: s.method.default('cash'), reference: s.text,
});
const paymentSchema = z.object({ amount: s.money.positive('must be more than 0'), method: s.method.default('cash'), reference: s.text, paid_on: s.date });

route('GET', '/invoices', 'billing', async ({ query }) => {
  const status = query.get('status');
  const term = query.get('q')?.trim();
  const params: unknown[] = [];
  const where: string[] = [];
  if (status === 'due') where.push(`status IN ('unpaid','partial')`);
  else if (status) { params.push(status); where.push(`status=$${params.length}`); }
  if (term) { params.push(`%${term}%`); where.push(`(customer_name ILIKE $${params.length} OR invoice_no ILIKE $${params.length} OR customer_phone ILIKE $${params.length})`); }
  const rows = await q(`SELECT * FROM invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`, params);
  const summary = await one(`SELECT
      COALESCE((SELECT sum(amount) FROM payments WHERE NOT voided AND paid_on=gym_today()),0) today,
      COALESCE((SELECT sum(amount) FROM payments WHERE NOT voided AND date_trunc('month',paid_on)=date_trunc('month',gym_today()::timestamp)),0) AS month,
      COALESCE((SELECT sum(balance) FROM invoices WHERE status IN ('unpaid','partial')),0) dues,
      (SELECT count(*) FROM invoices WHERE status IN ('unpaid','partial')) due_count`);
  return { rows, summary };
});

route('POST', '/invoices', 'billing', async ({ body, user }) => {
  const v = parse(invoiceSchema, body);
  return tx(async (db) => {
    const member = v.member_id ? await one<any>('SELECT * FROM members WHERE id=$1', [v.member_id], db) : null;
    return createInvoice(db, {
      member_id: member?.id ?? null, customer_name: member?.name ?? v.customer_name ?? 'Walk-in customer', customer_phone: member?.phone ?? v.customer_phone,
      items: v.items.map((i) => ({ ...i, type: 'other' as const })), discount: v.discount ?? 0, due_date: v.due_date, notes: v.notes, payment: v.payment, user_id: user.id,
    });
  });
});

route('GET', '/invoices/:id', 'billing', async ({ params }) => {
  const invoice = await one('SELECT * FROM invoices WHERE id=$1', [params.id]);
  if (!invoice) throw notFound('Bill not found');
  const [items, payments, settings] = await Promise.all([
    q('SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id', [params.id]),
    q('SELECT * FROM payments WHERE invoice_id=$1 ORDER BY id', [params.id]),
    getSettings(),
  ]);
  return { invoice, items, payments, settings };
});

route('POST', '/invoices/:id/payments', 'billing', async ({ params, body, user }) => {
  // { payments: [...] } records a split payment, such as part cash and part UPI.
  if (Array.isArray(body.payments)) {
    const list = parse(z.array(paymentSchema).min(1).max(4), body.payments);
    return tx((db) => addPayments(db, Number(params.id), list, user.id));
  }
  const v = parse(paymentSchema, body);
  return tx((db) => addPayment(db, Number(params.id), v, user.id));
});

route('POST', '/invoices/:id/cancel', 'billing', async ({ params, body, user }) => {
  await tx((db) => cancelInvoice(db, Number(params.id), body.reason ?? null, user.id));
});

route('POST', '/payments/:id/void', 'billing', async ({ params }) => { await tx((db) => voidPayment(db, Number(params.id))); });

route('GET', '/payments', 'billing', async () => q(`
  SELECT p.*, i.invoice_no, i.customer_name FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE NOT p.voided ORDER BY p.paid_on DESC, p.id DESC LIMIT 200`));

route('GET', '/expenses', 'expenses', async ({ query }) => {
  const month = query.get('month') + '-01';
  const [rows, byCategory] = await Promise.all([
    q(`SELECT * FROM expenses WHERE date_trunc('month',expense_date)=$1::date ORDER BY expense_date DESC, id DESC`, [month]),
    q(`SELECT category, sum(amount) total FROM expenses WHERE date_trunc('month',expense_date)=$1::date GROUP BY category ORDER BY total DESC`, [month]),
  ]);
  return { rows, byCategory };
});
route('POST', '/expenses', 'expenses', async ({ body, user }) => {
  const v = parse(expenseSchema, body);
  return insert('expenses', { ...v, expense_date: v.expense_date ?? undefined, created_by: user.id });
});
route('PUT', '/expenses/:id', 'expenses', async ({ params, body }) => {
  const v = parse(expenseSchema, body);
  return update('expenses', params.id, { ...v, expense_date: v.expense_date ?? undefined });
});
route('DELETE', '/expenses/:id', 'expenses', async ({ params }) => { await q('DELETE FROM expenses WHERE id=$1', [params.id]); });
