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

export const payment = z.object({
  amount: money, method: method.default('cash'), reference: text, paid_on: date,
}).nullish();
