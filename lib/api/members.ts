import { z } from 'zod';
import { Db, insert, one, q, tenant, tx, update, widenToGym } from '../db';
import { ApiError, bad, notFound, parse, route } from './router';
import * as s from './schemas';
import { addPreviousDue, checkPastDate, createInvoice, getSettings, pickSlot, sellMembership, slotLabel } from '../services/billing';
import { setBiometricId } from '../services/attendance';
import { sendRegistration } from '../services/messaging';
import { savePhoto } from '../services/photos';

const memberSchema = z.object({
  name: s.reqText, phone: s.phone, email: s.email, gender: s.text, dob: s.date, address: s.text, occupation: s.text,
  emergency_name: s.text, emergency_phone: s.phoneOpt, health_notes: s.text, goal: s.text, notes: s.text, joined_on: s.date,
  biometric_id: s.deviceId, whatsapp_opt_out: s.bool, photo: s.photo,
});
const saleSchema = z.object({
  plan_id: s.id, slot_id: s.idOpt, start_date: s.date, discount: s.moneyOpt, replace_current: s.bool, payment: s.payment,
  /** What the member already owed before this sale. Added as its own bill. */
  previous_due: s.moneyOpt,
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
  // Calendar week starts on Monday.
  new_week: `joined_on >= date_trunc('week', gym_today()::timestamp)::date`,
  new_month: `joined_on >= date_trunc('month', gym_today()::timestamp)::date`,
  blocked: `blocked`,
  left: `left_on IS NOT NULL`,
};
const GENDERS: Record<string, string> = { male: `lower(gender) = 'male'`, female: `lower(gender) = 'female'` };

route('GET', '/members', 'members', async ({ query }) => {
  const params: unknown[] = [];
  const where = ['NOT archived'];
  const status = query.get('status') || '';
  const filter = FILTERS[status];
  if (filter) where.push(filter);
  // Members who have left only show under the "Left" filter, so they do not crowd the everyday list.
  if (status !== 'left') where.push('left_on IS NULL');
  const gender = GENDERS[query.get('gender') || ''];
  if (gender) where.push(gender);
  const term = query.get('q')?.trim();
  if (term) {
    params.push(`%${term}%`);
    where.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR member_code ILIKE $${params.length})`);
  }
  // The batch and plan also narrow the counts below, so the chips show the numbers for what is on screen.
  const scope = ['NOT archived'];
  const scopeParams: unknown[] = [];
  const slot = Number(query.get('slot_id'));
  if (slot) { params.push(slot); where.push(`slot_id = $${params.length}`); scopeParams.push(slot); scope.push(`slot_id = $${scopeParams.length}`); }
  // Members whose current membership is on this plan.
  const plan = Number(query.get('plan_id'));
  if (plan) { params.push(plan); where.push(`membership_id IN (SELECT id FROM memberships WHERE plan_id = $${params.length})`); scopeParams.push(plan); scope.push(`membership_id IN (SELECT id FROM memberships WHERE plan_id = $${scopeParams.length})`); }
  const page = Math.max(1, Number(query.get('page')) || 1);
  const limit = Math.min(200, Number(query.get('limit')) || 50);
  const clause = where.join(' AND ');
  const rows = await q(`SELECT * FROM (SELECT o.*, b.name branch_name FROM member_overview o JOIN branches b ON b.id=o.branch_id) x WHERE ${clause}
    ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params);
  const total = (await one<{ c: number }>(`SELECT count(*) c FROM member_overview WHERE ${clause}`, params))!.c;
  // Counts for the filter chips and the boys / girls / new / left tiles. Boys and girls are current members (not left).
  const counts = (await one(`SELECT count(*) FILTER (WHERE left_on IS NULL) AS "all",
      count(*) FILTER (WHERE status='active') AS active,
      count(*) FILTER (WHERE left_on IS NULL AND valid_until BETWEEN gym_today() AND gym_today()+7) AS expiring,
      count(*) FILTER (WHERE status='expired') AS expired,
      count(*) FILTER (WHERE status='frozen') AS frozen,
      count(*) FILTER (WHERE left_on IS NULL AND dues > 0) AS dues,
      count(*) FILTER (WHERE left_on IS NULL AND lower(gender) = 'male') AS male,
      count(*) FILTER (WHERE left_on IS NULL AND lower(gender) = 'female') AS female,
      count(*) FILTER (WHERE left_on IS NULL AND joined_on >= date_trunc('week', gym_today()::timestamp)::date) AS new_week,
      count(*) FILTER (WHERE left_on IS NULL AND joined_on >= date_trunc('month', gym_today()::timestamp)::date) AS new_month,
      count(*) FILTER (WHERE left_on IS NULL AND blocked) AS blocked,
      count(*) FILTER (WHERE left_on IS NOT NULL) AS "left"
    FROM member_overview WHERE ${scope.join(' AND ')}`, scopeParams))!;
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
  const previousDue = existing ? null : parse(z.object({ previous_due: s.moneyOpt }), body).previous_due;
  const result = await tx(async (db) => {
    const m = await insert('members', {
      ...data, joined_on: old?.joined_on ?? data.joined_on ?? undefined, member_code: old?.member_code || undefined, migrated: existing,
    }, db);
    await setBiometricId(db, { member_id: m.id, staff_id: null }, biometric_id);
    await savePhoto(db, 'member', m.id, photo || undefined);
    if (old) await addExistingMembership(db, m, old, user.id);
    const r = sale ? await sellMembership(db, { member_id: m.id, ...sale, user_id: user.id }) : null;
    // A new member can also arrive owing money from before, with or without a plan.
    if (!existing && !sale?.previous_due) await addPreviousDue(db, { member_id: m.id, name: m.name, phone: m.phone }, previousDue, user.id, m.branch_id);
    return { member: m, invoice: r?.invoice ?? null };
  });
  // The member is saved even if the message cannot go out.
  // The Member registration message goes to every new member while it is switched on in Settings.
  // Members moved over from an old system are not messaged.
  const wantRegistration = !existing && !!(await getSettings()).auto_welcome;
  const welcome = wantRegistration ? await tx(() => sendRegistration(result.member.id)).catch((e) => ({ status: 'failed' as const, error: String(e?.message ?? e) })) : null;
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

/** Blocks a member from entering (their scans and front-desk check-ins are flagged), or lifts the block. */
route('POST', '/members/:id/block', 'members', async ({ params, body }) => {
  const v = parse(z.object({ blocked: z.boolean(), reason: s.text }), body);
  if (v.blocked && !v.reason) throw bad('Please write a reason for blocking');
  const m = await one<any>(
    `UPDATE members SET blocked=$2, blocked_reason=CASE WHEN $2 THEN $3 ELSE NULL END, blocked_on=CASE WHEN $2 THEN gym_today() ELSE NULL END
     WHERE id=$1 AND NOT archived RETURNING *`, [params.id, v.blocked, v.reason ?? null]);
  if (!m) throw notFound('Member not found');
  return m;
});

/** A member who has stopped coming. They leave the everyday list but their history is kept, and they can rejoin. */
route('POST', '/members/:id/left', 'members', async ({ params, body }) => {
  const v = parse(z.object({ left: z.boolean(), left_on: s.date, reason: s.text }), body);
  if (v.left) await tx((db) => checkPastDate(db, v.left_on, 'The date they left'));
  const m = await one<any>(
    `UPDATE members SET left_on=CASE WHEN $2 THEN COALESCE($3::date, gym_today()) ELSE NULL END, left_reason=CASE WHEN $2 THEN $4 ELSE NULL END
     WHERE id=$1 AND NOT archived RETURNING *`, [params.id, v.left, v.left_on ?? null, v.reason ?? null]);
  if (!m) throw notFound('Member not found');
  return m;
});

/**
 * Moves a member to another branch (owner only). Their memberships move with them, without the old branch's plan and time slot,
 * so they pick the new branch's own when they renew. Old bills, payments and visits stay in the branch where they happened,
 * which keeps each branch's income and attendance reports correct. Money still owed must be cleared first, so the old branch
 * is not left chasing a member it can no longer see. The fingerprint number belongs to the old branch's machine, so it is removed.
 */
route('POST', '/members/:id/transfer', 'members', async ({ params, body, user }) => {
  if (user.role !== 'owner') throw new ApiError(403, 'Only the owner can move a member to another branch');
  const v = parse(z.object({ branch_id: s.id }), body);
  await widenToGym();
  return tx(async (db) => {
    const m = await one<any>('SELECT * FROM members WHERE id=$1 AND NOT archived FOR UPDATE', [params.id], db);
    if (!m) throw notFound('Member not found');
    if (m.branch_id === v.branch_id) throw bad('The member is already in this branch');
    const dest = await one<any>('SELECT id, name FROM branches WHERE id=$1 AND active', [v.branch_id], db);
    if (!dest) throw notFound('Branch not found');
    const dues = (await one<{ d: number }>(`SELECT COALESCE(sum(balance),0) d FROM invoices WHERE member_id=$1 AND status IN ('unpaid','partial')`, [m.id], db))!.d;
    if (dues > 0) throw bad(`${m.name} still owes ₹${dues}. Collect it before moving them to another branch.`);
    const pt = (await one<{ n: number }>(`SELECT count(*) n FROM pt_subscriptions WHERE member_id=$1 AND status='active'`, [m.id], db))!.n;
    if (pt > 0) throw bad(`${m.name} has personal training running with a trainer of this branch. Finish or cancel it first.`);
    const phoneTaken = await one<any>(`SELECT name FROM members WHERE branch_id=$1 AND id<>$2 AND NOT archived AND right(regexp_replace(phone,'\\D','','g'),10) = right(regexp_replace($3,'\\D','','g'),10)`, [dest.id, m.id, m.phone], db);
    if (phoneTaken) throw bad(`${dest.name} already has a member with this phone number (${phoneTaken.name})`);
    await db.query('UPDATE members SET branch_id=$2 WHERE id=$1', [m.id, dest.id]);
    await db.query('UPDATE memberships SET branch_id=$2, plan_id=NULL, slot_id=NULL, slot_name=NULL WHERE member_id=$1', [m.id, dest.id]);
    await db.query('UPDATE membership_freezes SET branch_id=$2 WHERE membership_id IN (SELECT id FROM memberships WHERE member_id=$1)', [m.id, dest.id]);
    await db.query('DELETE FROM biometric_enrollments WHERE member_id=$1', [m.id]);
    return { id: m.id, branch_id: dest.id, branch_name: dest.name };
  });
});

/**
 * Puts a membership on hold between two dates (both days count). The number of days is worked out from the dates
 * and added to the end of the plan, so the member loses nothing. `days` instead of `end_date` still works for older callers.
 */
route('POST', '/memberships/:id/freeze', 'members', async ({ params, body }) => {
  const v = parse(z.object({
    start_date: s.reqDate, end_date: s.date, days: z.coerce.number().int().min(1).max(365).nullish(), reason: s.text,
  }), body);
  if (!v.end_date && !v.days) throw bad('Choose the date the hold ends');
  return tx(async (db) => {
    const ms = await one<any>(`SELECT * FROM memberships WHERE id=$1 AND status='active' FOR UPDATE`, [params.id], db);
    if (!ms) throw notFound('Membership not found');
    const { end_date, days } = (await one<{ end_date: string; days: number }>(
      `SELECT COALESCE($2::date, $1::date + $3::int - 1) AS end_date, COALESCE($2::date - $1::date + 1, $3::int) AS days`, [v.start_date, v.end_date ?? null, v.days ?? null], db))!;
    if (days < 1) throw bad('The hold cannot end before it starts');
    if (days > 365) throw bad('A hold can be at most 365 days');
    if (v.start_date < ms.start_date) throw bad('The hold cannot start before the plan starts');
    if (v.start_date > ms.end_date) throw bad('The hold must start before the plan ends');
    const overlap = await one(`SELECT 1 FROM membership_freezes WHERE membership_id=$1 AND start_date <= $3::date AND end_date >= $2::date`, [ms.id, v.start_date, end_date], db);
    if (overlap) throw bad('This membership already has a hold in those dates');
    await db.query(`INSERT INTO membership_freezes (membership_id, start_date, end_date, reason) VALUES ($1,$2::date,$3::date,$4)`, [ms.id, v.start_date, end_date, v.reason]);
    const updated = await one<any>(`UPDATE memberships SET end_date = end_date + $2::int WHERE id=$1 RETURNING *`, [ms.id, days], db);
    return { ...updated, frozen_days: days };
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

/**
 * Deletes a plan nobody is on any more. Members keep their history: each membership stores the plan's name,
 * so only the link to the plan is removed. A plan with running memberships is refused, because the members would be left
 * on a plan that no longer exists; hide it instead ("Available for sale" off) and delete it once they have finished.
 */
route('DELETE', '/plans/:id', 'members', async ({ params }) => {
  const plan = await one<any>('SELECT id, name FROM plans WHERE id=$1', [params.id]);
  if (!plan) throw notFound('Plan not found');
  const { n } = (await one<{ n: number }>(
    `SELECT count(*) n FROM memberships WHERE plan_id=$1 AND status='active' AND end_date >= gym_today()`, [plan.id]))!;
  if (n > 0) throw new ApiError(409, `${n} member${n > 1 ? 's are' : ' is'} still on ${plan.name}. Turn off "Available for sale" to stop selling it, and delete it once they have finished.`);
  await q('DELETE FROM plans WHERE id=$1', [plan.id]);
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
