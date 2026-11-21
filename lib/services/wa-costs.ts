import { one, q } from '../db';
import { fetchPricing, waConfig } from './whatsapp';

const HOUR = 3600_000;
// Cost figures change slowly and Meta settles them over a day or two, so the saved copy is reused this long.
// The Refresh button on the Messages page reads Meta straight away.
const COST_TTL = 3 * 24 * HOUR;

/** The India date of a moment, so a day's cost is filed under the gym's own calendar. */
const istDay = (unix: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(unix * 1000));

/**
 * Reads the last 45 days of cost from Meta and saves each day and category. A day is written again each time,
 * so Meta's later corrections replace the earlier figures, while older days stay as history.
 * Returns null when WhatsApp Business is not connected.
 */
export async function syncWhatsAppCosts() {
  const cfg = await waConfig();
  if (!cfg?.waba_id) return null;
  const end = Math.floor(Date.now() / 1000);
  // Start at midnight (India) 45 days back.
  const startDay = istDay(end - 45 * 86400);
  const start = Math.floor(Date.parse(`${startDay}T00:00:00+05:30`) / 1000);
  try {
    const r = await fetchPricing(cfg, start, end);
    // Several buckets can share a day and category (for example by price tier), so add them up first.
    const sums = new Map<string, { day: string; category: string; volume: number; cost: number }>();
    for (const p of r.points) {
      const day = istDay(p.start), key = `${day}|${p.category}`;
      const cur = sums.get(key) ?? { day, category: p.category, volume: 0, cost: 0 };
      cur.volume += p.volume; cur.cost += p.cost;
      sums.set(key, cur);
    }
    // The report covers the whole window, so days Meta now lists with nothing are cleared and the rest rewritten.
    await q('DELETE FROM whatsapp_costs WHERE day >= $1::date', [startDay]);
    for (const x of sums.values()) {
      await q(`INSERT INTO whatsapp_costs (day, category, volume, cost, currency) VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (gym_id, day, category) DO UPDATE SET volume=EXCLUDED.volume, cost=EXCLUDED.cost, currency=EXCLUDED.currency, synced_at=now()`,
        [x.day, x.category, x.volume, x.cost, r.currency]);
    }
    await q(`UPDATE whatsapp_settings SET costs_synced_at=now(), costs_tried_at=now(), costs_error=NULL`);
    return { days: sums.size, error: null as string | null };
  } catch (e: any) {
    const error = String(e.message ?? e).slice(0, 300);
    await q(`UPDATE whatsapp_settings SET costs_tried_at=now(), costs_error=$1`, [error]);
    return { days: 0, error };
  }
}

/** Used when the owner opens the dashboard: reads Meta again only when the saved costs are 3 days old (hourly after an error), so it never slows each visit. */
export async function syncWhatsAppCostsIfStale() {
  const row = await one<{ costs_tried_at: string | null; costs_error: string | null; connected: boolean }>(
    `SELECT costs_tried_at, costs_error, access_token_enc IS NOT NULL AS connected FROM whatsapp_settings`);
  if (!row?.connected) return;
  const age = row.costs_tried_at ? Date.now() - new Date(row.costs_tried_at).getTime() : Infinity;
  if (age < (row.costs_error ? HOUR : COST_TTL)) return;
  await syncWhatsAppCosts();
}

/** Cost per month and category for the last six months, newest first, for the history table. */
export const costHistory = () => q(`
  SELECT to_char(date_trunc('month', day), 'YYYY-MM') AS month, category, sum(volume)::int AS volume, sum(cost) AS cost, max(currency) AS currency
  FROM whatsapp_costs WHERE day >= (date_trunc('month', gym_today()::timestamp) - interval '5 months')::date
  GROUP BY 1, 2 ORDER BY 1 DESC, 2`);
