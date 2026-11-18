'use client';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { downloadCsv, fmtDate, fmtDateTime, inr, todayIST, useApi } from '@/lib/client';
import { Badge, Button, Card, Empty, ErrorNote, Loading, Stat, Table } from './ui';

/* ---------- Date range (India dates) ---------- */

const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

function presets() {
  const today = todayIST();
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shift(monthStart, -1);
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Last 7 days', from: shift(today, -6), to: today },
    { label: 'This month', from: monthStart, to: today },
    { label: 'Last month', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { label: 'Last 30 days', from: shift(today, -29), to: today },
  ];
}

function RangePicker({ from, to, setRange }: { from: string; to: string; setRange: (from: string, to: string) => void }) {
  const list = presets();
  const active = list.find((p) => p.from === from && p.to === to)?.label;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <input className="input !w-auto" type="date" value={from} max={to} onChange={(e) => e.target.value && setRange(e.target.value, to)} aria-label="From" />
      <span className="text-muted">to</span>
      <input className="input !w-auto" type="date" value={to} min={from} onChange={(e) => e.target.value && setRange(from, e.target.value)} aria-label="To" />
      <div className="flex flex-wrap gap-1.5">
        {list.map((p) => <Button key={p.label} size="sm" variant={p.label === active ? 'primary' : 'secondary'} onClick={() => setRange(p.from, p.to)}>{p.label}</Button>)}
      </div>
    </div>
  );
}

const useRange = () => {
  const [r, set] = useState(() => ({ from: `${todayIST().slice(0, 8)}01`, to: todayIST() }));
  return { ...r, setRange: (from: string, to: string) => set({ from, to }) };
};

const csv = (name: string, rows: Record<string, unknown>[]) => (
  <Button size="sm" onClick={() => downloadCsv(name, rows)} disabled={!rows.length}><Download /> Excel (CSV)</Button>
);
const name = (base: string, from: string, to: string) => `${base}-${from}-to-${to}`;
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—');
const num = (v: any) => Number(v) || 0;
const right = { align: 'right' as const };

/* ---------- Shop sales ---------- */

