import { z } from 'zod';

export const text = z.string().trim().nullish();
export const reqText = z.string().trim().min(1, 'is required');
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'is not a valid date').nullish();
export const reqDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'is not a valid date');
export const money = z.coerce.number().min(0, 'cannot be negative').max(99999999);
export const moneyOpt = money.nullish();
export const int = z.coerce.number().int().min(0, 'cannot be negative');
export const id = z.coerce.number().int().positive();
export const idOpt = id.nullish();
export const phone = z.string().trim().regex(/^[+\d][\d\s-]{6,16}$/, 'is not a valid phone number');
export const phoneOpt = phone.nullish();
export const email = z.string().trim().email('is not a valid email').nullish();
export const method = z.enum(['cash', 'upi', 'card', 'bank']);
export const bool = z.boolean().optional();
export const deviceId = z.union([z.string().trim(), z.number().transform(String)]).nullish();
export const loginEmail = z.string().trim().toLowerCase().email('is not a valid email');
export const password = z.string().min(8, 'must be at least 8 characters');

/** A photo taken or chosen in the browser: a data URL, null to remove it, or left out to keep it. */
export const photo = z.string().max(700_000, 'is too large. Please use a smaller photo.').nullish();

const onePayment = z.object({ amount: money, method: method.default('cash'), reference: text, paid_on: date });
/** One payment, or several (for example part cash and part UPI). Always comes out as a list. */
export const payment = z.union([onePayment, z.array(onePayment).max(4)]).nullish()
  .transform((v) => (v ? (Array.isArray(v) ? v : [v]) : []).filter((p) => p.amount > 0));

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** Accepts 2026-03-25, 25-03-2026, 25/03/2026, 25.03.2026 and 25 Mar 2026, as old systems and Excel write them. */
export function toIsoDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let y: string, m: string, d: string;
  let x = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (x) [, y, m, d] = x;
  else if ((x = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [, d, m, y] = x;
  else if ((x = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{4})$/)) && MONTHS[x[2].toLowerCase()]) { [, d, , y] = x; m = MONTHS[x[2].toLowerCase()]; }
  else return 'invalid';
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? 'invalid' : iso;
}

export const looseDate = z.string().nullish().transform((v, ctx) => {
  const iso = toIsoDate(v);
  if (iso === 'invalid') { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'is not a valid date' }); return z.NEVER; }
  return iso;
});
