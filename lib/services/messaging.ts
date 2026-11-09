import nodemailer from 'nodemailer';
import { Db, one, pool, q } from '../db';
import { bad } from '../api/router';
import { getSettings } from './billing';
import { sendTemplate, waConfig, WaConfig } from './whatsapp';

const VAR = /\{\{\s*(\w+)\s*\}\}/g;

/** Filled in automatically for each person. Any other {{blank}} is asked for when sending. */
export const AUTO_VARS = ['name', 'plan', 'expiry_date', 'due_amount', 'gym_name'];

export const render = (body: string, vars: Record<string, unknown>) =>
  body.replace(VAR, (_, k) => (vars[k] === null || vars[k] === undefined ? '' : String(vars[k])));

const orderedParams = (body: string, vars: Record<string, unknown>) =>
  [...body.matchAll(VAR)].map((m) => String(vars[m[1]] ?? '-'));

export const customVars = (body: string) =>
  [...new Set([...body.matchAll(VAR)].map((m) => m[1]))].filter((v) => !AUTO_VARS.includes(v));

export const normalizePhone = (phone: string | null | undefined) => {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
};

export const formatDate = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}-${m}-${y}`;
};

export async function channelStatus() {
  const cfg = await waConfig();
  return { whatsapp_api: !!cfg, sms: !!process.env.SMS_GATEWAY_URL, email: !!process.env.SMTP_URL };
}

const whatsappReady = (t: { wa_template_name?: string | null; wa_status?: string | null } | null) =>
  !!t?.wa_template_name && (!t.wa_status || t.wa_status === 'APPROVED');

/** Returns the provider's message id, or null when the message must wait for one-click sending. */
async function deliver(m: any, cfg: WaConfig | null): Promise<string | null> {
  if (m.channel === 'whatsapp') {
    if (!cfg || !whatsappReady(m)) return null;
    if (!m.phone) throw new Error('No phone number on file');
    return sendTemplate(cfg, { to: normalizePhone(m.phone), name: m.wa_template_name, language: m.language ?? 'en', params: m.params ?? [] });
  }
  if (m.channel === 'sms') {
    if (!process.env.SMS_GATEWAY_URL) return null;
    const url = process.env.SMS_GATEWAY_URL.replace('{phone}', encodeURIComponent(normalizePhone(m.phone))).replace('{message}', encodeURIComponent(m.body));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SMS gateway error ${res.status}`);
    return '';
  }
  if (m.channel === 'email') {
    if (!process.env.SMTP_URL) return null;
    if (!m.email) throw new Error('No email address on file');
    await nodemailer.createTransport(process.env.SMTP_URL).sendMail({ from: process.env.EMAIL_FROM, to: m.email, subject: m.subject || 'Message from your gym', text: m.body });
    return '';
  }
  return null;
}

