import { z } from 'zod';
import { Db, one, q, tenant, tx } from '../db';
import { bad, notFound, parse, route } from './router';
import * as s from './schemas';
import { getSettings } from '../services/billing';

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthParam = z.string().regex(/^\d{4}-\d{2}$/, 'is not a valid month');

function workingDays(month: string, weeklyOff: number | null, from?: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= last; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    if (from && iso < from) continue;
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== weeklyOff) count++;
  }
  return count;
}

function compute(i: { base_salary: number; working_days: number; present_days: number; paid_leaves: number; commission: number; bonus: number; advance_deduction: number; other_deduction: number }) {
  const absent = Math.max(0, i.working_days - i.present_days - i.paid_leaves);
  const perDay = i.working_days ? i.base_salary / i.working_days : 0;
  const deduction = round2(Math.min(i.base_salary, absent * perDay));
  return { absent_days: absent, absence_deduction: deduction, net_pay: round2(i.base_salary - deduction + i.commission + i.bonus - i.advance_deduction - i.other_deduction) };
}

async function generate(db: Db, month: string) {
  const settings = await getSettings(db);
  const first = `${month}-01`;
  const run = (await one<any>(`INSERT INTO payroll_runs (month) VALUES ($1) ON CONFLICT (branch_id, month) DO UPDATE SET month=EXCLUDED.month RETURNING *`, [first], db))!;
  const staff = await q<any>(`SELECT * FROM staff WHERE active AND joined_on < ($1::date + interval '1 month')`, [first], db);
  const fullDays = workingDays(month, settings.weekly_off);

  for (const st of staff) {
    const existing = await one<any>('SELECT * FROM payroll_items WHERE run_id=$1 AND staff_id=$2', [run.id, st.id], db);
    if (existing?.status === 'paid') continue;
    const { present } = (await one<{ present: number }>(`SELECT count(*) present FROM attendance WHERE staff_id=$1 AND day >= $2::date AND day < $2::date + interval '1 month'`, [st.id, first], db))!;
    const { commission } = (await one<{ commission: number }>(
      `SELECT COALESCE(sum(p.price / p.total_sessions * p.commission_pct / 100),0) commission FROM pt_sessions x JOIN pt_subscriptions p ON p.id=x.subscription_id
       WHERE x.trainer_id=$1 AND x.status='completed' AND (x.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date AND (x.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date < $2::date + interval '1 month'`, [st.id, first], db))!;
    const { adv } = (await one<{ adv: number }>('SELECT COALESCE(sum(amount),0) adv FROM salary_advances WHERE staff_id=$1 AND recovered_item_id IS NULL', [st.id], db))!;

    // With no scans at all for the month, assume full attendance and flag it, instead of cutting pay to zero.
    const assumed = present === 0;
    const joinedInMonth = st.joined_on >= first;
    const present_days = assumed ? workingDays(month, settings.weekly_off, joinedInMonth ? st.joined_on : undefined) : present;
    const row = {
      base_salary: st.base_salary, working_days: fullDays, present_days, paid_leaves: st.paid_leaves,
      commission: round2(commission), bonus: existing?.bonus ?? 0, advance_deduction: round2(adv), other_deduction: existing?.other_deduction ?? 0,
    };
    const c = compute(row);
    await db.query(
      `INSERT INTO payroll_items (run_id, staff_id, base_salary, working_days, present_days, paid_leaves, absent_days, absence_deduction, commission, bonus, advance_deduction, other_deduction, net_pay, attendance_assumed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (run_id, staff_id) DO UPDATE SET base_salary=EXCLUDED.base_salary, working_days=EXCLUDED.working_days, present_days=EXCLUDED.present_days, paid_leaves=EXCLUDED.paid_leaves,
         absent_days=EXCLUDED.absent_days, absence_deduction=EXCLUDED.absence_deduction, commission=EXCLUDED.commission, advance_deduction=EXCLUDED.advance_deduction, net_pay=EXCLUDED.net_pay, attendance_assumed=EXCLUDED.attendance_assumed`,
      [run.id, st.id, row.base_salary, row.working_days, row.present_days, row.paid_leaves, c.absent_days, c.absence_deduction, row.commission, row.bonus, row.advance_deduction, row.other_deduction, c.net_pay, assumed]);
  }
  return run;
}

/** Salaries are worked out per branch, because staff and attendance belong to a branch. */
const needBranch = () => {
  if (!tenant()?.branchId) throw bad('Choose a branch at the top of the screen to see its salaries.');
};

route('GET', '/payroll', 'payroll', async ({ query }) => {
  needBranch();
  const month = parse(monthParam, query.get('month'));
  const run = await one<any>('SELECT * FROM payroll_runs WHERE month=$1', [`${month}-01`]);
  if (!run) return { run: null, items: [] };
  const items = await q(`SELECT i.*, st.name, st.role_title, st.bank_details, st.phone FROM payroll_items i JOIN staff st ON st.id=i.staff_id WHERE i.run_id=$1 ORDER BY st.name`, [run.id]);
  return { run, items };
});

route('POST', '/payroll/generate', 'payroll', async ({ body }) => {
  needBranch();
  const month = parse(monthParam, body.month);
  return tx((db) => generate(db, month));
});

route('PUT', '/payroll/items/:id', 'payroll', async ({ params, body }) => {
  const v = parse(z.object({ present_days: s.money, paid_leaves: s.money, bonus: s.money.default(0), advance_deduction: s.money.default(0), other_deduction: s.money.default(0) }), body);
  return tx(async (db) => {
    const it = await one<any>('SELECT * FROM payroll_items WHERE id=$1 FOR UPDATE', [params.id], db);
    if (!it) throw notFound();
    if (it.status === 'paid') throw bad('This salary has already been paid');
    const c = compute({ ...it, ...v });
    return one(`UPDATE payroll_items SET present_days=$2, paid_leaves=$3, bonus=$4, advance_deduction=$5, other_deduction=$6, absent_days=$7, absence_deduction=$8, net_pay=$9, attendance_assumed=false WHERE id=$1 RETURNING *`,
      [it.id, v.present_days, v.paid_leaves, v.bonus, v.advance_deduction, v.other_deduction, c.absent_days, c.absence_deduction, c.net_pay], db);
  });
});

route('POST', '/payroll/items/:id/pay', 'payroll', async ({ params, body }) => {
  const v = parse(z.object({ method: s.method.default('bank'), paid_on: s.date }), body);
  return tx(async (db) => {
    const it = await one<any>('SELECT * FROM payroll_items WHERE id=$1 FOR UPDATE', [params.id], db);
    if (!it) throw notFound();
    if (it.status === 'paid') throw bad('This salary has already been paid');
    await db.query(`UPDATE payroll_items SET status='paid', method=$2, paid_on=COALESCE($3::date, gym_today()) WHERE id=$1`, [it.id, v.method, v.paid_on ?? null]);
    if (it.advance_deduction > 0) {
      const { total } = (await one<{ total: number }>('SELECT COALESCE(sum(amount),0) total FROM salary_advances WHERE staff_id=$1 AND recovered_item_id IS NULL', [it.staff_id], db))!;
      await db.query('UPDATE salary_advances SET recovered_item_id=$2 WHERE staff_id=$1 AND recovered_item_id IS NULL', [it.staff_id, it.id]);
      const left = round2(total - it.advance_deduction);
      if (left > 0) await db.query(`INSERT INTO salary_advances (staff_id, amount, note) VALUES ($1,$2,'Balance carried forward from last salary')`, [it.staff_id, left]);
    }
  });
});
