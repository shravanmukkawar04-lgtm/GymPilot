/**
 * The automatic messages that go out at a moment: a payment is collected, a shop sale is made, a membership is
 * renewed or put on hold, a staff member or enquiry is added. Each one has its own switch in Settings (off until
 * the owner turns it on) and uses the template chosen for it there, or the built-in one from the library.
 *
 * Nothing here can break the action that caused it. A failure is logged and the message is simply not sent.
 */
import { one, q, tx } from '../db';
import { getSettings } from './billing';
import { automationTemplate, contactVars, flushQueue, formatDate, formatMoney, queueOne, runAutomations } from './messaging';

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer' };
const methodText = (methods: string[]) => [...new Set(methods.map((m) => METHOD_LABEL[m] ?? m))].join(' + ') || '-';

type Who = { member_id?: number | null; lead_id?: number | null; name: string; phone?: string | null; email?: string | null };

/** WhatsApp does not accept an empty blank, so anything missing is shown as a dash. */
const dash = (vars: Record<string, unknown>) => Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v === null || v === undefined || v === '' ? '-' : v]));

/** Puts one message in the queue if its switch is on. `key` is the built-in template's key. Returns its id, or null when nothing was queued. */
async function queueEvent(flag: string, key: string, who: Who, vars: Record<string, unknown>, dedupe: string) {
  const s = await getSettings();
  if (!s[flag] || !who.phone) return null;
  const t = await automationTemplate(s, key);
  if (!t) return null;
  if (who.member_id && (await one<{ o: boolean }>('SELECT whatsapp_opt_out o FROM members WHERE id=$1', [who.member_id]))?.o) return null;
  const r = await queueOne(undefined, {
    member_id: who.member_id ?? null, lead_id: who.lead_id ?? null, to_name: who.name, phone: who.phone, email: who.email ?? null,
    channel: 'whatsapp', template: t, body: t.body, vars: dash({ name: who.name, gym_name: s.gym_name, ...contactVars(s), ...vars }), origin: 'automatic', dedupe_key: dedupe,
  });
  return r?.id ?? null;
}

/** Sends queued messages now. If sending cannot even start (for example WhatsApp is misconfigured), they go back to waiting instead of staying stuck as "sending". */
async function flushSafely(ids: number[]) {
  if (!ids.length) return 0;
  try {
    return await flushQueue(ids);
  } catch (e) {
    console.error('[notify send]', e);
    await q(`UPDATE messages SET status='queued', claimed_at=NULL WHERE id = ANY($1) AND status='sending'`, [ids]).catch(() => {});
    return 0;
  }
}

/** Runs one notification safely: inside its own savepoint, never throwing, and sending at once when it can. */
async function safely(label: string, fn: () => Promise<number[] | number | null>) {
  try {
    const out = await tx(fn);
    const ids = (Array.isArray(out) ? out : out ? [out] : []).filter(Boolean);
    await flushSafely(ids);
  } catch (e) {
    console.error(`[notify ${label}]`, e);
  }
}

/** The person a bill belongs to: the member when there is one, otherwise the name and phone on the bill. */
async function billTo(inv: any): Promise<Who> {
  if (inv.member_id) {
    const m = await one<any>('SELECT id, name, phone, email FROM members WHERE id=$1', [inv.member_id]);
    if (m) return { member_id: m.id, name: m.name, phone: m.phone, email: m.email };
  }
  return { name: inv.customer_name, phone: inv.customer_phone };
}

async function billDetails(invoiceId: number) {
  const inv = await one<any>('SELECT * FROM invoices WHERE id=$1', [invoiceId]);
  if (!inv) return null;
  const items = await q<any>('SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id', [invoiceId]);
  const products = items.filter((i) => i.item_type === 'product').map((i) => `${i.description} × ${Number(i.qty)}`);
  const methods = (await q<{ method: string }>('SELECT method FROM payments WHERE invoice_id=$1 AND NOT voided ORDER BY id', [invoiceId])).map((p) => p.method);
  return { inv, items, products, isShop: products.length > 0, methods };
}

/** Money collected against a bill after the sale. A shop bill gets the shop receipt; any other bill the member receipt. */
export async function notifyPaymentReceived(invoiceId: number, applied: { amount: number; method: string; paid_on?: string | null }[]) {
  await safely('payment', async () => {
    const b = await billDetails(invoiceId);
    if (!b || !applied.length) return null;
    const { inv } = b;
    const received = applied.reduce((a, p) => a + Number(p.amount), 0);
    const date = formatDate(applied[0].paid_on ?? (await one<{ d: string }>('SELECT gym_today() d'))!.d);
    const method = methodText(applied.map((p) => p.method));
    const who = await billTo(inv);
    const dedupe = `receipt:${invoiceId}:${Number(inv.paid)}`;
    if (b.isShop) {
      return queueEvent('auto_pos_receipt', 'pospaymentreceipt', who, {
        bill_no: inv.invoice_no, invoice_no: inv.invoice_no, products: b.products.join(', '), pos_paid_amount: formatMoney(received), payment_date: date, pos_payment_method: method,
      }, dedupe);
    }
    return queueEvent('auto_receipt', 'memberpaymentreceipt', who, {
      receipt_no: inv.invoice_no, package: b.items[0]?.description, total_fee: formatMoney(inv.total), previously_paid: formatMoney(Number(inv.paid) - received),
      payment_received: formatMoney(received), outstanding_balance: formatMoney(inv.balance), payment_date: date, payment_method: method,
    }, dedupe);
  });
}

