import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { one } from '../db';
import { bad } from '../api/router';

/** WhatsApp Business Platform (Cloud API). */
const GRAPH = () => process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v24.0';

/* ---------- Secrets are stored encrypted ---------- */

const key = () => createHash('sha256').update(process.env.JWT_SECRET || '').digest();

export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(stored: string) {
  const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

export type WaConfig = { token: string; phone_id: string; waba_id: string | null };

/**
 * The current gym's WhatsApp Business connection. Each gym connects its own number on the
 * WhatsApp setup tab; there is deliberately no site-wide .env fallback, which would make
 * every gym send from the same number.
 */
export async function waConfig(): Promise<WaConfig | null> {
  const row = await one<any>('SELECT * FROM whatsapp_settings');
  if (row?.access_token_enc && row.phone_number_id) {
    return { token: decrypt(row.access_token_enc), phone_id: row.phone_number_id, waba_id: row.waba_id };
  }
  return null;
}

async function graph(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${GRAPH()}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000), // a slow Meta answer should not hang the screen
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new Error(`WhatsApp: ${e.error_user_msg || e.error_data?.details || e.message || `error ${res.status}`}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return data;
}

export async function verifyConnection(phoneId: string, wabaId: string, token: string) {
  const info = await graph(`/${phoneId}?fields=display_phone_number,verified_name,quality_rating`, token);
  await graph(`/${wabaId}/message_templates?limit=1&fields=name`, token);
  return { display_phone: info.display_phone_number as string, verified_name: info.verified_name as string, quality_rating: (info.quality_rating ?? null) as string | null };
}

/**
 * What Meta tells us about the number right now: quality and how many people it may message in 24 hours.
 * Meta has no way to read the prepaid credit balance through the API, so the balance itself is not here.
 */
export async function liveNumberStatus(cfg: WaConfig) {
  const info = await graph(`/${cfg.phone_id}?fields=quality_rating,messaging_limit_tier`, cfg.token)
    // An account that does not offer the limit field still answers for quality.
    .catch(() => graph(`/${cfg.phone_id}?fields=quality_rating`, cfg.token));
  const tier = (info.messaging_limit_tier ?? null) as string | null;
  const limit = tier === 'TIER_UNLIMITED' ? null : Number((tier ?? '').match(/^TIER_(\d+)(K)?$/)?.[1] ?? 0) * (tier?.endsWith('K') ? 1000 : 1) || null;
  return { quality_rating: (info.quality_rating ?? null) as string | null, tier, limit };
}

/**
 * Meta's pricing report: what messages cost, per day and category, between two moments (unix seconds).
 * The currency is the account's own. Meta can take a day to settle the latest numbers.
 */
export async function fetchPricing(cfg: WaConfig, startUnix: number, endUnix: number) {
  const fields = `currency,pricing_analytics.start(${startUnix}).end(${endUnix}).granularity(DAILY).dimensions(["PRICING_CATEGORY"])`;
  const res = await fetch(`${GRAPH()}/${cfg.waba_id}?fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new Error(`WhatsApp: ${e.error_user_msg || e.message || `error ${res.status}`}${e.code ? ` (code ${e.code})` : ''}`);
  }
  const points: { start: number; category: string; volume: number; cost: number }[] = [];
  for (const block of data.pricing_analytics?.data ?? []) {
    for (const p of block.data_points ?? []) {
      points.push({ start: Number(p.start), category: String(p.pricing_category ?? 'other').toLowerCase(), volume: Number(p.volume ?? 0), cost: Number(p.cost ?? 0) });
    }
  }
  return { currency: (data.currency ?? null) as string | null, points };
}

/* ---------- Templates ---------- */

const VAR = /\{\{\s*(\w+)\s*\}\}/g;

const SAMPLES: Record<string, string> = {
  name: 'Rahul Sharma', plan: 'Premium Annual', package: 'Premium Annual', gym_name: 'ABC Fitness Club',
  expiry_date: '07 Sep 2026', start_date: '01 Sep 2026', days_left: '7', due_date: '15 Sep 2026', resume_date: '15 Sep 2026',
  total_fee: '₹15,000', paid_amount: '₹10,000', amount_due: '₹5,000', due_amount: '₹5,000', payment_method: 'UPI',
  contact_phone: '+91 98765 43210', contact_email: 'info@abcfitness.com',
  receipt_no: 'REC-2026-00125', previously_paid: '₹5,000', payment_received: '₹5,000', outstanding_balance: '₹5,000', payment_date: '31 Aug 2026',
  username: 'rahul.sharma', login_url: 'https://abcgym.example.com',
  bill_no: 'BILL-1025', invoice_no: 'INV-2026-1025', purchase_date: '31 Aug 2026', products: 'Whey Protein, Shaker', total_amount: '₹4,500', discount: '₹500',
  payable_amount: '₹4,000', pos_paid_amount: '₹4,000', pos_payment_method: 'UPI', remaining_amount: '₹0', outstanding_amount: '₹1,000',
  addon_package: 'Personal Training', addon_total_fee: '₹5,000', addon_paid_amount: '₹3,000', addon_payment_method: 'UPI', addon_amount_due: '₹2,000',
  addon_start_date: '01 Sep 2026', addon_expiry_date: '30 Sep 2026', addon_days_left: '5',
  employee_id: 'EMP-1025', department: 'Fitness', designation: 'Personal Trainer', joining_date: '01 Sep 2026',
  holiday_name: 'Diwali', holiday_date: '8 Nov 2026', reopen_date: '10 Nov 2026', open_time: '7 AM', close_time: '12 PM',
};

