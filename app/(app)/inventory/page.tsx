'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, PackagePlus, Plus, ShoppingCart, SlidersHorizontal, Trash2 } from 'lucide-react';
import { api, billTotal, fmtDateTime, inr, toast, useApi } from '@/lib/client';
import { Badge, Button, Card, Empty, ErrorNote, Field, FormFields, FormModal, Loading, MemberPicker, METHODS, Modal, PageHeader, Stat, Table, Tabs, toPayment } from '@/components/ui';

const productFields: Field[] = [
  { name: 'name', label: 'Product name', required: true, full: true },
  { name: 'category', label: 'Category', type: 'select', required: true, options: ['Supplements', 'Drinks', 'Accessories', 'Apparel', 'Equipment', 'Other'].map((x) => ({ value: x, label: x })) },
  { name: 'sku', label: 'Code / SKU' },
  { name: 'sale_price', label: 'Selling price (₹)', type: 'number', min: 0, required: true },
  { name: 'cost_price', label: 'Buying price (₹)', type: 'number', min: 0 },
  { name: 'gst_rate', label: 'GST %', type: 'number', min: 0 },
  { name: 'hsn', label: 'HSN code' },
  { name: 'reorder_level', label: 'Warn me when stock falls to', type: 'number', min: 0 },
  { name: 'supplier', label: 'Supplier' },
];

function Sell({ products, onClose, onDone }: { products: any[]; onClose: () => void; onDone: (id: number) => void }) {
  const settings = useApi('/settings');
  const [cart, setCart] = useState<{ product_id: string; qty: number }[]>([{ product_id: '', qty: 1 }]);
  const [member, setMember] = useState<any>(null);
  const [pay, setPay] = useState<any>({ pay_method: 'cash' });
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const available = products.filter((p) => p.stock > 0);
  const rate = (pid: string) => products.find((p) => String(p.id) === pid);
  const total = cart.reduce((a, c) => { const p = rate(c.product_id); return a + (p ? billTotal(settings.data, p.sale_price * c.qty, 0, p.gst_rate) : 0); }, 0);
  const amount = touched ? pay.pay_amount : total;
  const update = (i: number, patch: any) => setCart(cart.map((c, x) => (x === i ? { ...c, ...patch } : c)));
  return (
    <Modal title="Sell products" subtitle="Stock reduces and a bill is created automatically." onClose={onClose}>
      <div className="space-y-2">
        {cart.map((c, i) => (
          <div key={i} className="flex gap-2">
            <select className="input flex-1 min-w-0" aria-label="Product" value={c.product_id} onChange={(e) => update(i, { product_id: e.target.value })}>
              <option value="">Choose product…</option>
              {available.map((p) => <option key={p.id} value={p.id}>{p.name} · {inr(p.sale_price)} · {p.stock} left</option>)}
            </select>
            <input className="input !w-20" type="number" min={1} aria-label="Quantity" value={c.qty} onChange={(e) => update(i, { qty: Number(e.target.value) })} />
            {cart.length > 1 && <Button variant="ghost" aria-label="Remove" onClick={() => setCart(cart.filter((_, x) => x !== i))}><Trash2 /></Button>}
          </div>
        ))}
        <Button size="sm" onClick={() => setCart([...cart, { product_id: '', qty: 1 }])}><Plus /> Add another product</Button>
      </div>
      <div className="mt-4">
        <label className="block text-[13px] font-medium text-ink mb-1">Member (optional)</label>
        <MemberPicker value={member} onChange={setMember} />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div><label className="block text-[13px] font-medium text-ink mb-1" htmlFor="sp">Received now (₹)</label><input id="sp" className="input" type="number" min={0} step="any" value={amount} onChange={(e) => { setTouched(true); setPay({ ...pay, pay_amount: e.target.value }); }} /></div>
        <div><label className="block text-[13px] font-medium text-ink mb-1" htmlFor="sm">Paid by</label><select id="sm" className="input" value={pay.pay_method} onChange={(e) => setPay({ ...pay, pay_method: e.target.value })}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
      </div>
      <div className="bg-canvas rounded-lg p-3 mt-4 flex justify-between"><span className="text-muted">Total</span><span className="font-semibold text-ink text-lg tabular-nums">{inr(total)}</span></div>
      {err && <div className="mt-3"><ErrorNote message={err} /></div>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => {
          const items = cart.filter((c) => c.product_id);
          if (!items.length) return setErr('Choose at least one product');
          try {
            const r = await api('/products/sell', { body: { items, member_id: member, payment: toPayment({ ...pay, pay_amount: amount }) } });
            toast('Sale recorded'); onDone(r.invoice.id);
          } catch (e: any) { setErr(e.message); }
        }}>Complete sale</Button>
      </div>
    </Modal>
  );
}

