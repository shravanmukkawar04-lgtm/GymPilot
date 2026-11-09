import { z } from 'zod';
import { Db, insert, one, q, tx, update } from '../db';
import { ApiError, Ctx, bad, notFound, parse, route } from './router';
import * as s from './schemas';
import { createInvoice } from '../services/billing';

/** A trainer only ever sees their own clients; the owner sees everyone. */
const scope = (c: Ctx) => (c.user.role === 'trainer' ? c.user.staff_id ?? -1 : null);

const packageSchema = z.object({ name: s.reqText, sessions: z.coerce.number().int().min(1), validity_days: z.coerce.number().int().min(1), price: s.money, active: s.bool });

route('GET', '/pt/options', 'pt', async (c) => {
  const t = scope(c);
  const [trainers, packages, subscriptions] = await Promise.all([
    q(`SELECT id, name, pt_commission_pct FROM staff WHERE active AND is_trainer ORDER BY name`),
    q(`SELECT * FROM pt_packages WHERE active ORDER BY price`),
    q(`SELECT p.id, p.total_sessions, p.used_sessions, m.name member_name, st.name trainer_name,
         (SELECT count(*) FROM pt_sessions x WHERE x.subscription_id=p.id AND x.status='scheduled') booked
       FROM pt_subscriptions p JOIN members m ON m.id=p.member_id JOIN staff st ON st.id=p.trainer_id
       WHERE p.status='active' AND ($1::int IS NULL OR p.trainer_id=$1) ORDER BY m.name`, [t]),
  ]);
  return { trainers, packages, subscriptions };
});

route('GET', '/pt/packages', 'pt_manage', async () => q(`
  SELECT k.*, (SELECT count(*) FROM pt_subscriptions p WHERE p.package_id=k.id AND p.status='active') active_clients
  FROM pt_packages k ORDER BY k.active DESC, k.price`));
route('POST', '/pt/packages', 'pt_manage', async ({ body }) => insert('pt_packages', parse(packageSchema, body)));
route('PUT', '/pt/packages/:id', 'pt_manage', async ({ params, body }) => update('pt_packages', params.id, parse(packageSchema, body)));

route('GET', '/pt/subscriptions', 'pt', async (c) => q(`
  SELECT p.*, m.name member_name, m.phone member_phone, st.name trainer_name,
    (SELECT count(*) FROM pt_sessions x WHERE x.subscription_id=p.id AND x.status='scheduled') booked
  FROM pt_subscriptions p JOIN members m ON m.id=p.member_id JOIN staff st ON st.id=p.trainer_id
  WHERE p.status <> 'cancelled' AND ($1::int IS NULL OR p.trainer_id=$1)
  ORDER BY (p.status='active') DESC, p.end_date`, [scope(c)]));

route('POST', '/pt/subscriptions', 'pt_manage', async ({ body, user }) => {
  const v = parse(z.object({ member_id: s.id, trainer_id: s.id, package_id: s.id, start_date: s.date, discount: s.moneyOpt, payment: s.payment }), body);
  return tx(async (db) => {
    const member = await one<any>('SELECT * FROM members WHERE id=$1', [v.member_id], db);
    const pkg = await one<any>('SELECT * FROM pt_packages WHERE id=$1', [v.package_id], db);
    const trainer = await one<any>('SELECT * FROM staff WHERE id=$1 AND is_trainer AND active', [v.trainer_id], db);
    if (!member || !pkg || !trainer) throw notFound('Member, package or trainer not found');
    const sub = (await one<any>(
      `INSERT INTO pt_subscriptions (member_id, trainer_id, package_id, package_name, total_sessions, start_date, end_date, price, commission_pct)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::date,gym_today()),COALESCE($6::date,gym_today()) + $7::int - 1,$8,$9) RETURNING *`,
      [member.id, trainer.id, pkg.id, pkg.name, pkg.sessions, v.start_date ?? null, pkg.validity_days, pkg.price, trainer.pt_commission_pct], db))!;
    const invoice = await createInvoice(db, {
      member_id: member.id, customer_name: member.name, customer_phone: member.phone,
      items: [{ description: `Personal training: ${pkg.name} (${pkg.sessions} sessions with ${trainer.name})`, qty: 1, rate: pkg.price, type: 'pt', ref_id: sub.id }],
      discount: v.discount ?? 0, payment: v.payment, user_id: user.id,
    });
    await db.query('UPDATE pt_subscriptions SET invoice_id=$2 WHERE id=$1', [sub.id, invoice.id]);
    return { subscription: sub, invoice };
  });
});