/** A membership was renewed or its plan changed. */
export async function notifyRenewal(membershipId: number, invoiceId: number) {
  await safely('renewal', async () => {
    const ms = await one<any>('SELECT * FROM memberships WHERE id=$1', [membershipId]);
    const b = await billDetails(invoiceId);
    if (!ms || !b) return null;
    return queueEvent('auto_renewal', 'renewalenrollmentconfirmation', await billTo(b.inv), {
      package: ms.plan_name, total_fee: formatMoney(b.inv.total), paid_amount: formatMoney(b.inv.paid), payment_method: methodText(b.methods),
      amount_due: formatMoney(b.inv.balance), start_date: formatDate(ms.start_date), expiry_date: formatDate(ms.end_date),
    }, `renewal:${membershipId}`);
  });
}

/** A shop sale was made. */
export async function notifyShopSale(invoiceId: number) {
  await safely('shop sale', async () => {
    const b = await billDetails(invoiceId);
    if (!b?.isShop) return null;
    const { inv } = b;
    return queueEvent('auto_pos_sale', 'possellconfirmation', await billTo(inv), {
      bill_no: inv.invoice_no, purchase_date: formatDate(inv.invoice_date), products: b.products.join(', '), total_amount: formatMoney(inv.gross),
      discount: formatMoney(inv.discount), payable_amount: formatMoney(inv.total), pos_paid_amount: formatMoney(inv.paid), pos_payment_method: methodText(b.methods),
      remaining_amount: formatMoney(inv.balance),
    }, `possale:${invoiceId}`);
  });
}

/** A hold was added to a membership. */
export async function notifyFreeze(ms: any, holdStart: string, holdEnd: string) {
  await safely('hold', async () => {
    const m = await one<any>('SELECT id, name, phone, email FROM members WHERE id=$1', [ms.member_id]);
    if (!m) return null;
    const resume = (await one<{ d: string }>('SELECT ($1::date + 1) AS d', [holdEnd]))!.d;
    return queueEvent('auto_freeze', 'membershipfreezenotification', { member_id: m.id, name: m.name, phone: m.phone, email: m.email }, {
      package: ms.plan_name, resume_date: formatDate(resume), expiry_date: formatDate(ms.end_date),
    }, `freeze:${ms.id}:${holdStart}:${holdEnd}`);
  });
}

/** A staff member was added. */
export async function notifyNewStaff(st: any) {
  await safely('staff', async () => {
    const s = await getSettings();
    return queueEvent('auto_employee', 'employeeregistration', { name: st.name, phone: st.phone, email: st.email }, {
      employee_id: `EMP${String(st.id).padStart(3, '0')}`, username: st.email, login_url: s.member_login_url,
      department: st.is_trainer ? 'Training' : 'Administration', designation: st.role_title, joining_date: formatDate(st.joined_on),
    }, `staff:${st.id}`);
  });
}

/** An enquiry was added. */
export async function notifyEnquiry(lead: any) {
  await safely('enquiry', async () => queueEvent('auto_enquiry', 'enquiry', { lead_id: lead.id, name: lead.name, phone: lead.phone, email: lead.email }, { package: lead.interest || 'membership' }, `enquiry:${lead.id}`));
}

/** Messages that go out on a day, not at an event: enquiry follow-ups, and shop bills that are still unpaid (weekly). */
export async function runEventReminders() {
  const s = await getSettings();
  const ids: number[] = [];
  const today = (await one<{ d: string }>('SELECT gym_today() d'))!.d;
  if (s.auto_followup) {
    for (const l of await q<any>(`SELECT * FROM leads WHERE next_followup = gym_today() AND status NOT IN ('won','lost')`)) {
      const id = await queueEvent('auto_followup', 'followup', { lead_id: l.id, name: l.name, phone: l.phone, email: l.email }, { package: l.interest || 'membership' }, `followup:${l.id}:${today}`);
      if (id) ids.push(id);
    }
  }
  if (s.auto_pos_due) {
    const week = (await one<{ w: string }>(`SELECT to_char(gym_today(),'IYYY-IW') w`))!.w;
    for (const inv of await q<any>(`SELECT i.id FROM invoices i WHERE i.status IN ('unpaid','partial') AND EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id=i.id AND ii.item_type='product')`)) {
      const b = await billDetails(inv.id);
      if (!b) continue;
      const id = await queueEvent('auto_pos_due', 'pospaymentduereminder', await billTo(b.inv), {
        bill_no: b.inv.invoice_no, products: b.products.join(', '), total_amount: formatMoney(b.inv.total), outstanding_amount: formatMoney(b.inv.balance), purchase_date: formatDate(b.inv.invoice_date),
      }, `posdue:${inv.id}:${week}`);
      if (id) ids.push(id);
    }
  }
  const sent = await flushSafely(ids);
  return { created: ids.length, sent };
}

/** Everything that runs on a schedule: the daily reminders plus the day-based ones above. */
export async function runAllAutomations() {
  const base = await runAutomations();
  const more = await runEventReminders();
  return { created: base.created + more.created, sent: base.sent + more.sent };
}
