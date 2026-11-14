import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, q, tx, update } from '../db';
import { ApiError, bad, notFound, parse, route } from './router';
import * as s from './schemas';
import { branchCookie, can, clearCookie, PERMISSIONS, sessionCookie } from './session';
import { runAutomations } from '../services/messaging';
import { getSettings } from '../services/billing';
import { photoResponse, PhotoKind, savePhoto } from '../services/photos';

/* ---------- Login ---------- */

const attempts = new Map<string, { count: number; until: number }>();
const WINDOW = 15 * 60_000;

function checkLimit(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.count >= 8) throw new ApiError(429, 'Too many attempts. Please wait 15 minutes and try again.');
}
function recordFail(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + WINDOW });
  else a.count++;
}

/**
 * Who is logged in, which gym and branch they are working in, and what they can open.
 * Gym accounts are created only by the super admin, so there is no public sign-up.
 */
route('GET', '/auth/state', 'public', async ({ user }) => {
  if (!user) return { user: null };
  const [gym, branches, photos] = await Promise.all([
    one<any>('SELECT gym_name FROM settings WHERE gym_id=$1', [user.gym_id]),
    q<any>(`SELECT id, name FROM branches WHERE gym_id=$1 AND active AND ($2::int IS NULL OR id=$2) ORDER BY id`, [user.gym_id, user.home_branch_id]),
    q<any>(`SELECT kind, extract(epoch FROM updated_at)::bigint v FROM photos WHERE gym_id=$1 AND ((kind='gym' AND ref_id=$1) OR (kind='user' AND ref_id=$2))`, [user.gym_id, user.id]),
  ]);
  const v = (kind: string) => photos.find((p) => p.kind === kind)?.v ?? null;
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, staff_id: user.staff_id, permissions: PERMISSIONS[user.role] ?? [], photo_v: v('user') },
    gym_id: user.gym_id, gym_name: gym?.gym_name ?? 'My Gym', gym_photo_v: v('gym'), gym_active: user.gym_active,
    branches, branch_id: user.branch_id, can_switch_branch: user.role === 'owner' && branches.length > 1,
  };
});

/** Owners choose which branch to work in, or 'all' to see every branch together. */
route('POST', '/auth/branch', 'any', async ({ body, user, req, setCookie }) => {
  if (user.role !== 'owner') throw new ApiError(403, 'Only the owner can switch branches');
  const v = parse(z.object({ branch_id: z.union([z.literal('all'), s.id]) }), body);
  if (v.branch_id !== 'all' && !user.branch_ids.includes(v.branch_id)) throw bad('Branch not found');
  setCookie(branchCookie(v.branch_id, req));
});

route('POST', '/auth/login', 'public', async ({ body, req, setCookie }) => {
  const v = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string() }), body);
  const key = v.email;
  checkLimit(key);
  const u = await one<any>('SELECT u.*, g.active gym_active FROM users u JOIN gyms g ON g.id=u.gym_id WHERE u.email=$1 AND u.active', [v.email]);
  if (!u || !(await bcrypt.compare(v.password, u.password_hash))) {
    recordFail(key);
    throw new ApiError(401, 'Wrong email or password');
  }
  attempts.delete(key);
  if (!u.gym_active) throw new ApiError(403, 'This gym account is paused. Please contact GymPilot support.');
  setCookie(await sessionCookie(u.id, req));
});

route('POST', '/auth/photo', 'any', async ({ body, user }) => {
  const v = parse(z.object({ photo: s.photo }), body);
  await savePhoto(undefined, 'user', user.id, v.photo ?? null);
});

/** Photos are served as images. kind is member, user or gym. */
route('GET', '/photos/:kind/:id', 'any', async ({ params }) => {
  const kind = params.kind as PhotoKind;
  if (!['member', 'user', 'gym'].includes(kind)) throw notFound();
  return photoResponse(kind, Number(params.id));
});

route('POST', '/auth/logout', 'public', async ({ setCookie }) => { setCookie(clearCookie()); });

route('POST', '/auth/password', 'any', async ({ body, user }) => {
  const v = parse(z.object({ current: z.string(), next: z.string().min(8, 'must be at least 8 characters') }), body);
  const u = (await one<any>('SELECT * FROM users WHERE id=$1', [user.id]))!;
  if (!(await bcrypt.compare(v.current, u.password_hash))) throw bad('Current password is wrong');
  await q('UPDATE users SET password_hash=$2 WHERE id=$1', [user.id, await bcrypt.hash(v.next, 10)]);
});

/* ---------- Dashboard ---------- */

