import { z } from 'zod';
import { asTenant, insert, one, q, tx, update } from '../db';
import { bad, notFound, parse, route } from './router';
import { costHistory, syncWhatsAppCosts } from '../services/wa-costs';
import * as s from './schemas';
import { AUTO_VARS, channelStatus, countAudience, flushQueue, processCampaign, queueAudience, runAutomations } from '../services/messaging';
import {
  deleteSubmittedTemplate, editSubmittedTemplate, encrypt, listRemoteTemplates, liveNumberStatus, submitTemplate, templateSlug, validateForMeta, verifyConnection, waConfig,
} from '../services/whatsapp';

const templateSchema = z.object({
  name: s.reqText, subject: s.text, body: s.reqText,
  category: z.enum(['UTILITY', 'MARKETING']).default('UTILITY'), language: z.enum(['en', 'en_US', 'hi', 'mr']).default('en'),
  header: s.text, footer: s.text,
});
const AUDIENCES = ['all', 'active', 'expiring', 'expired', 'dues', 'inactive', 'birthdays', 'leads'];

route('GET', '/comms/overview', 'comms', async () => {
  // A savepoint, so a failure here cannot spoil the rest of the request.
  await tx(() => runAutomations()).catch((e) => console.error('[automations]', e));
  const [queue, templates, counts, channels] = await Promise.all([
    q(`SELECT * FROM messages WHERE status IN ('queued','failed') ORDER BY id DESC LIMIT 200`),
    q(`SELECT * FROM message_templates ORDER BY id`),
    Promise.all(AUDIENCES.map(async (a) => [a, await countAudience(a)] as const)),
    channelStatus(),
  ]);
  return { queue, templates, audiences: Object.fromEntries(counts), channels, auto_vars: AUTO_VARS };
});

route('GET', '/comms/history', 'comms', async () => q(`SELECT * FROM messages WHERE status='sent' ORDER BY sent_at DESC LIMIT 200`));

route('POST', '/comms/send', 'comms', async ({ body, user }) => {
  const v = parse(z.object({
    audience: s.text, member_id: s.idOpt, lead_id: s.idOpt, template_id: s.idOpt,
    channel: z.enum(['whatsapp', 'sms', 'email']).default('whatsapp'), body: s.text, subject: s.text,
    vars: z.record(z.string().nullable()).optional(), campaign_name: s.text,
  }), body);
  if (!v.audience && !v.member_id && !v.lead_id) throw bad('Choose who should receive this message');
  if (!v.body && !v.template_id) throw bad('Write a message or choose a template');
  const vars = Object.fromEntries(Object.entries(v.vars ?? {}).map(([k, x]) => [k, x ?? '']));
  return queueAudience({ ...v, audience: v.audience ?? 'all', vars, user_id: user.id });
});

/* ---------- Bulk sends ---------- */

route('GET', '/comms/campaigns', 'comms', async () => q(`
  SELECT c.*, t.name template_name, count(m.id) total,
    count(*) FILTER (WHERE m.status='sent') sent,
    count(*) FILTER (WHERE m.delivery_status IN ('delivered','read')) delivered,
    count(*) FILTER (WHERE m.delivery_status='read') read_count,
    count(*) FILTER (WHERE m.status='failed') failed,
    count(*) FILTER (WHERE m.status='queued') queued
  FROM campaigns c LEFT JOIN messages m ON m.campaign_id=c.id LEFT JOIN message_templates t ON t.id=c.template_id
  GROUP BY c.id, t.name ORDER BY c.id DESC LIMIT 100`));

route('POST', '/comms/campaigns/:id/process', 'comms', async ({ params }) => processCampaign(Number(params.id)));

route('POST', '/comms/campaigns/:id/retry', 'comms', async ({ params }) => {
  const r = await q(`UPDATE messages SET status='queued', error=NULL, claimed_at=NULL WHERE campaign_id=$1 AND status='failed' RETURNING id`, [params.id]);
  return { queued: r.length };
});

/* ---------- Individual messages ---------- */

route('POST', '/comms/messages/:id/sent', 'comms', async ({ params }) => {
  await q(`UPDATE messages SET status='sent', sent_at=now(), error=NULL WHERE id=$1`, [params.id]);
});
route('POST', '/comms/messages/:id/retry', 'comms', async ({ params }) => {
  await q(`UPDATE messages SET status='queued', error=NULL, claimed_at=NULL WHERE id=$1`, [params.id]);
  return { sent: await flushQueue([Number(params.id)]) };
});
route('DELETE', '/comms/messages/:id', 'comms', async ({ params }) => {
  await q(`DELETE FROM messages WHERE id=$1 AND status<>'sent'`, [params.id]);
});

/* ---------- Templates ---------- */

async function requireWaba() {
  const cfg = await waConfig();
  if (!cfg?.waba_id) throw bad('Connect your WhatsApp Business account first (WhatsApp setup tab)');
  return cfg;
}

route('POST', '/comms/templates', 'comms', async ({ body }) => insert('message_templates', parse(templateSchema, body)));

