import { Db, one, q } from '../db';
import { ApiError, bad, notFound } from '../api/router';

export type Line = {
  description: string; qty: number; rate: number;
  type?: 'membership' | 'pt' | 'product' | 'other'; ref_id?: number | null;
  gst_rate?: number | null; sac_hsn?: string | null;
};
export type PaymentInput = { amount: number; method: string; reference?: string | null; paid_on?: string | null };

const paise = (n: number) => Math.round(n * 100);
const rupees = (p: number) => p / 100;
const dmy = (d: string) => d.split('-').reverse().join('-');

/** The current gym's settings. Inside a tenant scope only that gym's row is visible. */
export const getSettings = (db?: Db) => one<any>('SELECT * FROM settings', [], db) as Promise<any>;

/** Pure GST arithmetic in paise, so totals always add up exactly. */
export function computeLines(lines: Line[], discount: number, s: { gst_enabled: boolean; default_gst_rate: number; prices_include_gst: boolean; sac_code: string }) {
  const grossEach = lines.map((l) => paise(l.qty * l.rate));
  const gross = grossEach.reduce((a, b) => a + b, 0);
  const disc = paise(discount || 0);
  if (disc > gross) throw bad('Discount cannot be more than the bill amount');

  let discLeft = disc;
  const items = lines.map((l, i) => {
    const share = i === lines.length - 1 ? discLeft : Math.round((disc * grossEach[i]) / (gross || 1));
    discLeft -= share;
    const net = grossEach[i] - share;
    const r = s.gst_enabled ? (l.gst_rate ?? s.default_gst_rate) : 0;
    const rawTax = s.prices_include_gst ? net - Math.round((net * 100) / (100 + r)) : Math.round((net * r) / 100);
    const cgst = Math.round(rawTax / 2); // CGST and SGST must be equal on a bill
    const sgst = cgst;
    const taxable = s.prices_include_gst ? net - cgst - sgst : net;
    return { ...l, discountP: share, taxableP: taxable, gst_rate: r, cgstP: cgst, sgstP: sgst, amountP: taxable + cgst + sgst, sac: l.sac_hsn ?? (l.type === 'product' ? null : s.sac_code) };
  });
  const sum = (f: (x: (typeof items)[number]) => number) => items.reduce((a, x) => a + f(x), 0);
  return { items, gross: rupees(gross), discount: rupees(disc), taxable: rupees(sum((x) => x.taxableP)), cgst: rupees(sum((x) => x.cgstP)), sgst: rupees(sum((x) => x.sgstP)), total: rupees(sum((x) => x.amountP)) };
}