export default function InventoryPage() {
  const router = useRouter();
  const { data, error, reload } = useApi<any[]>('/products');
  const moves = useApi<any[]>('/stock-movements');
  const [tab, setTab] = useState('stock');
  const [edit, setEdit] = useState<any>(null);
  const [stock, setStock] = useState<any>(null);
  const [sell, setSell] = useState(false);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const done = () => { reload(); moves.reload(); };
  const value = data.reduce((a, p) => a + p.stock * p.cost_price, 0);
  const blank = { category: 'Supplements', gst_rate: 18, reorder_level: 5, opening_stock: 0, active: true };
  const stockTitle = stock?.type === 'purchase' ? 'Receive new stock' : 'Correct stock';

  return (
    <>
      <PageHeader title="Shop & Stock" help="Supplements, drinks and accessories you sell, plus how much you have left.">
        <Button onClick={() => setSell(true)}><ShoppingCart /> Sell</Button>
        <Button variant="primary" onClick={() => setEdit(blank)}><Plus /> Add product</Button>
      </PageHeader>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <Stat label="Products" value={data.length} />
        <Stat label="Running low" value={data.filter((p) => p.low).length} tone={data.some((p) => p.low) ? 'amber' : undefined} />
        <Stat label="Stock value at cost" value={inr(value)} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'stock', label: 'Stock' }, { key: 'history', label: 'Stock history' }]} />
      {tab === 'stock' ? (
        <Card pad={false}>
          <Table rows={data} onRow={setEdit} empty={<Empty icon={Package} title="No products yet" text="Add what you sell so stock and bills stay correct." action={<Button variant="primary" onClick={() => setEdit(blank)}>Add product</Button>} />}
            cols={[
              { key: 'name', label: 'Product', render: (r) => <span><span className="block font-medium text-ink">{r.name}</span><span className="text-muted text-[13px]">{r.category}</span></span> },
              { key: 'stock', label: 'In stock', align: 'right', render: (r) => <span className="font-medium text-ink">{r.stock} {r.unit}</span> },
              { key: 'low', label: '', render: (r) => r.low ? <Badge tone={r.stock === 0 ? 'red' : 'amber'}>{r.stock === 0 ? 'Out of stock' : 'Running low'}</Badge> : null },
              { key: 'sale_price', label: 'Price', align: 'right', render: (r) => inr(r.sale_price) },
              { key: 'a', label: '', align: 'right', render: (r) => (
                <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" onClick={() => setStock({ ...r, type: 'purchase', record_expense: true })}><PackagePlus /> Receive</Button>
                  <Button size="sm" variant="ghost" aria-label="Correct stock" onClick={() => setStock({ ...r, type: 'adjustment' })}><SlidersHorizontal /></Button>
                </span>) },
            ]} />
        </Card>
      ) : (
        <Card pad={false}>
          <Table rows={moves.data ?? []} empty={<Empty title="No stock changes yet" />}
            cols={[
              { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
              { key: 'product_name', label: 'Product', render: (r) => <span className="font-medium text-ink">{r.product_name}</span> },
              { key: 'type', label: 'Type', render: (r) => <span className="capitalize">{r.type}</span> },
              { key: 'qty', label: 'Change', align: 'right', render: (r) => <span className={r.qty > 0 ? 'text-brand-dark' : 'text-rose'}>{r.qty > 0 ? '+' : ''}{r.qty}</span> },
              { key: 'note', label: 'Note' },
            ]} />
        </Card>
      )}
      {edit && <FormModal title={edit.id ? `Edit ${edit.name}` : 'Add product'} initial={edit} onClose={() => setEdit(null)}
        fields={edit.id ? productFields : [...productFields, { name: 'opening_stock', label: 'Stock you have now', type: 'number', min: 0 }]}
        onSubmit={async (v) => { await api(edit.id ? `/products/${edit.id}` : '/products', { method: edit.id ? 'PUT' : 'POST', body: v }); toast('Product saved'); done(); }} />}
      {stock && <FormModal title={`${stockTitle}: ${stock.name}`} subtitle={`Currently ${stock.stock} ${stock.unit} in stock`} onClose={() => setStock(null)} initial={{ type: stock.type, record_expense: stock.record_expense, unit_cost: stock.cost_price }}
        fields={stock.type === 'purchase' ? [
          { name: 'qty', label: 'Quantity received', type: 'number', min: 1, required: true },
          { name: 'unit_cost', label: 'Buying price each (₹)', type: 'number', min: 0 },
          { name: 'note', label: 'Note', full: true },
          { name: 'record_expense', label: 'Also add this to Expenses', type: 'checkbox' },
        ] : [
          { name: 'type', label: 'Reason', type: 'select', required: true, options: [{ value: 'adjustment', label: 'Count correction' }, { value: 'damage', label: 'Damaged or expired' }] },
          { name: 'qty', label: 'Quantity', type: 'number', required: true, help: 'For a correction use + or −, like −2. For damage enter the number lost.' },
          { name: 'note', label: 'Note', full: true },
        ]}
        onSubmit={async (v) => { await api(`/products/${stock.id}/stock`, { body: v }); toast('Stock updated'); done(); }} />}
      {sell && <Sell products={data} onClose={() => setSell(false)} onDone={(id) => router.push(`/billing/${id}`)} />}
    </>
  );
}