export function ShopReport() {
  const { from, to, setRange } = useRange();
  const { data, error, reload } = useApi<any>(`/reports/shop?from=${from}&to=${to}`);
  if (error) return <ErrorNote message={error} retry={reload} />;
  const head = <RangePicker from={from} to={to} setRange={setRange} />;
  // While new dates load, keep showing the old numbers rather than flashing an empty page.
  if (!data) return <>{head}<Loading /></>;
  const { summary: s, products, days, discounts } = data;
  const margin = pct(num(s.profit), num(s.net_sales));

  return (
    <>
      {head}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Sales (after discount)" value={inr(s.net_sales)} hint={`${s.bills} bills · ${num(s.units)} items sold`} />
        <Stat label="Discount given" value={inr(s.discount)} tone={num(s.discount) > 0 ? 'amber' : undefined} hint={`${s.discounted_bills} of ${s.bills} bills · ${pct(num(s.discount), num(s.gross))} of price`} />
        <Stat label="Estimated profit" value={inr(s.profit)} tone={num(s.profit) < 0 ? 'red' : undefined} hint={`${margin} margin`} />
        <Stat label="Billed to customers" value={inr(s.total)} hint={num(s.gst) > 0 ? `includes GST ${inr(s.gst)}` : undefined} />
      </div>
      <p className="text-muted text-[13px] mb-4">
        Sales are the product bills in this period, not counting cancelled ones, and are shown without GST. Profit is sales minus the product’s current buying price, so it is an estimate if prices changed.
      </p>

      <div className="grid gap-4">
        <Card pad={false} title="Sales by product" subtitle="Best sellers first" action={csv(name('shop-sales-by-product', from, to), products.map((r: any) => ({
          Product: r.name, 'Items sold': num(r.units), 'Price before discount': num(r.gross), Discount: num(r.discount), 'Sales after discount': num(r.net_sales), Cost: num(r.cost), 'Estimated profit': num(r.profit),
        })))}>
          <Table rows={products} empty={<Empty title="No sales in this period" />} cols={[
            { key: 'name', label: 'Product', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
            { key: 'units', label: 'Sold', ...right, render: (r) => num(r.units) },
            { key: 'gross', label: 'Before discount', ...right, render: (r) => inr(r.gross) },
            { key: 'discount', label: 'Discount', ...right, render: (r) => (num(r.discount) > 0 ? inr(r.discount) : '—') },
            { key: 'net_sales', label: 'Sales', ...right, render: (r) => <span className="font-medium text-ink">{inr(r.net_sales)}</span> },
            { key: 'profit', label: 'Profit', ...right, render: (r) => <span className={num(r.profit) < 0 ? 'text-rose' : ''}>{inr(r.profit)}</span> },
            { key: 'margin', label: 'Margin', ...right, render: (r) => pct(num(r.profit), num(r.net_sales)) },
          ]} />
        </Card>

        <Card pad={false} title="Sales by day" action={csv(name('shop-sales-by-day', from, to), days.map((r: any) => ({
          Date: r.invoice_date, Bills: num(r.bills), 'Items sold': num(r.units), 'Price before discount': num(r.gross), Discount: num(r.discount), 'Sales after discount': num(r.net_sales), GST: num(r.gst), 'Billed total': num(r.total),
        })))}>
          <Table rows={days} empty={<Empty title="No sales in this period" />} cols={[
            { key: 'invoice_date', label: 'Date', render: (r) => fmtDate(r.invoice_date) },
            { key: 'bills', label: 'Bills', ...right },
            { key: 'gross', label: 'Before discount', ...right, render: (r) => inr(r.gross) },
            { key: 'discount', label: 'Discount', ...right, render: (r) => (num(r.discount) > 0 ? inr(r.discount) : '—') },
            { key: 'net_sales', label: 'Sales', ...right, render: (r) => <span className="font-medium text-ink">{inr(r.net_sales)}</span> },
            { key: 'gst', label: 'GST', ...right, render: (r) => inr(r.gst) },
            { key: 'total', label: 'Billed total', ...right, render: (r) => inr(r.total) },
          ]} />
        </Card>

        <Card pad={false} title="Discounts given" subtitle="Every shop bill that had a discount, and who made it" action={csv(name('shop-discounts', from, to), discounts.map((r: any) => ({
          Date: r.invoice_date, Bill: r.invoice_no, Customer: r.customer_name, 'Given by': r.given_by ?? '', 'Price before discount': num(r.gross), Discount: num(r.discount), 'Discount %': num(r.pct), 'Billed total': num(r.total),
        })))}>
          <Table rows={discounts} empty={<Empty title="No discounts given in this period" />} cols={[
            { key: 'invoice_date', label: 'Date', render: (r) => fmtDate(r.invoice_date) },
            { key: 'invoice_no', label: 'Bill', render: (r) => <Link className="text-brand-dark font-medium" href={`/billing/${r.id}`}>{r.invoice_no}</Link> },
            { key: 'customer_name', label: 'Customer' },
            { key: 'given_by', label: 'Given by' },
            { key: 'gross', label: 'Before discount', ...right, render: (r) => inr(r.gross) },
            { key: 'discount', label: 'Discount', ...right, render: (r) => <span className="font-medium text-amber">{inr(r.discount)}</span> },
            { key: 'pct', label: '%', ...right, render: (r) => `${num(r.pct)}%` },
            { key: 'total', label: 'Billed total', ...right, render: (r) => inr(r.total) },
          ]} />
        </Card>
      </div>
    </>
  );
}

/* ---------- Stock ---------- */

const MOVE_LABEL: Record<string, string> = { purchase: 'Bought', sale: 'Sold', adjustment: 'Adjustment', damage: 'Damaged', return: 'Return' };

export function StockReport() {
  const { from, to, setRange } = useRange();
  const { data, error, reload } = useApi<any>(`/reports/stock?from=${from}&to=${to}`);
  if (error) return <ErrorNote message={error} retry={reload} />;
  const head = <RangePicker from={from} to={to} setRange={setRange} />;
  if (!data) return <>{head}<Loading /></>;
  const { summary: s, items, flow, moves, purchases } = data;
  const reorder = items.filter((r: any) => r.low);
  const moved = flow.filter((r: any) => ['bought', 'sold', 'returns', 'damaged', 'adjusted'].some((k) => num(r[k]) !== 0));

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Stock value at cost" value={inr(s.value_cost)} hint={`${s.products} products · now`} />
        <Stat label="Stock value at selling price" value={inr(s.value_sale)} hint="If all of it sold at full price" />
        <Stat label="Running low" value={s.low} tone={s.low > 0 ? 'amber' : undefined} hint={`${s.out} out of stock`} />
        <Stat label="Bought in this period" value={inr(purchases.total)} hint={`${purchases.bills} supplier bills`} />
      </div>
      <p className="text-muted text-[13px] mb-4">The first two tables show stock as it is now. The others use the dates below.</p>

      <div className="grid gap-4">
        <Card pad={false} title="Stock now" subtitle="Quantity and value of every product" action={csv('stock-now', items.map((r: any) => ({
          Product: r.name, Category: r.category, 'In stock': r.stock, Unit: r.unit, 'Buying price': num(r.cost_price), 'Selling price': num(r.sale_price), 'Value at cost': num(r.value_cost), 'Value at selling price': num(r.value_sale), 'Warn at': r.reorder_level, Status: r.stock <= 0 ? 'Out of stock' : r.low ? 'Running low' : 'OK',
        })))}>
          <Table rows={items} empty={<Empty title="No products yet" />} cols={[
            { key: 'name', label: 'Product', render: (r) => <span><span className="block font-medium text-ink">{r.name}</span><span className="text-muted text-[13px]">{r.category}</span></span> },
            { key: 'stock', label: 'In stock', ...right, render: (r) => `${r.stock} ${r.unit}` },
            { key: 'low', label: '', render: (r) => (r.stock <= 0 ? <Badge tone="red">Out of stock</Badge> : r.low ? <Badge tone="amber">Running low</Badge> : null) },
            { key: 'cost_price', label: 'Buy at', ...right, render: (r) => inr(r.cost_price) },
            { key: 'value_cost', label: 'Value at cost', ...right, render: (r) => inr(r.value_cost) },
            { key: 'value_sale', label: 'Value at selling price', ...right, render: (r) => inr(r.value_sale) },
          ]} />
        </Card>

        <Card pad={false} title="Reorder list" subtitle="Products at or below their warning level" action={csv('stock-reorder', reorder.map((r: any) => ({
          Product: r.name, 'In stock': r.stock, Unit: r.unit, 'Warn at': r.reorder_level, 'Usual supplier': r.supplier ?? '', 'Last buying price': num(r.cost_price),
        })))}>
          <Table rows={reorder} empty={<Empty title="Nothing to reorder" text="Every product is above its warning level." />} cols={[
            { key: 'name', label: 'Product', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
            { key: 'stock', label: 'In stock', ...right, render: (r) => <span className={r.stock <= 0 ? 'text-rose font-medium' : 'text-amber font-medium'}>{r.stock} {r.unit}</span> },
            { key: 'reorder_level', label: 'Warn at', ...right },
            { key: 'supplier', label: 'Usual supplier' },
            { key: 'cost_price', label: 'Buy at', ...right, render: (r) => inr(r.cost_price) },
          ]} />
        </Card>

        <div>
          <RangePicker from={from} to={to} setRange={setRange} />
          <Card pad={false} title="Stock in and out" subtitle="Opening + bought − sold + returns − damaged + adjustments = closing" action={csv(name('stock-in-out', from, to), flow.map((r: any) => ({
            Product: r.name, Unit: r.unit, Opening: num(r.opening), Bought: num(r.bought), Sold: num(r.sold), Returns: num(r.returns), Damaged: num(r.damaged), Adjustments: num(r.adjusted), Closing: num(r.closing),
          })))}>
            <Table rows={flow} empty={<Empty title="No products yet" />} cols={[
              { key: 'name', label: 'Product', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
              { key: 'opening', label: 'Opening', ...right, render: (r) => num(r.opening) },
              { key: 'bought', label: 'Bought', ...right, render: (r) => num(r.bought) || '—' },
              { key: 'sold', label: 'Sold', ...right, render: (r) => num(r.sold) || '—' },
              { key: 'returns', label: 'Returns', ...right, render: (r) => num(r.returns) || '—' },
              { key: 'damaged', label: 'Damaged', ...right, render: (r) => num(r.damaged) || '—' },
              { key: 'adjusted', label: 'Adjusted', ...right, render: (r) => num(r.adjusted) || '—' },
              { key: 'closing', label: 'Closing', ...right, render: (r) => <span className="font-medium text-ink">{num(r.closing)} {r.unit}</span> },
            ]} />
          </Card>
          {moved.length === 0 && <p className="text-muted text-[13px] mt-2">Nothing moved in this period, so opening and closing are the same.</p>}
        </div>

        <Card pad={false} title="Stock movements" subtitle={moves.length >= 1000 ? 'The latest 1,000 changes in this period' : 'Every change in this period, newest first'} action={csv(name('stock-movements', from, to), moves.map((r: any) => ({
          'Date and time': fmtDateTime(r.created_at), Product: r.product_name, Type: MOVE_LABEL[r.type] ?? r.type, Change: r.qty, Unit: r.unit, 'Price each': r.unit_cost == null ? '' : num(r.unit_cost), Note: r.note ?? '',
        })))}>
          <Table rows={moves} empty={<Empty title="No stock changes in this period" />} cols={[
            { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
            { key: 'product_name', label: 'Product', render: (r) => <span className="font-medium text-ink">{r.product_name}</span> },
            { key: 'type', label: 'Type', render: (r) => MOVE_LABEL[r.type] ?? r.type },
            { key: 'qty', label: 'Change', ...right, render: (r) => <span className={r.qty > 0 ? 'text-brand-dark' : 'text-rose'}>{r.qty > 0 ? '+' : ''}{r.qty}</span> },
            { key: 'note', label: 'Note' },
          ]} />
        </Card>
      </div>
    </>
  );
}
