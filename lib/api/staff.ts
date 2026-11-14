import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { insert, one, q, tx, update } from '../db';
import { bad, notFound, parse, route } from './router';
import * as s from './schemas';
import { setBiometricId } from '../services/attendance';

const staffSchema = z.object({
  name: s.reqText, phone: s.phoneOpt, email: s.email, role_title: s.reqText, is_trainer: s.bool,
  specialization: s.text, certifications: s.text, experience_years: s.moneyOpt, joined_on: s.date,
  base_salary: s.money.default(0), paid_leaves: s.int.default(0), pt_commission_pct: z.coerce.number().min(0).max(100).default(0),
  bank_details: s.text, biometric_id: s.deviceId,
});

route('GET', '/staff', 'trainers', async ({ query }) => {
  const showInactive = query.get('inactive') === '1';
  return q(`
    SELECT st.*, be.device_user_id biometric_id, u.email login_email, u.active login_active,
      (SELECT count(*) FROM pt_subscriptions p WHERE p.trainer_id=st.id AND p.status='active') active_clients,
      (SELECT count(*) FROM pt_sessions x WHERE x.trainer_id=st.id AND x.status='completed' AND date_trunc('month', x.scheduled_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', gym_today()::timestamp)) sessions_month,
      (SELECT COALESCE(sum(p.price / p.total_sessions * p.commission_pct / 100),0) FROM pt_sessions x JOIN pt_subscriptions p ON p.id=x.subscription_id
        WHERE x.trainer_id=st.id AND x.status='completed' AND date_trunc('month', x.scheduled_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', gym_today()::timestamp)) commission_month,
      (SELECT count(*) FROM attendance a WHERE a.staff_id=st.id AND date_trunc('month', a.day::timestamp) = date_trunc('month', gym_today()::timestamp)) days_present_month,
      (SELECT COALESCE(sum(amount),0) FROM salary_advances sa WHERE sa.staff_id=st.id AND sa.recovered_item_id IS NULL) advance_pending
    FROM staff st
    LEFT JOIN biometric_enrollments be ON be.staff_id = st.id
    LEFT JOIN users u ON u.staff_id = st.id
    ${showInactive ? '' : 'WHERE st.active'}
    ORDER BY st.is_trainer DESC, st.name`);
});

route('POST', '/staff', 'trainers', async ({ body }) => {
  const { biometric_id, ...data } = parse(staffSchema, body);
  return tx(async (db) => {
    const st = await insert('staff', { ...data, joined_on: data.joined_on ?? undefined }, db);
    await setBiometricId(db, { member_id: null, staff_id: st.id }, biometric_id);
    return st;
  });
});

route('PUT', '/staff/:id', 'trainers', async ({ params, body }) => {
  const { biometric_id, ...data } = parse(staffSchema, body);
  return tx(async (db) => {
    const st = await update('staff', params.id, { ...data, joined_on: data.joined_on ?? undefined }, db);
    if (!st) throw notFound('Staff member not found');
    await setBiometricId(db, { member_id: null, staff_id: st.id }, biometric_id);
    return st;
  });
});

route('POST', '/staff/:id/active', 'trainers', async ({ params, body }) => {
  const active = body.active !== false;
  await tx(async (db) => {
    await update('staff', params.id, { active }, db);
    if (!active) await db.query('UPDATE users SET active=false WHERE staff_id=$1', [params.id]);
  });
});

route('POST', '/staff/:id/login', 'trainers', async ({ params, body }) => {
  const { email, password } = parse(z.object({ email: z.string().trim().toLowerCase().email('is not a valid email'), password: z.string().min(8, 'must be at least 8 characters') }), body);
  const st = await one<any>('SELECT * FROM staff WHERE id=$1 AND active', [params.id]);
  if (!st) throw notFound('Staff member not found');
  if (!st.is_trainer) throw bad('Only trainers can have a login for now');
  const hash = await bcrypt.hash(password, 10);
  // A trainer's login works only in the branch the trainer belongs to.
  await q(`INSERT INTO users (name, email, password_hash, role, staff_id, branch_id) VALUES ($1,$2,$3,'trainer',$4,$5)
           ON CONFLICT (staff_id) DO UPDATE SET email=EXCLUDED.email, password_hash=EXCLUDED.password_hash, branch_id=EXCLUDED.branch_id, active=true`, [st.name, email, hash, st.id, st.branch_id]);
});

route('DELETE', '/staff/:id/login', 'trainers', async ({ params }) => {
  await q('UPDATE users SET active=false WHERE staff_id=$1', [params.id]);
});

route('GET', '/advances', 'payroll', async () => q(`
  SELECT a.*, st.name staff_name FROM salary_advances a JOIN staff st ON st.id=a.staff_id ORDER BY a.given_on DESC, a.id DESC LIMIT 200`));

route('POST', '/advances', 'payroll', async ({ body }) => insert('salary_advances', parse(z.object({
  staff_id: s.id, amount: s.money.positive('must be more than 0'), given_on: s.date, note: s.text,
}).transform((v) => ({ ...v, given_on: v.given_on ?? undefined })), body)));

route('DELETE', '/advances/:id', 'payroll', async ({ params }) => {
  const r = await q('DELETE FROM salary_advances WHERE id=$1 AND recovered_item_id IS NULL RETURNING id', [params.id]);
  if (!r.length) throw bad('This advance has already been recovered from a salary');
});
