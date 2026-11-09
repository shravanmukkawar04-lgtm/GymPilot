import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { one, q } from '@/lib/db';
import { decrypt } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

/** Meta calls this once to confirm the URL belongs to us. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const row = await one<any>('SELECT verify_token FROM whatsapp_settings WHERE id=1');
  if (p.get('hub.mode') === 'subscribe' && row && p.get('hub.verify_token') === row.verify_token) {
    return new Response(p.get('hub.challenge') ?? '', { headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/** Delivery reports and replies. Members who reply STOP are removed from bulk messages. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const row = await one<any>('SELECT app_secret_enc FROM whatsapp_settings WHERE id=1');
  if (!row?.app_secret_enc || !validSignature(raw, req.headers.get('x-hub-signature-256'), decrypt(row.app_secret_enc))) {
    return new Response('Invalid signature', { status: 401 });
  }
  const payload = JSON.parse(raw);
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const st of value.statuses ?? []) {
        if (st.status === 'failed') {
          const reason = st.errors?.[0]?.error_data?.details || st.errors?.[0]?.title || 'WhatsApp could not deliver this message';
          await q(`UPDATE messages SET status='failed', delivery_status='failed', error=$2 WHERE wa_message_id=$1`, [st.id, String(reason).slice(0, 500)]);
        } else if (RANK[st.status]) {
          // Reports can arrive out of order, so a later state is never overwritten by an earlier one.
          const lower = Object.keys(RANK).filter((k) => RANK[k] < RANK[st.status]);
          await q(`UPDATE messages SET delivery_status=$2 WHERE wa_message_id=$1 AND (delivery_status IS NULL OR delivery_status = ANY($3))`, [st.id, st.status, lower]);
        }
      }
      for (const m of value.messages ?? []) {
        if (m.type === 'text' && /^\s*stop\s*$/i.test(m.text?.body ?? '')) {
          await q(`UPDATE members SET whatsapp_opt_out=true WHERE right(regexp_replace(phone,'\\D','','g'),10) = right($1,10)`, [String(m.from)]);
        }
      }
    }
  }
  return new Response('OK');
}