/** Claims messages first, so two open tabs can never send the same message twice. */
async function sendClaimed(where: string, params: unknown[], limit: number) {
  const claimed = await q<{ id: number }>(
    `UPDATE messages SET status='sending', claimed_at=now() WHERE id IN (
       SELECT id FROM messages WHERE status='queued' AND ${where} ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
     ) RETURNING id`, params);
  if (!claimed.length) return { sent: 0, failed: 0, waiting: 0, count: 0 };
  const rows = await q<any>(
    `SELECT m.*, t.wa_template_name, t.wa_status, t.language FROM messages m LEFT JOIN message_templates t ON t.id=m.template_id
     WHERE m.id = ANY($1) ORDER BY m.id`, [claimed.map((c) => c.id)]);
  const cfg = await waConfig();
  let sent = 0, failed = 0, waiting = 0, next = 0;

  const worker = async () => {
    while (next < rows.length) {
      const m = rows[next++];
      try {
        const id = await deliver(m, cfg);
        if (id === null) {
          waiting++;
          await q(`UPDATE messages SET status='queued', claimed_at=NULL WHERE id=$1`, [m.id]);
        } else {
          sent++;
          await q(`UPDATE messages SET status='sent', sent_at=now(), error=NULL, wa_message_id=$2, delivery_status='sent' WHERE id=$1`, [m.id, id || null]);
        }
      } catch (e: any) {
        failed++;
        await q(`UPDATE messages SET status='failed', error=$2 WHERE id=$1`, [m.id, String(e.message).slice(0, 500)]);
      }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  return { sent, failed, waiting, count: rows.length };
}

export async function flushQueue(ids?: number[]) {
  const r = ids ? await sendClaimed('id = ANY($1)', [ids], 200) : await sendClaimed('campaign_id IS NULL', [], 50);
  return r.sent;
}

const AUDIENCE_SQL: Record<string, string> = {
  all: `archived = false`,
  active: `archived = false AND status = 'active'`,
  expired: `archived = false AND status = 'expired'`,
  expiring: `archived = false AND valid_until BETWEEN gym_today() AND gym_today() + 7`,
  dues: `archived = false AND dues > 0`,
  inactive: `archived = false AND status = 'active' AND COALESCE(last_visit, joined_on) < gym_today() - (SELECT inactive_days FROM settings WHERE id=1)`,
  birthdays: `archived = false AND to_char(dob,'MM-DD') = to_char(gym_today(),'MM-DD')`,
};

export const memberVars = (m: any, gym: string) => ({
  name: m.name, plan: m.plan_name ?? '', expiry_date: formatDate(m.valid_until), due_amount: m.dues ?? 0, gym_name: gym,
});

async function queueOne(db: Db, a: {
  member_id?: number | null; lead_id?: number | null; to_name: string; phone?: string | null; email?: string | null;
  channel: string; template?: any; subject?: string | null; body: string; vars: Record<string, unknown>;
  origin: string; dedupe_key?: string | null; user_id?: number | null; campaign_id?: number | null;
}) {
  return one<{ id: number }>(
    `INSERT INTO messages (member_id, lead_id, to_name, phone, email, channel, template_id, subject, body, params, origin, dedupe_key, created_by, campaign_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [a.member_id ?? null, a.lead_id ?? null, a.to_name, a.phone ?? null, a.email ?? null, a.channel, a.template?.id ?? null,
      render(a.subject ?? a.template?.subject ?? '', a.vars) || null, render(a.body, a.vars),
      JSON.stringify(orderedParams(a.template?.body ?? a.body, a.vars)), a.origin, a.dedupe_key ?? null, a.user_id ?? null, a.campaign_id ?? null], db);
}

export async function queueAudience(input: {
  audience: string; member_id?: number | null; lead_id?: number | null; template_id?: number | null;
  channel: string; body?: string | null; subject?: string | null; user_id: number; vars?: Record<string, string>; campaign_name?: string | null;
}) {
  const db = pool();
  const s = await getSettings();
  const template = input.template_id ? await one<any>('SELECT * FROM message_templates WHERE id=$1', [input.template_id]) : null;
  // A chosen template is sent exactly as approved, so its wording cannot drift from what Meta reviewed.
  const body = template?.body ?? input.body;
  if (!body) throw bad('Message is empty');

  const missing = customVars(body).filter((v) => !input.vars?.[v]?.trim());
  if (missing.length) throw bad(`Please fill in: ${missing.join(', ').replace(/_/g, ' ')}`);
  const extra = input.vars ?? {};

  const single = !!(input.member_id || input.lead_id);
  const cfg = input.channel === 'whatsapp' ? await waConfig() : null;
  const automatic = input.channel === 'whatsapp'
    ? !!cfg && whatsappReady(template)
    : input.channel === 'sms' ? !!process.env.SMS_GATEWAY_URL : !!process.env.SMTP_URL;

  const campaign = single ? null : await one<{ id: number }>(
    `INSERT INTO campaigns (name, channel, audience, template_id, mode, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [input.campaign_name || template?.name || 'Custom message', input.channel, input.audience, template?.id ?? null, automatic ? 'automatic' : 'manual', input.user_id]);

  const common = { channel: input.channel, template, subject: input.subject, body, origin: 'manual', user_id: input.user_id, campaign_id: campaign?.id ?? null };
  const ids: number[] = [];
  if (input.audience === 'leads' || input.lead_id) {
    const leads = input.lead_id
      ? await q<any>('SELECT * FROM leads WHERE id=$1', [input.lead_id])
      : await q<any>(`SELECT * FROM leads WHERE status NOT IN ('won','lost')`);
    for (const l of leads) {
      const r = await queueOne(db, { ...common, lead_id: l.id, to_name: l.name, phone: l.phone, email: l.email, vars: { name: l.name, gym_name: s.gym_name, ...extra } });
      if (r) ids.push(r.id);
    }
  } else {
    const where = input.member_id ? 'id = $1' : AUDIENCE_SQL[input.audience] && `${AUDIENCE_SQL[input.audience]} AND NOT whatsapp_opt_out`;
    if (!where) throw bad('Unknown audience');
    const members = await q<any>(`SELECT * FROM member_overview WHERE ${where}`, input.member_id ? [input.member_id] : []);
    for (const m of members) {
      const r = await queueOne(db, { ...common, member_id: m.id, to_name: m.name, phone: m.phone, email: m.email, vars: { ...memberVars(m, s.gym_name), ...extra } });
      if (r) ids.push(r.id);
    }
  }
  const sent = single && ids.length ? await flushQueue(ids) : 0;
  return { queued: ids.length, sent, campaign_id: campaign?.id ?? null, automatic };
}

/** Sends the next small batch. The browser calls this repeatedly and shows progress. */
export async function processCampaign(id: number) {
  // A batch interrupted mid-send is marked failed rather than resent blindly, so nobody gets a duplicate.
  await q(`UPDATE messages SET status='failed', error='Interrupted while sending. Check before retrying.'
           WHERE campaign_id=$1 AND status='sending' AND claimed_at < now() - interval '5 minutes'`, [id]);
  const r = await sendClaimed('campaign_id = $1', [id], 25);
  const { remaining } = (await one<{ remaining: number }>(`SELECT count(*) remaining FROM messages WHERE campaign_id=$1 AND status='queued'`, [id]))!;
  return { sent: r.sent, failed: r.failed, remaining, stalled: r.waiting > 0 && r.sent === 0 && r.failed === 0 };
}

export const countAudience = async (audience: string) => {
  if (audience === 'leads') return (await one<{ c: number }>(`SELECT count(*) c FROM leads WHERE status NOT IN ('won','lost')`))!.c;
  if (!AUDIENCE_SQL[audience]) return 0;
  return (await one<{ c: number }>(`SELECT count(*) c FROM member_overview WHERE ${AUDIENCE_SQL[audience]} AND NOT whatsapp_opt_out`))!.c;
};

/** Creates today's reminders. Repeat runs add nothing, because each reminder has a unique key. */
export async function runAutomations() {
  const db = pool();
  const s = await getSettings();
  const templates = Object.fromEntries((await q<any>('SELECT * FROM message_templates WHERE key IS NOT NULL')).map((t) => [t.key, t]));
  const today = (await one<{ d: string }>('SELECT gym_today() d'))!.d;
  let created = 0;

  const add = async (m: any, key: string, dedupe: string) => {
    if (!templates[key]) return;
    const r = await queueOne(db, { member_id: m.id, to_name: m.name, phone: m.phone, email: m.email, channel: 'whatsapp', template: templates[key], body: templates[key].body, vars: memberVars(m, s.gym_name), origin: 'automatic', dedupe_key: dedupe });
    if (r) created++;
  };

  if (s.auto_expiry) {
    for (const m of await q<any>(`SELECT * FROM member_overview WHERE NOT archived AND valid_until - gym_today() IN (7,3,1,0)`)) {
      await add(m, 'expiry', `expiry:${m.id}:${m.valid_until}:${today}`);
    }
    for (const m of await q<any>(`SELECT * FROM member_overview WHERE NOT archived AND valid_until = gym_today() - 1`)) {
      await add(m, 'expired', `expired:${m.id}:${m.valid_until}`);
    }
  }
  if (s.auto_dues) {
    const week = (await one<{ w: string }>(`SELECT to_char(gym_today(),'IYYY-IW') w`))!.w;
    for (const m of await q<any>(`SELECT * FROM member_overview WHERE NOT archived AND dues > 0`)) {
      await add(m, 'dues', `dues:${m.id}:${week}`);
    }
  }
  if (s.auto_birthday) {
    for (const m of await q<any>(`SELECT * FROM member_overview WHERE NOT archived AND to_char(dob,'MM-DD') = to_char(gym_today(),'MM-DD')`)) {
      await add(m, 'birthday', `birthday:${m.id}:${today}`);
    }
  }
  const sent = created ? await flushQueue() : 0;
  return { created, sent };
}
