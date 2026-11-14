import { z } from 'zod';
import { insert, one, q, tx, update } from '../db';
import { bad, notFound, parse, route } from './router';
import * as s from './schemas';
import { sellMembership } from '../services/billing';

const STATUSES = ['new', 'contacted', 'trial', 'follow_up', 'won', 'lost'] as const;
const leadSchema = z.object({
  name: s.reqText, phone: s.phone, email: s.email, gender: s.text, source: s.text, interest: s.text,
  assigned_to: s.idOpt, next_followup: s.date, trial_start: s.date, trial_end: s.date, notes: s.text,
});

route('GET', '/leads', 'leads', async () => {
  const [rows, staff, stats] = await Promise.all([
    q(`SELECT l.*, st.name assigned_name FROM leads l LEFT JOIN staff st ON st.id=l.assigned_to
       WHERE l.status NOT IN ('won','lost') OR l.updated_at > now() - interval '30 days'
       ORDER BY l.next_followup NULLS LAST, l.id DESC`),
    q(`SELECT id, name FROM staff WHERE active ORDER BY name`),
    one(`SELECT
        count(*) FILTER (WHERE status NOT IN ('won','lost')) open,
        count(*) FILTER (WHERE next_followup <= gym_today() AND status NOT IN ('won','lost')) due_today,
        count(*) FILTER (WHERE status='won' AND date_trunc('month',updated_at)=date_trunc('month',now())) won_month,
        count(*) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',now())) new_month,
        count(*) FILTER (WHERE status='won') won_total,
        count(*) total FROM leads`),
  ]);
  return { rows, staff, stats };
});

route('POST', '/leads', 'leads', async ({ body, user }) => {
  const data = parse(leadSchema, body);
  return tx(async (db) => {
    const l = await insert('leads', data, db);
    await db.query(`INSERT INTO lead_activities (lead_id, type, note, created_by) VALUES ($1,'status','Enquiry added',$2)`, [l.id, user.id]);
    return l;
  });
});

route('GET', '/leads/:id', 'leads', async ({ params }) => {
  const lead = await one(`SELECT l.*, st.name assigned_name FROM leads l LEFT JOIN staff st ON st.id=l.assigned_to WHERE l.id=$1`, [params.id]);
  if (!lead) throw notFound('Enquiry not found');
  const activities = await q(`SELECT a.*, u.name by_name FROM lead_activities a LEFT JOIN users u ON u.id=a.created_by WHERE a.lead_id=$1 ORDER BY a.id DESC`, [params.id]);
  return { lead, activities };
});

route('PUT', '/leads/:id', 'leads', async ({ params, body }) => update('leads', params.id, { ...parse(leadSchema, body), updated_at: new Date() }));

route('POST', '/leads/:id/move', 'leads', async ({ params, body, user }) => {
  const v = parse(z.object({ status: z.enum(STATUSES), lost_reason: s.text }), body);
  if (v.status === 'lost' && !v.lost_reason) throw bad('Please choose why this enquiry was lost');
  return tx(async (db) => {
    const l = await update('leads', params.id, { status: v.status, lost_reason: v.status === 'lost' ? v.lost_reason : null, updated_at: new Date() }, db);
    if (!l) throw notFound('Enquiry not found');
    await db.query(`INSERT INTO lead_activities (lead_id, type, note, created_by) VALUES ($1,'status',$2,$3)`, [l.id, `Moved to ${v.status.replace('_', ' ')}${v.lost_reason ? `: ${v.lost_reason}` : ''}`, user.id]);
    return l;
  });
});

route('POST', '/leads/:id/activities', 'leads', async ({ params, body, user }) => {
  const v = parse(z.object({ type: z.enum(['call', 'whatsapp', 'visit', 'note']), note: s.reqText, next_followup: s.date }), body);
  return tx(async (db) => {
    const a = await insert('lead_activities', { lead_id: Number(params.id), type: v.type, note: v.note, created_by: user.id }, db);
    await db.query(`UPDATE leads SET updated_at=now(), next_followup=COALESCE($2::date,next_followup), status=CASE WHEN status='new' THEN 'contacted' ELSE status END WHERE id=$1`, [params.id, v.next_followup ?? null]);
    return a;
  });
});

route('POST', '/leads/:id/convert', 'leads', async ({ params, body, user }) => {
  const v = parse(z.object({ plan_id: s.idOpt, slot_id: s.idOpt, start_date: s.date, discount: s.moneyOpt, payment: s.payment }), body);
  return tx(async (db) => {
    const l = await one<any>('SELECT * FROM leads WHERE id=$1 FOR UPDATE', [params.id], db);
    if (!l) throw notFound('Enquiry not found');
    if (l.converted_member_id) throw bad('This enquiry is already a member');
    const m = await insert('members', { name: l.name, phone: l.phone, email: l.email, gender: l.gender, goal: l.interest, lead_id: l.id }, db);
    await db.query(`UPDATE leads SET status='won', converted_member_id=$2, next_followup=NULL, updated_at=now() WHERE id=$1`, [l.id, m.id]);
    await db.query(`INSERT INTO lead_activities (lead_id, type, note, created_by) VALUES ($1,'status','Joined as a member',$2)`, [l.id, user.id]);
    const sale = v.plan_id ? await sellMembership(db, { member_id: m.id, plan_id: v.plan_id, slot_id: v.slot_id, start_date: v.start_date, discount: v.discount ?? 0, payment: v.payment, user_id: user.id }) : null;
    return { member: m, invoice: sale?.invoice ?? null };
  });
});