function financialYear(date: string) {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export async function createInvoice(db: Db, input: {
  member_id?: number | null; customer_name: string; customer_phone?: string | null;
  items: Line[]; discount?: number | null; invoice_date?: string | null; due_date?: string | null; notes?: string | null;
  user_id?: number | null; payment?: PaymentInput | PaymentInput[] | null;
  /** Usually left out: the bill then takes the member's branch, or the branch on screen. */
  branch_id?: number | null;
}) {
  if (!input.items.length) throw bad('Add at least one item to the bill');
  const s = await getSettings(db);
  const today = (await one<{ d: string }>('SELECT gym_today() d', [], db))!.d;
  const date = input.invoice_date || today;
  const c = computeLines(input.items, input.discount || 0, s);

  const fy = financialYear(date);
  const { last_no } = (await one<{ last_no: number }>(
    `INSERT INTO invoice_counters (fy, last_no) VALUES ($1, 1)
     ON CONFLICT (gym_id, fy) DO UPDATE SET last_no = invoice_counters.last_no + 1 RETURNING last_no`, [fy], db))!;
  const invoice_no = `${s.invoice_prefix}/${fy}/${String(last_no).padStart(4, '0')}`;

  const inv = (await one<any>(
    `INSERT INTO invoices (invoice_no, member_id, customer_name, customer_phone, invoice_date, due_date, gross, discount, taxable, cgst, sgst, total, status, notes, created_by, branch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [invoice_no, input.member_id ?? null, input.customer_name, input.customer_phone ?? null, date, input.due_date ?? null,
      c.gross, c.discount, c.taxable, c.cgst, c.sgst, c.total, c.total === 0 ? 'paid' : 'unpaid', input.notes ?? null, input.user_id ?? null, input.branch_id ?? null], db))!;

  for (const it of c.items) {
    await db.query(
      `INSERT INTO invoice_items (invoice_id, item_type, ref_id, description, sac_hsn, qty, rate, discount, taxable, gst_rate, cgst, sgst, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [inv.id, it.type ?? 'other', it.ref_id ?? null, it.description, it.sac, it.qty, it.rate, rupees(it.discountP), rupees(it.taxableP), it.gst_rate, rupees(it.cgstP), rupees(it.sgstP), rupees(it.amountP)]);
  }
  await addPayments(db, inv.id, input.payment, input.user_id);
  return inv;
}

async function refreshPaid(db: Db, invoiceId: number) {
  await db.query(
    `UPDATE invoices i SET paid = p.sum,
       status = CASE WHEN p.sum >= i.total THEN 'paid' WHEN p.sum > 0 THEN 'partial' ELSE 'unpaid' END
     FROM (SELECT COALESCE(sum(amount),0) AS sum FROM payments WHERE invoice_id=$1 AND NOT voided) p
     WHERE i.id=$1`, [invoiceId]);
}

export async function addPayment(db: Db, invoiceId: number, p: PaymentInput, userId?: number | null) {
  const inv = await one<any>('SELECT id, balance, status FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId], db);
  if (!inv) throw notFound('Bill not found');
  if (inv.status === 'cancelled') throw bad('This bill is cancelled');
  if (paise(p.amount) > paise(inv.balance)) throw bad(`Amount is more than the balance due (₹${inv.balance})`);
  const pay = await one<any>(
    `INSERT INTO payments (invoice_id, amount, method, reference, paid_on, received_by)
     VALUES ($1,$2,$3,$4,COALESCE($5::date, gym_today()),$6) RETURNING *`,
    [invoiceId, p.amount, p.method, p.reference ?? null, p.paid_on ?? null, userId ?? null], db);
  await refreshPaid(db, invoiceId);
  return pay;
}

/** Records one or more payments, for example ₹1000 cash and ₹1500 UPI on the same bill. */
export async function addPayments(db: Db, invoiceId: number, p: PaymentInput | PaymentInput[] | null | undefined, userId?: number | null) {
  const list = (Array.isArray(p) ? p : p ? [p] : []).filter((x) => x.amount > 0);
  if (list.length > 1) {
    const total = list.reduce((a, x) => a + paise(x.amount), 0);
    const inv = await one<any>('SELECT balance FROM invoices WHERE id=$1', [invoiceId], db);
    if (inv && total > paise(inv.balance)) throw bad(`Total received is more than the balance due (₹${inv.balance})`);
  }
  for (const x of list) await addPayment(db, invoiceId, x, userId);
}

export async function voidPayment(db: Db, paymentId: number) {
  const pay = await one<any>('UPDATE payments SET voided=true WHERE id=$1 AND NOT voided RETURNING invoice_id', [paymentId], db);
  if (!pay) throw notFound('Payment not found');
  await one('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [pay.invoice_id], db);
  await refreshPaid(db, pay.invoice_id);
}

/** Cancels a bill and undoes what it created: memberships, PT packages and stock. */
export async function cancelInvoice(db: Db, invoiceId: number, reason: string | null, userId?: number | null) {
  const inv = await one<any>('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId], db);
  if (!inv) throw notFound('Bill not found');
  if (inv.status === 'cancelled') throw bad('This bill is already cancelled');
  if (inv.paid > 0) throw new ApiError(409, 'This bill has payments. Remove the payments first, then cancel it.');
  await db.query(`UPDATE invoices SET status='cancelled', cancel_reason=$2 WHERE id=$1`, [invoiceId, reason]);
  await db.query(`UPDATE memberships SET status='cancelled' WHERE invoice_id=$1`, [invoiceId]);
  await db.query(`UPDATE pt_subscriptions SET status='cancelled' WHERE invoice_id=$1`, [invoiceId]);
  const products = await q<any>(`SELECT ref_id, qty FROM invoice_items WHERE invoice_id=$1 AND item_type='product' AND ref_id IS NOT NULL`, [invoiceId], db);
  for (const p of products) {
    await db.query('UPDATE products SET stock = stock + $2 WHERE id=$1', [p.ref_id, p.qty]);
    await db.query(`INSERT INTO stock_movements (product_id, type, qty, note, invoice_id, created_by) VALUES ($1,'return',$2,$3,$4,$5)`,
      [p.ref_id, p.qty, `Bill ${inv.invoice_no} cancelled`, invoiceId, userId ?? null]);
  }
}

/** Checks a time slot against the plan. A plan with slots needs one of them; other plans take any slot or none. */
export async function pickSlot(db: Db, plan: { name: string; slot_ids?: number[] | null } | null, slotId: number | null | undefined, branchId: number) {
  const allowed: number[] = plan?.slot_ids ?? [];
  if (!slotId) {
    if (allowed.length) throw bad(`Choose a time slot for the ${plan!.name} plan`);
    return null;
  }
  const slot = await one<any>('SELECT * FROM slots WHERE id=$1 AND branch_id=$2', [slotId, branchId], db);
  if (!slot) throw notFound('Time slot not found');
  if (allowed.length && !allowed.includes(slot.id)) throw bad(`The ${plan!.name} plan is not available in the ${slot.name} slot`);
  return slot as { id: number; name: string; start_time: string; end_time: string };
}

const hhmm = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
export const slotLabel = (s: { name: string; start_time: string; end_time: string }) => `${s.name} ${hhmm(s.start_time)}–${hhmm(s.end_time)}`;

export async function sellMembership(db: Db, input: {
  member_id: number; plan_id: number; slot_id?: number | null; start_date?: string | null; discount?: number | null;
  replace_current?: boolean; payment?: PaymentInput | PaymentInput[] | null; user_id?: number | null;
}) {
  const member = await one<any>('SELECT * FROM member_overview WHERE id=$1', [input.member_id], db);
  if (!member) throw notFound('Member not found');
  const plan = await one<any>('SELECT * FROM plans WHERE id=$1', [input.plan_id], db);
  if (!plan) throw notFound('Plan not found');
  if (plan.branch_id !== member.branch_id) throw bad('This plan belongs to a different branch from the member');
  const slot = await pickSlot(db, plan, input.slot_id, member.branch_id);

  if (input.replace_current) {
    await db.query(`UPDATE memberships SET status='cancelled' WHERE member_id=$1 AND status='active' AND end_date >= gym_today()`, [input.member_id]);
  }
  const start = input.start_date || (await one<{ d: string }>(
    `SELECT GREATEST(gym_today(), COALESCE((SELECT max(end_date) + 1 FROM memberships WHERE member_id=$1 AND status='active'), gym_today())) d`,
    [input.member_id], db))!.d;
  const ms = (await one<any>(
    `INSERT INTO memberships (member_id, plan_id, plan_name, start_date, end_date, price, slot_id, slot_name)
     VALUES ($1,$2,$3,$4::date, ($4::date + make_interval(months => $5::int, days => $6::int) - interval '1 day')::date, $7, $8, $9) RETURNING *`,
    [input.member_id, plan.id, plan.name, start, plan.duration_months, plan.duration_days, plan.price, slot?.id ?? null, slot ? slotLabel(slot) : null], db))!;
  const invoice = await createInvoice(db, {
    member_id: member.id, customer_name: member.name, customer_phone: member.phone,
    items: [{ description: `${plan.name} membership${slot ? `, ${slotLabel(slot)}` : ''} (${dmy(ms.start_date)} to ${dmy(ms.end_date)})`, qty: 1, rate: plan.price, type: 'membership', ref_id: ms.id }],
    discount: input.discount, payment: input.payment, user_id: input.user_id,
  });
  await db.query('UPDATE memberships SET invoice_id=$2 WHERE id=$1', [ms.id, invoice.id]);
  return { membership: ms, invoice };
}
