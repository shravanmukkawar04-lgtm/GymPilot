import { z } from 'zod';
import { Db, insert, one, q, tenant, tx, update } from '../db';
import { bad, notFound, parse, route } from './router';
import * as s from './schemas';
import { createInvoice, getSettings, pickSlot, sellMembership, slotLabel } from '../services/billing';
import { setBiometricId } from '../services/attendance';
import { sendWelcome } from '../services/messaging';
import { savePhoto } from '../services/photos';

const memberSchema = z.object({
  name: s.reqText, phone: s.phone, email: s.email, gender: s.text, dob: s.date, address: s.text, occupation: s.text,
  emergency_name: s.text, emergency_phone: s.phoneOpt, health_notes: s.text, goal: s.text, notes: s.text, joined_on: s.date,
  biometric_id: s.deviceId, whatsapp_opt_out: s.bool, photo: s.photo,
});
const saleSchema = z.object({
  plan_id: s.id, slot_id: s.idOpt, start_date: s.date, discount: s.moneyOpt, replace_current: s.bool, payment: s.payment,
});
const planSchema = z.object({
  name: s.reqText, duration_months: s.int, duration_days: s.int.default(0), price: s.money, description: s.text, active: s.bool,
  slot_ids: z.array(s.id).max(50).default([]),
});
const slotSchema = z.object({
  name: s.reqText,
  start_time: z.string().regex(/^\d{2}:\d{2}/, 'is not a valid time'), end_time: z.string().regex(/^\d{2}:\d{2}/, 'is not a valid time'),
  active: s.bool,
}).refine((v) => v.end_time > v.start_time, { message: 'must be after the start time', path: ['end_time'] });

/** A member moved over from an old system: their own dates, and only what they still owe. */
const existingSchema = z.object({
  member_code: s.text, joined_on: s.looseDate,
  plan_id: s.idOpt, plan_name: s.text, slot_id: s.idOpt, slot_name: s.text,
  start_date: s.looseDate, end_date: s.looseDate, balance_due: s.moneyOpt,
});

const needBranch = () => {
  if (!tenant()?.branchId) throw bad('Choose a branch at the top of the screen first. New members are added to one branch.');
};

const FILTERS: Record<string, string> = {
  active: `status='active'`, expired: `status='expired'`, frozen: `status='frozen'`, none: `status='none'`,
  expiring: `valid_until BETWEEN gym_today() AND gym_today()+7`,
  dues: `dues > 0`,
  inactive: `status='active' AND COALESCE(last_visit, joined_on) < gym_today() - (SELECT inactive_days FROM settings)`,
};

route('GET', '/members', 'members', async ({ query }) => {
  const params: unknown[] = [];
  const where = ['NOT archived'];
  const filter = FILTERS[query.get('status') || ''];
  if (filter) where.push(filter);
  const term = query.get('q')?.trim();
  if (term) {
    params.push(`%${term}%`);
    where.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR member_code ILIKE $${params.length})`);
  }
  const slot = Number(query.get('slot_id'));
  if (slot) { params.push(slot); where.push(`slot_id = $${params.length}`); }
  const page = Math.max(1, Number(query.get('page')) || 1);
  const limit = Math.min(200, Number(query.get('limit')) || 50);
  const clause = where.join(' AND ');
  const rows = await q(`SELECT * FROM (SELECT o.*, b.name branch_name FROM member_overview o JOIN branches b ON b.id=o.branch_id) x WHERE ${clause}
    ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params);
  const total = (await one<{ c: number }>(`SELECT count(*) c FROM member_overview WHERE ${clause}`, params))!.c;
  const counts = (await one(`SELECT count(*) FILTER (WHERE TRUE) AS "all",
      count(*) FILTER (WHERE status='active') AS active,
      count(*) FILTER (WHERE valid_until BETWEEN gym_today() AND gym_today()+7) AS expiring,
      count(*) FILTER (WHERE status='expired') AS expired,
      count(*) FILTER (WHERE status='frozen') AS frozen,
      count(*) FILTER (WHERE dues > 0) AS dues
    FROM member_overview WHERE NOT archived`))!;
  return { rows, total, page, limit, counts };
});

