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

export async function waConfig(): Promise<WaConfig | null> {
  const row = await one<any>('SELECT * FROM whatsapp_settings WHERE id=1');
  if (row?.access_token_enc && row.phone_number_id) {
    return { token: decrypt(row.access_token_enc), phone_id: row.phone_number_id, waba_id: row.waba_id };
  }
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
    return { token: process.env.WHATSAPP_TOKEN, phone_id: process.env.WHATSAPP_PHONE_ID, waba_id: process.env.WHATSAPP_WABA_ID || null };
  }
  return null;
}

async function graph(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${GRAPH()}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
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

/* ---------- Templates ---------- */

const VAR = /\{\{\s*(\w+)\s*\}\}/g;

const SAMPLES: Record<string, string> = {
  name: 'Rohan', plan: 'Quarterly', expiry_date: '25-12-2026', due_amount: '1500', gym_name: 'Iron Temple Fitness',
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