route('PUT', '/comms/templates/:id', 'comms', async ({ params, body }) => {
  const v = parse(templateSchema, body);
  const old = await one<any>('SELECT * FROM message_templates WHERE id=$1', [params.id]);
  if (!old) throw notFound('Template not found');
  if (old.wa_template_id) {
    if (v.category !== old.category || v.language !== old.language) throw bad('Category and language cannot change after a template is sent to WhatsApp. Create a new template instead.');
    const changed = v.body !== old.body || (v.header ?? null) !== old.header || (v.footer ?? null) !== old.footer;
    if (changed) {
      validateForMeta(v);
      await editSubmittedTemplate(await requireWaba(), { ...old, ...v });
      return update('message_templates', params.id, { ...v, wa_status: 'PENDING', wa_rejected_reason: null });
    }
  }
  return update('message_templates', params.id, v);
});

route('POST', '/comms/templates/sync', 'comms', async () => {
  const cfg = await requireWaba();
  const remote = await listRemoteTemplates(cfg);
  const local = await q<any>('SELECT id, key, wa_template_name FROM message_templates WHERE wa_template_name IS NOT NULL OR key IS NOT NULL');
  // A library template matches Meta's template of the same name, so one made in Meta by hand is linked, not copied.
  const known = new Map<string, number>();
  for (const l of local) { if (l.key) known.set(l.key, l.id); if (l.wa_template_name) known.set(l.wa_template_name, l.id); }
  let imported = 0;
  for (const r of remote) {
    const existing = known.get(r.name);
    const reason = r.rejected_reason && r.rejected_reason !== 'NONE' ? r.rejected_reason : null;
    if (existing) {
      await update('message_templates', existing, { wa_status: r.status, wa_template_id: r.id, wa_template_name: r.name, wa_rejected_reason: reason, wa_category: r.category ?? null });
    } else {
      const part = (type: string) => (r.components ?? []).find((c: any) => c.type === type)?.text ?? null;
      const body = part('BODY');
      if (!body) continue;
      await insert('message_templates', {
        name: r.name.replace(/_/g, ' '), body, header: part('HEADER'), footer: part('FOOTER'), category: r.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
        language: r.language, wa_template_name: r.name, wa_template_id: r.id, wa_status: r.status, wa_rejected_reason: reason, wa_category: r.category ?? null,
      });
      imported++;
    }
  }
  return { checked: remote.length, imported };
});

route('POST', '/comms/templates/:id/submit', 'comms', async ({ params }) => {
  const cfg = await requireWaba();
  const t = await one<any>('SELECT * FROM message_templates WHERE id=$1', [params.id]);
  if (!t) throw notFound('Template not found');
  if (t.wa_template_id && t.wa_status !== 'REJECTED') throw bad('This template has already been sent to WhatsApp');
  validateForMeta(t);
  // A rejected template gets a new name, because WhatsApp will not reuse the old one straight away.
  // Library templates go to Meta under their exact name; other templates get a name made from theirs.
  const base = t.key && /^[a-z0-9_]+$/.test(t.key) ? t.key : templateSlug(t.name, t.id);
  const slug = t.wa_status === 'REJECTED' ? `${base}_${Date.now().toString(36)}` : base;
  const r = await submitTemplate(cfg, t, slug);
  return update('message_templates', t.id, { wa_template_name: slug, wa_template_id: r.id, wa_status: r.status ?? 'PENDING', wa_rejected_reason: null, wa_category: r.category ?? null });
});

route('DELETE', '/comms/templates/:id', 'comms', async ({ params }) => {
  const t = await one<any>('SELECT * FROM message_templates WHERE id=$1', [params.id]);
  if (!t) throw notFound('Template not found');
  if (t.key) throw bad('Built-in templates are used by automatic reminders and cannot be deleted');
  if (t.wa_template_name) await deleteSubmittedTemplate(await requireWaba(), t.wa_template_name);
  await q('DELETE FROM message_templates WHERE id=$1', [params.id]);
});

/* ---------- WhatsApp Business connection ---------- */

function webhookUrl(req: Request) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  return `https://${host}/api/whatsapp/webhook`;
}

async function connectionView(req: Request) {
  const row = (await one<any>('SELECT * FROM whatsapp_settings'))!;
  return {
    connected: !!row.access_token_enc, phone_number_id: row.phone_number_id, waba_id: row.waba_id,
    display_phone: row.display_phone, verified_name: row.verified_name, quality_rating: row.quality_rating, connected_at: row.connected_at,
    has_app_secret: !!row.app_secret_enc, verify_token: row.verify_token, webhook_url: webhookUrl(req),
  };
}

route('GET', '/comms/whatsapp', 'comms', async ({ req }) => connectionView(req));

/**
 * Usage and limits for the WhatsApp number. Meta does not let apps read the prepaid balance, so this shows what is available:
 * the number's quality and daily limit from Meta, how many messages this app sent, and whether Meta recently refused
 * messages because the balance had run out (error 131042), which is the sign that credit needs adding.
 */