/** Adds the membership a migrated member already has, and a bill for any amount still owed. No new income is recorded. */
async function addExistingMembership(db: Db, member: any, v: z.output<typeof existingSchema>, userId: number | null) {
  const planName = v.plan_name?.trim();
  if (v.plan_id || planName) {
    const plan = v.plan_id
      ? await one<any>('SELECT * FROM plans WHERE id=$1 AND branch_id=$2', [v.plan_id, member.branch_id], db)
      : await one<any>('SELECT * FROM plans WHERE lower(name)=lower($1) AND branch_id=$2 ORDER BY active DESC LIMIT 1', [planName, member.branch_id], db);
    if (v.plan_id && !plan) throw notFound('Plan not found in this branch');
    const start = v.start_date ?? member.joined_on;
    let end = v.end_date;
    if (!end) {
      if (!plan) throw bad(`Plan "${planName}" is not set up in this branch, so the plan end date is needed`);
      end = (await one<{ d: string }>(`SELECT ($1::date + make_interval(months => $2::int, days => $3::int) - interval '1 day')::date d`,
        [start, plan.duration_months, plan.duration_days], db))!.d;
    }
    if (end < start) throw bad('The plan end date is before its start date');
    let slot: any = null;
    if (v.slot_id) slot = await pickSlot(db, plan, v.slot_id, member.branch_id);
    else if (v.slot_name?.trim()) slot = await one<any>('SELECT * FROM slots WHERE lower(name)=lower($1) AND branch_id=$2 LIMIT 1', [v.slot_name.trim(), member.branch_id], db);
    await db.query(
      `INSERT INTO memberships (member_id, plan_id, plan_name, start_date, end_date, price, slot_id, slot_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [member.id, plan?.id ?? null, plan?.name ?? planName, start, end, plan?.price ?? 0, slot?.id ?? null, slot ? slotLabel(slot) : v.slot_name?.trim() || null]);
  }
  if (v.balance_due && v.balance_due > 0) {
    await createInvoice(db, {
      member_id: member.id, customer_name: member.name, customer_phone: member.phone, user_id: userId,
      items: [{ description: 'Balance carried over from the previous system', qty: 1, rate: v.balance_due, type: 'other', gst_rate: 0 }],
      notes: 'Opening balance when this member was moved to GymPilot',
    });
  }
}

route('POST', '/members', 'members', async ({ body, user }) => {
  needBranch();
  const { biometric_id, photo, ...data } = parse(memberSchema, body);
  const existing = body.kind === 'existing';
  const sale = !existing && body.sale ? parse(saleSchema, body.sale) : null;
  const old = existing ? parse(existingSchema, body.existing ?? {}) : null;
  const result = await tx(async (db) => {
    const m = await insert('members', {
      ...data, joined_on: old?.joined_on ?? data.joined_on ?? undefined, member_code: old?.member_code || undefined, migrated: existing,
    }, db);
    await setBiometricId(db, { member_id: m.id, staff_id: null }, biometric_id);
    await savePhoto(db, 'member', m.id, photo || undefined);
    if (old) await addExistingMembership(db, m, old, user.id);
    const r = sale ? await sellMembership(db, { member_id: m.id, ...sale, user_id: user.id }) : null;
    return { member: m, invoice: r?.invoice ?? null };
  });
  // The member is saved even if the message cannot go out.
  const wantWelcome = body.send_welcome ?? (!existing && (await getSettings()).auto_welcome);
  const welcome = wantWelcome ? await tx(() => sendWelcome(result.member.id)).catch((e) => ({ status: 'failed' as const, error: String(e?.message ?? e) })) : null;
  return { ...result, welcome };
});

/**
 * Bulk import from a spreadsheet saved as CSV. The browser sends rows in small batches.
 * A row whose phone number is already in this branch is skipped, so a batch can safely be sent again.
 */
const importRow = z.object({
  name: s.reqText, phone: z.string().trim().transform((p) => p.replace(/[^\d+]/g, '')).pipe(s.phone),
  member_code: s.text, email: z.string().trim().nullish().transform((e) => e || null).pipe(s.email), gender: s.text, dob: s.looseDate, occupation: s.text,
  address: s.text, goal: s.text, notes: s.text, emergency_name: s.text, emergency_phone: s.text,
  joined_on: s.looseDate, plan: s.text, slot: s.text, start_date: s.looseDate, end_date: s.looseDate,
  balance_due: z.union([z.number(), z.string()]).nullish().transform((v) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(/[₹,\s]/g, '')))),
});

route('POST', '/members/import', 'members', async ({ body, user }) => {
  needBranch();
  const rows: unknown[] = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
  const results: { row: number; status: 'added' | 'skipped' | 'error'; message?: string; member_id?: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowNo = Number((rows[i] as any)?.__row) || i + 1;
    try {
      const v = parse(importRow, rows[i]);
      if (v.balance_due !== null && (Number.isNaN(v.balance_due) || v.balance_due < 0)) throw bad('balance due is not a valid amount');
      const dup = await one<any>(`SELECT id, name FROM members WHERE right(regexp_replace(phone,'\\D','','g'),10) = right(regexp_replace($1,'\\D','','g'),10) AND branch_id=$2`,
        [v.phone, tenant()!.branchId]);
      if (dup) { results.push({ row: rowNo, status: 'skipped', message: `Already here as ${dup.name}`, member_id: dup.id }); continue; }
      const m = await tx(async (db) => {
        const member = await insert('members', {
          name: v.name, phone: v.phone, member_code: v.member_code || undefined, email: v.email, gender: v.gender, dob: v.dob, occupation: v.occupation,
          address: v.address, goal: v.goal, notes: v.notes, emergency_name: v.emergency_name, emergency_phone: v.emergency_phone,
          joined_on: v.joined_on ?? v.start_date ?? undefined, migrated: true,
        }, db);
        await addExistingMembership(db, member, {
          member_code: null, joined_on: null, plan_id: null, plan_name: v.plan, slot_id: null, slot_name: v.slot,
          start_date: v.start_date, end_date: v.end_date, balance_due: v.balance_due,
        }, user.id);
        return member;
      });
      results.push({ row: rowNo, status: 'added', member_id: m.id });
    } catch (e: any) {
      const msg = e?.issues?.[0] ? `${String(e.issues[0].path.at(-1) ?? '').replace(/_/g, ' ')} ${e.issues[0].message}`.trim()
        : e?.code === '23505' ? 'member ID is already used by someone else' : e?.message ?? 'could not be added';
      results.push({ row: rowNo, status: 'error', message: msg });
    }
  }
  return {
    added: results.filter((r) => r.status === 'added').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errors: results.filter((r) => r.status === 'error'),
  };
});

route('GET', '/members/:id', 'members', async ({ params }) => {
  const id = Number(params.id);
  const member = await one('SELECT o.*, b.name branch_name FROM member_overview o JOIN branches b ON b.id=o.branch_id WHERE o.id=$1', [id]);
  if (!member) throw notFound('Member not found');
  const [memberships, invoices, payments, attendance, pt] = await Promise.all([
    q(`SELECT ms.*, f.freeze_start, f.freeze_end FROM memberships ms
       LEFT JOIN LATERAL (SELECT start_date freeze_start, end_date freeze_end FROM membership_freezes WHERE membership_id=ms.id ORDER BY end_date DESC LIMIT 1) f ON true
       WHERE ms.member_id=$1 ORDER BY ms.start_date DESC, ms.id DESC`, [id]),
    q(`SELECT * FROM invoices WHERE member_id=$1 ORDER BY id DESC LIMIT 100`, [id]),
    q(`SELECT p.*, i.invoice_no FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.member_id=$1 AND NOT p.voided ORDER BY p.paid_on DESC, p.id DESC LIMIT 100`, [id]),
    q(`SELECT * FROM attendance WHERE member_id=$1 ORDER BY day DESC LIMIT 60`, [id]),
    q(`SELECT p.*, st.name trainer_name FROM pt_subscriptions p JOIN staff st ON st.id=p.trainer_id WHERE p.member_id=$1 ORDER BY p.id DESC`, [id]),
  ]);
  return { member, memberships, invoices, payments, attendance, pt };
});

route('PUT', '/members/:id', 'members', async ({ params, body }) => {
  const { biometric_id, photo, ...data } = parse(memberSchema, body);
  return tx(async (db) => {
    const m = await update('members', params.id, { ...data, joined_on: data.joined_on ?? undefined }, db);
    if (!m) throw notFound('Member not found');
    await setBiometricId(db, { member_id: m.id, staff_id: null }, biometric_id);
    await savePhoto(db, 'member', m.id, photo);
    return m;
  });
});

route('POST', '/members/:id/archive', 'members', async ({ params, body }) => {
  await update('members', params.id, { archived: body.archived !== false });
});

route('POST', '/members/:id/membership', 'members', async ({ params, body, user }) => {
  const sale = parse(saleSchema, body);
  return tx((db) => sellMembership(db, { member_id: Number(params.id), ...sale, user_id: user.id }));
});

route('POST', '/memberships/:id/freeze', 'members', async ({ params, body }) => {
  const { start_date, days, reason } = parse(z.object({ start_date: s.reqDate, days: z.coerce.number().int().min(1).max(365), reason: s.text }), body);
  return tx(async (db) => {
    const ms = await one<any>(`SELECT * FROM memberships WHERE id=$1 AND status='active' FOR UPDATE`, [params.id], db);
    if (!ms) throw notFound('Membership not found');
    if (start_date > ms.end_date) throw bad('The freeze must start before the membership ends');
    const overlap = await one(`SELECT 1 FROM membership_freezes WHERE membership_id=$1 AND end_date >= $2`, [ms.id, start_date], db);
    if (overlap) throw bad('This membership already has a freeze in that period');
    await db.query(`INSERT INTO membership_freezes (membership_id, start_date, end_date, reason) VALUES ($1,$2::date,$2::date + $3::int - 1,$4)`, [ms.id, start_date, days, reason]);
    // Frozen days are added back so the member loses nothing.
    return one(`UPDATE memberships SET end_date = end_date + $2::int WHERE id=$1 RETURNING *`, [ms.id, days], db);
  });
});

/* ---------- Plans and time slots ---------- */

/** ?member_id= limits the list to that member's branch, for renewing while looking at all branches. */
route('GET', '/plans', 'members', async ({ query }) => {
  const member = Number(query.get('member_id')) || null;
  return q(`SELECT p.*, b.name branch_name,
      (SELECT count(*) FROM memberships m WHERE m.plan_id=p.id AND m.status='active' AND m.end_date>=gym_today()) AS active_members
    FROM plans p JOIN branches b ON b.id=p.branch_id
    WHERE ($1::int IS NULL OR p.branch_id=(SELECT branch_id FROM members WHERE id=$1))
    ORDER BY p.active DESC, p.price`, [member]);
});

async function checkSlots(slotIds: number[], branchId: number | null) {
  if (!slotIds.length) return;
  const found = await q<{ id: number }>('SELECT id FROM slots WHERE id = ANY($1) AND ($2::int IS NULL OR branch_id=$2)', [slotIds, branchId]);
  if (found.length !== new Set(slotIds).size) throw bad('One of the chosen time slots is not in this branch');
}

route('POST', '/plans', 'members', async ({ body }) => {
  needBranch();
  const v = parse(planSchema, body);
  await checkSlots(v.slot_ids, tenant()!.branchId);
  return insert('plans', v);
});
route('PUT', '/plans/:id', 'members', async ({ params, body }) => {
  const v = parse(planSchema, body);
  const plan = await one<any>('SELECT branch_id FROM plans WHERE id=$1', [params.id]);
  if (!plan) throw notFound('Plan not found');
  await checkSlots(v.slot_ids, plan.branch_id);
  return update('plans', params.id, v);
});

route('GET', '/slots', 'any', async ({ query }) => {
  const member = Number(query.get('member_id')) || null;
  return q(`SELECT sl.*, b.name branch_name,
      (SELECT count(*) FROM member_overview o WHERE o.slot_id=sl.id AND o.status='active' AND NOT o.archived) AS active_members
    FROM slots sl JOIN branches b ON b.id=sl.branch_id
    WHERE ($1::int IS NULL OR sl.branch_id=(SELECT branch_id FROM members WHERE id=$1))
    ORDER BY sl.active DESC, sl.start_time`, [member]);
});
route('POST', '/slots', 'members', async ({ body }) => {
  needBranch();
  return insert('slots', parse(slotSchema, body));
});
route('PUT', '/slots/:id', 'members', async ({ params, body }) => update('slots', params.id, parse(slotSchema, body)));

route('GET', '/search', 'members', async ({ query }) => {
  const term = `%${query.get('q')?.trim() ?? ''}%`;
  if (term === '%%') return { members: [], leads: [] };
  const [members, leads] = await Promise.all([
    q(`SELECT id, name, phone, member_code, status, photo_v FROM member_overview WHERE NOT archived AND (name ILIKE $1 OR phone ILIKE $1 OR member_code ILIKE $1) ORDER BY name LIMIT 6`, [term]),
    q(`SELECT id, name, phone, status FROM leads WHERE status NOT IN ('won') AND (name ILIKE $1 OR phone ILIKE $1) ORDER BY name LIMIT 4`, [term]),
  ]);
  return { members, leads };
});
