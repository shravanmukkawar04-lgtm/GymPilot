// Shop and stock reports (Reports page). Both take ?from=YYYY-MM-DD&to=YYYY-MM-DD (India dates, both days included).
// They run inside the gym and branch scope like every other route, so an owner sees the branch on screen or all branches.
import { one, q } from '../db';
import { bad, route } from './router';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The date range from the URL. Without one, this month so far. */
async function range(query: URLSearchParams) {
  const from = query.get('from') || null, to = query.get('to') || null;
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) throw bad('Choose valid dates');
  const r = (await one<{ from: string; to: string }>(
    `SELECT COALESCE($1::date, date_trunc('month', gym_today()::timestamp)::date) AS "from", COALESCE($2::date, gym_today()) AS "to"`, [from, to]))!;
  if (r.from > r.to) throw bad('The start date is after the end date');
  return r;
}

// Every product line sold in the period, on bills that were not cancelled.
// Prices on a bill are fixed when it is made. The buying price is the product's current one (sales do not record it),
// so profit here is an estimate.
const SOLD = `
  SELECT i.id invoice_id, i.invoice_no, i.invoice_date, i.customer_name, u.name given_by,
         ii.ref_id product_id, ii.description, ii.qty, ii.qty * ii.rate gross, ii.discount, ii.taxable, ii.cgst + ii.sgst gst, ii.amount,
         ii.qty * COALESCE(p.cost_price, 0) cost
  FROM invoice_items ii
  JOIN invoices i ON i.id = ii.invoice_id
  LEFT JOIN products p ON p.id = ii.ref_id
  LEFT JOIN users u ON u.id = i.created_by
  WHERE ii.item_type = 'product' AND i.status <> 'cancelled' AND i.invoice_date BETWEEN $1::date AND $2::date`;

export async function shopReport(query: URLSearchParams) {
  const { from, to } = await range(query);
  const p = [from, to];
  const [summary, products, days, discounts] = await Promise.all([
    one(`WITH l AS (${SOLD}) SELECT count(DISTINCT invoice_id) bills, COALESCE(sum(qty),0) units, COALESCE(sum(gross),0) gross, COALESCE(sum(discount),0) discount,
           COALESCE(sum(taxable),0) net_sales, COALESCE(sum(gst),0) gst, COALESCE(sum(amount),0) total, COALESCE(sum(cost),0) cost,
           COALESCE(sum(taxable) - sum(cost),0) profit, count(DISTINCT invoice_id) FILTER (WHERE discount > 0) discounted_bills FROM l`, p),
    q(`WITH l AS (${SOLD}) SELECT product_id, max(description) name, sum(qty) units, sum(gross) gross, sum(discount) discount, sum(taxable) net_sales,
           sum(cost) cost, sum(taxable) - sum(cost) profit FROM l GROUP BY product_id ORDER BY sum(taxable) DESC`, p),
    q(`WITH l AS (${SOLD}) SELECT invoice_date, count(DISTINCT invoice_id) bills, sum(qty) units, sum(gross) gross, sum(discount) discount,
           sum(taxable) net_sales, sum(gst) gst, sum(amount) total FROM l GROUP BY invoice_date ORDER BY invoice_date DESC`, p),
    q(`WITH l AS (${SOLD}) SELECT invoice_id id, max(invoice_no) invoice_no, invoice_date, max(customer_name) customer_name, max(given_by) given_by,
           sum(gross) gross, sum(discount) discount, round(sum(discount) / NULLIF(sum(gross), 0) * 100, 1) pct, sum(amount) total
         FROM l GROUP BY invoice_id, invoice_date HAVING sum(discount) > 0 ORDER BY invoice_date DESC, invoice_id DESC`, p),
  ]);
  return { from, to, summary, products, days, discounts };
}

export async function stockReport(query: URLSearchParams) {
  const { from, to } = await range(query);
  const p = [from, to];
  // The period in India time: from 00:00 on the first day up to (not including) 00:00 after the last day.
  const R = `r AS (SELECT $1::date::timestamp AT TIME ZONE 'Asia/Kolkata' s, ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' e)`;
  const [now, flow, moves, purchases] = await Promise.all([
    q(`SELECT id, name, category, unit, stock, cost_price, sale_price, reorder_level, supplier, stock * cost_price value_cost, stock * sale_price value_sale,
         stock <= reorder_level AS low FROM products WHERE active ORDER BY name`),
    // Opening and closing are worked back from today's stock using the stock history, so they always agree with the Stock tab.
    q(`WITH ${R} SELECT p.id product_id, p.name, p.unit,
         p.stock - COALESCE(sum(m.qty) FILTER (WHERE m.created_at >= r.e), 0)
                 - COALESCE(sum(m.qty) FILTER (WHERE m.created_at >= r.s AND m.created_at < r.e), 0) opening,
         COALESCE(sum(m.qty) FILTER (WHERE m.created_at >= r.s AND m.created_at < r.e AND m.type = 'purchase'), 0) bought,
         -COALESCE(sum(m.qty) FILTER (WHERE m.created_at >= r.s AND m.created_at < r.e AND m.type = 'sale'), 0) sold,
         COALESCE(sum(m.qty) FILTER (WHERE m.created_at >= r.s AND m.created_at < r.e AND m.type = 'return'), 0) returns,
         -COALESCE(sum(m.qty) FILTER (WHERE m.created_at >= r.s AND m.created_at < r.e AND m.type = 'damage'), 0) damaged,
         COALESCE(sum(m.qty) FILTER (WHERE m.created_at >= r.s AND m.created_at < r.e AND m.type NOT IN ('purchase','sale','return','damage')), 0) adjusted,
         p.stock - COALESCE(sum(m.qty) FILTER (WHERE m.created_at >= r.e), 0) closing
       FROM products p CROSS JOIN r LEFT JOIN stock_movements m ON m.product_id = p.id
       WHERE p.active GROUP BY p.id, p.name, p.unit, p.stock, r.s, r.e ORDER BY p.name`, p),
    q(`WITH ${R} SELECT m.id, m.created_at, p.name product_name, p.unit, m.type, m.qty, m.unit_cost, m.note
       FROM stock_movements m JOIN products p ON p.id = m.product_id CROSS JOIN r
       WHERE m.created_at >= r.s AND m.created_at < r.e ORDER BY m.id DESC LIMIT 1000`, p),
    one(`SELECT count(*) bills, COALESCE(sum(total),0) total FROM purchases WHERE status <> 'cancelled' AND purchase_date BETWEEN $1::date AND $2::date`, p),
  ]);
  const sum = (k: string) => now.reduce((a: number, r: any) => a + Number(r[k]), 0);
  return {
    from, to, items: now, flow, moves, purchases,
    summary: {
      products: now.length, value_cost: sum('value_cost'), value_sale: sum('value_sale'),
      low: now.filter((r: any) => r.low && r.stock > 0).length, out: now.filter((r: any) => r.stock <= 0).length,
    },
  };
}

route('GET', '/reports/shop', 'reports', async ({ query }) => shopReport(query));
route('GET', '/reports/stock', 'reports', async ({ query }) => stockReport(query));