route('GET', '/dashboard', 'dashboard', async ({ user }) => {
  if (!can(user.role, 'billing')) return trainerDashboard(user.staff_id ?? -1);
  // A savepoint, so a failure here cannot spoil the rest of the request.
  await tx(() => runAutomations()).catch((e) => console.error('[automations]', e));

  const [kpis, chart, recent, setup] = await Promise.all([
    one(`SELECT
      (SELECT count(*) FROM member_overview WHERE NOT archived AND status='active') active_members,
      (SELECT count(*) FROM attendance WHERE day=gym_today() AND member_id IS NOT NULL) checkins_today,
      (SELECT COALESCE(sum(amount),0) FROM payments WHERE NOT voided AND paid_on=gym_today()) collected_today,
      (SELECT COALESCE(sum(amount),0) FROM payments WHERE NOT voided AND date_trunc('month',paid_on)=date_trunc('month',gym_today()::timestamp)) collected_month,
      (SELECT COALESCE(sum(amount),0) FROM expenses WHERE date_trunc('month',expense_date)=date_trunc('month',gym_today()::timestamp)) expenses_month,
      (SELECT COALESCE(sum(balance),0) FROM invoices WHERE status IN ('unpaid','partial')) dues_total,
      (SELECT count(*) FROM members WHERE NOT archived AND date_trunc('month',joined_on)=date_trunc('month',gym_today()::timestamp)) new_month,
      (SELECT count(*) FROM member_overview WHERE NOT archived AND valid_until BETWEEN gym_today() AND gym_today()+7) expiring_7,
      (SELECT count(*) FROM member_overview WHERE NOT archived AND status='expired' AND end_date >= gym_today()-30) expired_30,
      (SELECT count(*) FROM member_overview WHERE NOT archived AND dues > 0) members_with_dues,
      (SELECT count(*) FROM leads WHERE next_followup <= gym_today() AND status NOT IN ('won','lost')) followups_due,
      (SELECT count(*) FROM products WHERE active AND stock <= reorder_level) low_stock,
      (SELECT count(*) FROM messages WHERE status='queued') messages_queued,
      (SELECT count(DISTINCT device_user_id) FROM biometric_punches WHERE result='unknown') unmatched,
      (SELECT count(*) FROM attendance WHERE day=gym_today() AND NOT membership_ok) flagged_today,
      (SELECT count(*) FROM member_overview WHERE NOT archived AND status='active' AND COALESCE(last_visit, joined_on) < gym_today() - (SELECT inactive_days FROM settings)) inactive,
      (SELECT count(*) FROM pt_sessions WHERE status='scheduled' AND (scheduled_at AT TIME ZONE 'Asia/Kolkata')::date = gym_today()) pt_today`),
    q(`SELECT to_char(m,'Mon') label, to_char(m,'YYYY-MM') AS month_key,
        COALESCE((SELECT sum(amount) FROM payments WHERE NOT voided AND date_trunc('month',paid_on)=m),0) income,
        COALESCE((SELECT sum(amount) FROM expenses WHERE date_trunc('month',expense_date)=m),0)
         + COALESCE((SELECT sum(net_pay) FROM payroll_items WHERE status='paid' AND date_trunc('month',paid_on)=m),0) spending
       FROM generate_series(date_trunc('month',gym_today()::timestamp) - interval '5 months', date_trunc('month',gym_today()::timestamp), interval '1 month') m ORDER BY m`),
    q(`SELECT a.id, a.check_in, a.check_out, a.membership_ok, a.member_id, m.name, o.plan_name FROM attendance a JOIN members m ON m.id=a.member_id JOIN member_overview o ON o.id=m.id WHERE a.day=gym_today() ORDER BY a.check_in DESC LIMIT 7`),
    one(`SELECT
      (SELECT gstin IS NOT NULL OR NOT gst_enabled FROM settings) profile,
      EXISTS(SELECT 1 FROM plans) plans,
      EXISTS(SELECT 1 FROM staff) staff,
      EXISTS(SELECT 1 FROM members) members,
      EXISTS(SELECT 1 FROM biometric_devices) device,
      EXISTS(SELECT 1 FROM leads) leads`),
  ]);
  return { kind: 'owner', kpis, chart, recent, setup };
});

async function trainerDashboard(staffId: number) {
  const [kpis, sessions, lowClients] = await Promise.all([
    one(`SELECT
      (SELECT count(*) FROM pt_subscriptions WHERE trainer_id=$1 AND status='active') clients,
      (SELECT count(*) FROM pt_sessions WHERE trainer_id=$1 AND status<>'cancelled' AND (scheduled_at AT TIME ZONE 'Asia/Kolkata')::date = gym_today()) sessions_today,
      (SELECT count(*) FROM pt_sessions WHERE trainer_id=$1 AND status='completed' AND date_trunc('month',scheduled_at AT TIME ZONE 'Asia/Kolkata')=date_trunc('month',gym_today()::timestamp)) completed_month,
      (SELECT COALESCE(sum(p.price/p.total_sessions*p.commission_pct/100),0) FROM pt_sessions x JOIN pt_subscriptions p ON p.id=x.subscription_id WHERE x.trainer_id=$1 AND x.status='completed' AND date_trunc('month',x.scheduled_at AT TIME ZONE 'Asia/Kolkata')=date_trunc('month',gym_today()::timestamp)) commission_month`, [staffId]),
    q(`SELECT x.id, x.scheduled_at, x.status, x.duration_min, m.name member_name, p.package_name, p.used_sessions, p.total_sessions FROM pt_sessions x JOIN pt_subscriptions p ON p.id=x.subscription_id JOIN members m ON m.id=p.member_id
       WHERE x.trainer_id=$1 AND (x.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date = gym_today() ORDER BY x.scheduled_at`, [staffId]),
    q(`SELECT p.id, m.name member_name, p.total_sessions - p.used_sessions remaining, p.end_date FROM pt_subscriptions p JOIN members m ON m.id=p.member_id
       WHERE p.trainer_id=$1 AND p.status='active' AND (p.total_sessions - p.used_sessions <= 2 OR p.end_date <= gym_today()+7) ORDER BY remaining LIMIT 8`, [staffId]),
  ]);
  return { kind: 'trainer', kpis, sessions, lowClients };
}

