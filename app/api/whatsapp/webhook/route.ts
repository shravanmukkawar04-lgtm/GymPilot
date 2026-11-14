import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { asTenant, one, q } from '@/lib/db';
import { decrypt } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

/**
 * One webhook address serves every gym. Meta's verify call is matched to a gym by its
 * verify token, and each event by the phone number id it was sent to.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = p.get('hub.verify_token');
  const row = token ? await one<any>('SELECT 1 FROM whatsapp_settings WHERE verify_token=$1', [token]) : null;
  if (p.get('hub.mode') === 'subscribe' && row) {
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
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }

  // Group the changes by the business number they belong to.
  const byPhone = new Map<string, any[]>();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneId = change.value?.metadata?.phone_number_id;
      if (phoneId) byPhone.set(String(phoneId), [...(byPhone.get(String(phoneId)) ?? []), change.value]);
    }
  }
  if (!byPhone.size) return new Response('OK');

  for (const [phoneId, values] of byPhone) {
    const gym = await one<any>(
      `SELECT w.gym_id, w.app_secret_enc FROM whatsapp_settings w JOIN gyms g ON g.id=w.gym_id WHERE w.phone_number_id=$1 AND g.active`, [phoneId]);
    // Every gym's events are signed with that gym's own Meta App Secret.
    if (!gym?.app_secret_enc || !validSignature(raw, req.headers.get('x-hub-signature-256'), decrypt(gym.app_secret_enc))) {
      return new Response('Invalid signature', { status: 401 });
    }
    await asTenant(gym.gym_id, null, async () => {
      for (const value of values) {
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
    });
  }
  return new Response('OK');
}