/** WhatsApp wants numbered blanks. Each {{name}} becomes {{1}}, {{2}} and so on, in order. */
export function toMetaBody(body: string) {
  const vars: string[] = [];
  const text = body.replace(VAR, (_, v) => { vars.push(v); return `{{${vars.length}}}`; });
  return { text, vars };
}

export function validateForMeta(t: { body: string; header?: string | null; footer?: string | null }) {
  const body = t.body.trim();
  if (body.length > 1024) throw bad('The message must be 1024 characters or fewer for WhatsApp');
  if (/^\{\{/.test(body)) throw bad('WhatsApp does not allow a message to start with a blank like {{name}}. Add a word before it, like "Dear".');
  if (/\}\}$/.test(body)) throw bad('WhatsApp does not allow a message to end with a blank. Add a word or full stop after it.');
  if (/\}\}\s*\{\{/.test(body)) throw bad('WhatsApp does not allow two blanks side by side. Add a word between them.');
  if (t.header && t.header.length > 60) throw bad('The heading must be 60 characters or fewer');
  if (t.header && /[{}]/.test(t.header)) throw bad('The heading cannot contain blanks');
  if (t.footer && t.footer.length > 60) throw bad('The footer must be 60 characters or fewer');
  if (t.footer && /[{}]/.test(t.footer)) throw bad('The footer cannot contain blanks');
}

function components(t: any) {
  const { text, vars } = toMetaBody(t.body.trim());
  return [
    ...(t.header ? [{ type: 'HEADER', format: 'TEXT', text: t.header }] : []),
    { type: 'BODY', text, ...(vars.length ? { example: { body_text: [vars.map((v) => SAMPLES[v] ?? 'Sample')] } } : {}) },
    ...(t.footer ? [{ type: 'FOOTER', text: t.footer }] : []),
  ];
}

export const templateSlug = (name: string, id: number) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'template'}_${id}`;

export async function submitTemplate(cfg: WaConfig, t: any, slug: string) {
  return graph(`/${cfg.waba_id}/message_templates`, cfg.token, {
    method: 'POST',
    body: { name: slug, language: t.language, category: t.category, components: components(t) },
  }) as Promise<{ id: string; status: string; category: string }>;
}

export const editSubmittedTemplate = (cfg: WaConfig, t: any) =>
  graph(`/${t.wa_template_id}`, cfg.token, { method: 'POST', body: { components: components(t) } });

export const deleteSubmittedTemplate = (cfg: WaConfig, name: string) =>
  graph(`/${cfg.waba_id}/message_templates?name=${encodeURIComponent(name)}`, cfg.token, { method: 'DELETE' });

export async function listRemoteTemplates(cfg: WaConfig) {
  const rows: any[] = [];
  let path: string | null = `/${cfg.waba_id}/message_templates?limit=100&fields=id,name,status,category,language,rejected_reason,components`;
  for (let page = 0; path && page < 10; page++) {
    const r: any = await graph(path, cfg.token);
    rows.push(...(r.data ?? []));
    const after: string | undefined = r.paging?.next ? r.paging?.cursors?.after : undefined;
    path = after ? `/${cfg.waba_id}/message_templates?limit=100&fields=id,name,status,category,language,rejected_reason,components&after=${after}` : null;
  }
  return rows;
}

/* ---------- Sending ---------- */

/** WhatsApp rejects blanks containing line breaks, tabs or long runs of spaces. */
const cleanParam = (v: string) => v.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-';

export async function sendTemplate(cfg: WaConfig, m: { to: string; name: string; language: string; params: string[] }) {
  const r = await graph(`/${cfg.phone_id}/messages`, cfg.token, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp', to: m.to, type: 'template',
      template: {
        name: m.name, language: { code: m.language },
        ...(m.params.length ? { components: [{ type: 'body', parameters: m.params.map((p) => ({ type: 'text', text: cleanParam(p) })) }] } : {}),
      },
    },
  });
  return (r.messages?.[0]?.id ?? '') as string;
}