/* ---------- Reports ---------- */

route('GET', '/reports', 'reports', async () => {
  const [pnl, plans, gst, inactive, sources, methods] = await Promise.all([
    q(`SELECT to_char(m,'Mon YY') label,
        COALESCE((SELECT sum(amount) FROM payments WHERE NOT voided AND date_trunc('month',paid_on)=m),0) income,
        COALESCE((SELECT sum(amount) FROM expenses WHERE date_trunc('month',expense_date)=m),0) expenses,
        COALESCE((SELECT sum(net_pay) FROM payroll_items WHERE status='paid' AND date_trunc('month',paid_on)=m),0) payroll
       FROM generate_series(date_trunc('month',gym_today()::timestamp) - interval '11 months', date_trunc('month',gym_today()::timestamp), interval '1 month') m ORDER BY m DESC`),
    q(`SELECT ms.plan_name, count(*) sold, sum(it.amount) revenue FROM invoice_items it JOIN invoices i ON i.id=it.invoice_id JOIN memberships ms ON ms.id=it.ref_id
       WHERE it.item_type='membership' AND i.status<>'cancelled' AND i.invoice_date >= gym_today() - 365 GROUP BY ms.plan_name ORDER BY revenue DESC`),
    q(`SELECT to_char(date_trunc('month',invoice_date),'Mon YY') label, count(*) invoices, sum(taxable) taxable, sum(cgst) cgst, sum(sgst) sgst, sum(total) total
       FROM invoices WHERE status<>'cancelled' AND invoice_date >= gym_today() - 365 GROUP BY date_trunc('month',invoice_date) ORDER BY date_trunc('month',invoice_date) DESC`),
    q(`SELECT id, name, phone, plan_name, last_visit, valid_until, gym_today() - COALESCE(last_visit, joined_on) days_away FROM member_overview
       WHERE NOT archived AND status='active' AND COALESCE(last_visit, joined_on) < gym_today() - (SELECT inactive_days FROM settings) ORDER BY days_away DESC LIMIT 100`),
    q(`SELECT COALESCE(source,'Not recorded') source, count(*) total, count(*) FILTER (WHERE status='won') won FROM leads GROUP BY 1 ORDER BY total DESC`),
    q(`SELECT method, sum(amount) total FROM payments WHERE NOT voided AND date_trunc('month',paid_on)=date_trunc('month',gym_today()::timestamp) GROUP BY method ORDER BY total DESC`),
  ]);
  return { pnl, plans, gst, inactive, sources, methods };
});

/* ---------- Settings ---------- */

const settingsSchema = z.object({
  gym_name: s.reqText, address: s.text, phone: s.text, email: s.email,
  gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'is not a valid 15-character GSTIN').nullish(),
  gst_enabled: s.bool, default_gst_rate: z.coerce.number().min(0).max(40), prices_include_gst: s.bool, sac_code: s.reqText,
  upi_id: s.text, invoice_prefix: z.string().trim().regex(/^[A-Za-z0-9-]{1,6}$/, 'must be 1 to 6 letters or numbers'), invoice_terms: s.text,
  weekly_off: z.coerce.number().int().min(-1).max(6).nullish().transform((v) => (v === -1 || v === null || v === undefined ? null : v)),
  inactive_days: z.coerce.number().int().min(1).max(365), auto_expiry: s.bool, auto_dues: s.bool, auto_birthday: s.bool, auto_welcome: s.bool,
});

// Every screen that bills needs the GST settings, so anyone logged in may read them. Only the owner changes them.
route('GET', '/settings', 'any', async ({ user }) => {
  const [settings, photo] = await Promise.all([
    getSettings(),
    one<{ v: number }>(`SELECT extract(epoch FROM updated_at)::bigint v FROM photos WHERE kind='gym' AND ref_id=$1`, [user.gym_id]),
  ]);
  return { ...settings, gym_photo_v: photo?.v ?? null };
});
route('PUT', '/settings', 'settings', async ({ body, user }) => {
  const { gym_photo } = parse(z.object({ gym_photo: s.photo }), body);
  await savePhoto(undefined, 'gym', user.gym_id, gym_photo);
  return update('settings', user.gym_id, parse(settingsSchema, body));
});