route('GET', '/pt/sessions', 'pt', async (c) => {
  const day = c.query.get('date');
  return q(`
    SELECT x.*, m.name member_name, m.phone member_phone, st.name trainer_name, p.package_name, p.total_sessions, p.used_sessions
    FROM pt_sessions x JOIN pt_subscriptions p ON p.id=x.subscription_id JOIN members m ON m.id=p.member_id JOIN staff st ON st.id=x.trainer_id
    WHERE (x.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date = COALESCE($1::date, gym_today()) AND ($2::int IS NULL OR x.trainer_id=$2)
    ORDER BY x.scheduled_at`, [day, scope(c)]);
});

async function ownedSubscription(db: Db, id: number, trainer: number | null) {
  const sub = await one<any>('SELECT * FROM pt_subscriptions WHERE id=$1 FOR UPDATE', [id], db);
  if (!sub) throw notFound('Package not found');
  if (trainer !== null && sub.trainer_id !== trainer) throw new ApiError(403, 'This client is assigned to another trainer');
  return sub;
}

route('POST', '/pt/sessions', 'pt', async (c) => {
  const v = parse(z.object({
    subscription_id: s.id, scheduled_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'is not a valid date and time'),
    duration_min: z.coerce.number().int().min(10).max(240).default(60), notes: s.text,
  }), c.body);
  return tx(async (db) => {
    const sub = await ownedSubscription(db, v.subscription_id, scope(c));
    if (sub.status !== 'active') throw bad('This package is no longer active');
    const { booked } = (await one<{ booked: number }>(`SELECT count(*) booked FROM pt_sessions WHERE subscription_id=$1 AND status='scheduled'`, [sub.id], db))!;
    if (sub.used_sessions + booked >= sub.total_sessions) throw bad('All sessions in this package are already used or booked');
    return one(`INSERT INTO pt_sessions (subscription_id, trainer_id, scheduled_at, duration_min, notes) VALUES ($1,$2,$3::timestamp AT TIME ZONE 'Asia/Kolkata',$4,$5) RETURNING *`,
      [sub.id, sub.trainer_id, v.scheduled_at, v.duration_min, v.notes], db);
  });
});

route('POST', '/pt/sessions/:id/status', 'pt', async (c) => {
  const v = parse(z.object({ status: z.enum(['scheduled', 'completed', 'no_show', 'cancelled']), notes: s.text }), c.body);
  return tx(async (db) => {
    const found = await one<any>('SELECT subscription_id FROM pt_sessions WHERE id=$1', [c.params.id], db);
    if (!found) throw notFound('Session not found');
    const sub = await ownedSubscription(db, found.subscription_id, scope(c));
    await db.query(`UPDATE pt_sessions SET status=$2, notes=COALESCE($3,notes), completed_at=CASE WHEN $2='completed' THEN now() END WHERE id=$1`, [c.params.id, v.status, v.notes ?? null]);
    const { used } = (await one<{ used: number }>(`SELECT count(*) used FROM pt_sessions WHERE subscription_id=$1 AND status IN ('completed','no_show')`, [sub.id], db))!;
    if (used > sub.total_sessions) throw bad('All sessions in this package are already used');
    await db.query(`UPDATE pt_subscriptions SET used_sessions=$2, status=CASE WHEN status='cancelled' THEN status WHEN $2>=total_sessions THEN 'completed' ELSE 'active' END WHERE id=$1`, [sub.id, used]);
  });
});
