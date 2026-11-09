import { z } from 'zod';
import { insert, one, q, tx, update } from '../db';
import { bad, notFound, parse, route } from './router';
import * as s from './schemas';
import { sellMembership } from '../services/billing';
import { setBiometricId } from '../services/attendance';

const memberSchema = z.object({
  name: s.reqText, phone: s.phone, email: s.email, gender: s.text, dob: s.date, address: s.text,
  emergency_name: s.text, emergency_phone: s.phoneOpt, health_notes: s.text, goal: s.text, notes: s.text, joined_on: s.date,
  biometric_id: s.deviceId, whatsapp_opt_out: s.bool,
});
const saleSchema = z.object({
  plan_id: s.id, start_date: s.date, discount: s.moneyOpt, replace_current: s.bool, payment: s.payment,
});
const planSchema = z.object({
  name: s.reqText, duration_months: s.int, duration_days: s.int.default(0), price: s.money, description: s.text, active: s.bool,
});

const FILTERS: Record<string, string> = {
  active: `status='active'`, expired: `status='expired'`, frozen: `status='frozen'`, none: `status='none'`,
  expiring: `valid_until BETWEEN gym_today() AND gym_today()+7`,
  dues: `dues > 0`,
  inactive: `status='active' AND COALESCE(last_visit, joined_on) < gym_today() - (SELECT inactive_days FROM settings WHERE id=1)`,
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
  const page = Math.max(1, Number(query.get('page')) || 1);
  const limit = Math.min(200, Number(query.get('limit')) || 50);
  const clause = where.join(' AND ');
  const rows = await q(`SELECT * FROM member_overview WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params);
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

route('POST', '/members', 'members', async ({ body, user }) => {
  const { biometric_id, ...data } = parse(memberSchema, body);
  const sale = body.sale ? parse(saleSchema, body.sale) : null;
  return tx(async (db) => {
    const m = await insert('members', { ...data, joined_on: data.joined_on ?? undefined }, db);
    await setBiometricId(db, { member_id: m.id, staff_id: null }, biometric_id);
    const result = sale ? await sellMembership(db, { member_id: m.id, ...sale, user_id: user.id }) : null;
    return { member: m, invoice: result?.invoice ?? null };
  });
});

route('GET', '/members/:id', 'members', async ({ params }) => {
  const id = Number(params.id);
  const member = await one('SELECT * FROM member_overview WHERE id=$1', [id]);
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
  const { biometric_id, ...data } = parse(memberSchema, body);
  return tx(async (db) => {
    const m = await update('members', params.id, { ...data, joined_on: data.joined_on ?? undefined }, db);
    if (!m) throw notFound('Member not found');
    await setBiometricId(db, { member_id: m.id, staff_id: null }, biometric_id);
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

route('GET', '/plans', 'members', async () => q(`SELECT p.*, (SELECT count(*) FROM memberships m WHERE m.plan_id=p.id AND m.status='active' AND m.end_date>=gym_today()) AS active_members FROM plans p ORDER BY p.active DESC, p.price`));
route('POST', '/plans', 'members', async ({ body }) => insert('plans', parse(planSchema, body)));
route('PUT', '/plans/:id', 'members', async ({ params, body }) => update('plans', params.id, parse(planSchema, body)));

route('GET', '/search', 'members', async ({ query }) => {
  const term = `%${query.get('q')?.trim() ?? ''}%`;
  if (term === '%%') return { members: [], leads: [] };
  const [members, leads] = await Promise.all([
    q(`SELECT id, name, phone, member_code, status FROM member_overview WHERE NOT archived AND (name ILIKE $1 OR phone ILIKE $1 OR member_code ILIKE $1) ORDER BY name LIMIT 6`, [term]),
    q(`SELECT id, name, phone, status FROM leads WHERE status NOT IN ('won') AND (name ILIKE $1 OR phone ILIKE $1) ORDER BY name LIMIT 4`, [term]),
  ]);
  return { members, leads };
});