// Meta's answer about the number changes slowly, so it is reused for this long before asking again.
const LIVE_TTL = 10 * 60_000;

route('GET', '/comms/whatsapp/status', 'comms', async ({ query }) => {
  const cfg = await waConfig();
  if (!cfg) return { connected: false };
  // The quality and limit come from the saved copy while it is fresh; the Refresh button (?refresh=1) always asks Meta.
  const saved = await one<any>('SELECT wa_live, wa_live_at FROM whatsapp_settings');
  let live: { quality_rating: string | null; tier: string | null; limit: number | null } | null = saved?.wa_live ?? null;
  let liveAt: string | null = saved?.wa_live_at ?? null;
  let error: string | null = null;
  const age = liveAt ? Date.now() - new Date(liveAt).getTime() : Infinity;
  if (query.get('refresh') === '1' || !live || age > LIVE_TTL) {
    try {
      live = await liveNumberStatus(cfg);
      liveAt = new Date().toISOString();
      await q('UPDATE whatsapp_settings SET wa_live=$1, wa_live_at=now()', [JSON.stringify(live)]);
    } catch (e: any) {
      error = String(e.message); // the saved copy, if any, is still shown
    }
  }
  const usage = await one<any>(`SELECT
      count(*) FILTER (WHERE sent_at > now() - interval '24 hours') sent_24h,
      count(*) FILTER (WHERE date_trunc('month', sent_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', gym_today()::timestamp)) sent_month,
      count(*) FILTER (WHERE sent_at AT TIME ZONE 'Asia/Kolkata' >= gym_today()) sent_today
    FROM messages WHERE channel='whatsapp' AND status='sent' AND wa_message_id IS NOT NULL`);
  const refused = await one<any>(`SELECT count(*) n, max(created_at) last_at FROM messages WHERE channel='whatsapp' AND status='failed' AND error LIKE '%131042%' AND created_at > now() - interval '7 days'`);
  return {
    connected: true, quality_rating: live?.quality_rating ?? null, tier: live?.tier ?? null, limit: live?.limit ?? null, live_at: liveAt, error,
    ...usage, refused_count: refused?.n ?? 0, refused_last_at: refused?.last_at ?? null, billing_url: 'https://business.facebook.com/billing_hub',
  };
});

/** What WhatsApp charged, month by month, as read from Meta and kept as history. */
route('GET', '/comms/whatsapp/costs', 'comms', async () => {
  const [rows, state] = await Promise.all([costHistory(), one<any>('SELECT costs_synced_at, costs_error FROM whatsapp_settings')]);
  return { rows, synced_at: state?.costs_synced_at ?? null, error: state?.costs_error ?? null };
});

route('POST', '/comms/whatsapp/costs/sync', 'comms', async () => {
  const r = await syncWhatsAppCosts();
  if (!r) throw bad('Connect your WhatsApp Business account first (WhatsApp setup tab)');
  if (r.error) throw bad(`Could not read costs from Meta. ${r.error}`);
  return r;
});

route('PUT', '/comms/whatsapp', 'settings', async ({ body, req, user }) => {
  const v = parse(z.object({
    phone_number_id: z.string().trim().regex(/^\d{5,30}$/, 'must contain only numbers'),
    waba_id: z.string().trim().regex(/^\d{5,30}$/, 'must contain only numbers'),
    access_token: s.text, app_secret: s.text,
  }), body);
  const row = (await one<any>('SELECT * FROM whatsapp_settings'))!;
  let token = v.access_token;
  if (!token) {
    if (!row.access_token_enc) throw bad('Please fill in: access token');
    token = (await waConfig())!.token;
  }
  let info;
  try { info = await verifyConnection(v.phone_number_id, v.waba_id, token); } catch (e: any) { throw bad(`Could not connect. ${e.message}`); }
  await update('whatsapp_settings', user.gym_id, {
    phone_number_id: v.phone_number_id, waba_id: v.waba_id, ...info, connected_at: new Date(),
    access_token_enc: encrypt(token), ...(v.app_secret ? { app_secret_enc: encrypt(v.app_secret) } : {}),
  });
  return connectionView(req);
});

route('DELETE', '/comms/whatsapp', 'settings', async ({ user }) => {
  await update('whatsapp_settings', user.gym_id, { phone_number_id: null, waba_id: null, access_token_enc: null, app_secret_enc: null, display_phone: null, verified_name: null, quality_rating: null, connected_at: null });
});

/** Optional daily trigger. Reminders are also created whenever the owner opens the app. */
route('GET', '/cron/reminders', 'public', async ({ req }) => {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get('authorization') !== `Bearer ${expected}`) throw notFound();
  // Each gym runs on its own, so one gym's problem does not stop the others' reminders.
  const gyms = await q<{ id: number }>('SELECT id FROM gyms WHERE active ORDER BY id');
  const results: Record<number, unknown> = {};
  for (const g of gyms) {
    results[g.id] = await asTenant(g.id, null, () => runAutomations()).catch((e) => ({ error: String(e?.message ?? e) }));
  }
  return { gyms: gyms.length, results };
});
