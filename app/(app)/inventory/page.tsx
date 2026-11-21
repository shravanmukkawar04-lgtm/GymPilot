'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, PackagePlus, Plus, ShoppingCart, SlidersHorizontal, Trash2, Truck } from 'lucide-react';
import { api, fmtDate, fmtDateTime, inr, saleTotals, todayIST, toast, useApi } from '@/lib/client';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Field, FormModal, Loading, MemberPicker, METHODS, Modal, PageHeader, PayInputs, Stat, StatusBadge, Table, Tabs, toPayment } from '@/components/ui';

const productFields: Field[] = [
  { name: 'name', label: 'Product name', required: true, full: true },
  { name: 'category', label: 'Category', type: 'select', required: true, options: ['Supplements', 'Drinks', 'Accessories', 'Apparel', 'Equipment', 'Other'].map((x) => ({ value: x, label: x })) },
  { name: 'sku', label: 'Code / SKU' },
  { name: 'sale_price', label: 'Selling price (₹)', type: 'number', min: 0, required: true },
  { name: 'cost_price', label: 'Buying price (₹)', type: 'number', min: 0 },
  { name: 'gst_rate', label: 'GST %', type: 'number', min: 0 },
  { name: 'hsn', label: 'HSN code' },
  { name: 'reorder_level', label: 'Warn me when stock falls to', type: 'number', min: 0 },
  { name: 'supplier', label: 'Usual supplier' },
];

const supplierFields: Field[] = [
  { name: 'name', label: 'Supplier name', required: true, full: true },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'gstin', label: 'GSTIN' },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

const payFields: Field[] = [
  { name: 'amount', label: 'Amount paid (₹)', type: 'number', min: 0, required: true },
  { name: 'method', label: 'Paid by', type: 'select', options: METHODS, required: true },
  { name: 'paid_on', label: 'Date', type: 'date', required: true },
  { name: 'reference', label: 'UPI / cheque / reference no.' },
];

const label = (text: string, id?: string) => <label className="block text-[13px] font-medium text-ink mb-1" htmlFor={id}>{text}</label>;

/* ---------- Selling ---------- */

function Sell({ products, onClose, onDone }: { products: any[]; onClose: () => void; onDone: (id: number) => void }) {
  const settings = useApi('/settings');
  const [cart, setCart] = useState<{ product_id: string; qty: number }[]>([{ product_id: '', qty: 1 }]);
  const [member, setMember] = useState<any>(null);
  const [walkIn, setWalkIn] = useState({ name: '', phone: '' });
  const [pay, setPay] = useState<any>({ pay_method: 'cash' });
  const [disc, setDisc] = useState('');
  const [discMode, setDiscMode] = useState<'amount' | 'percent'>('amount');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [prevDue, setPrevDue] = useState('');
  const available = products.filter((p) => p.stock > 0);
  const rate = (pid: string) => products.find((p) => String(p.id) === pid);
  const lines = cart.flatMap((c) => { const p = rate(c.product_id); return p ? [{ gross: p.sale_price * c.qty, rate: p.gst_rate }] : []; });
  const subtotal = saleTotals(settings.data, lines, 0).gross;
  // The server takes the discount in rupees. A percentage is turned into rupees here, so what you see is what is saved.
  const discount = discMode === 'percent' ? Math.round(subtotal * (Number(disc) || 0)) / 100 : Math.round((Number(disc) || 0) * 100) / 100;
  const discError = (Number(disc) || 0) < 0 ? 'Discount cannot be negative'
    : discMode === 'percent' && Number(disc) > 100 ? 'Discount cannot be more than 100%'
    : discount > subtotal ? 'Discount cannot be more than the bill amount' : null;
  const total = saleTotals(settings.data, lines, discError ? 0 : discount).total;
  const amount = touched ? pay.pay_amount : total;
  const due = Math.max(0, total - (Number(amount) || 0));
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
        {label('Sold to a member? (optional)')}
        <MemberPicker value={member} onChange={setMember} />
      </div>
      {!member && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>{label('Customer name', 'wn')}<input id="wn" className="input" placeholder="Walk-in customer" value={walkIn.name} onChange={(e) => setWalkIn({ ...walkIn, name: e.target.value })} /></div>
          <div>{label('Customer phone', 'wp')}<input id="wp" className="input" type="tel" placeholder="Optional" value={walkIn.phone} onChange={(e) => setWalkIn({ ...walkIn, phone: e.target.value })} /></div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>{label(discMode === 'percent' ? 'Discount (%) (optional)' : 'Discount (₹) (optional)', 'sd')}<input id="sd" className="input" type="number" min={0} step="any" placeholder="0" value={disc} onChange={(e) => setDisc(e.target.value)} /></div>
        <div>{label('Discount in', 'sm')}<select id="sm" className="input" value={discMode} onChange={(e) => setDiscMode(e.target.value as 'amount' | 'percent')}><option value="amount">Rupees (₹)</option><option value="percent">Percent (%)</option></select></div>
      </div>
      {discError && <p className="text-rose text-[13px] mt-2">{discError}</p>}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>{label('Received now (₹)', 'sp')}<input id="sp" className="input" type="number" min={0} step="any" value={amount} onChange={(e) => { setTouched(true); setPay({ ...pay, pay_amount: e.target.value }); }} /></div>
        <PayInputs pay={pay} setPay={setPay} amount={amount} />
      </div>
      <div className="mt-3 max-w-xs">
        {label('Previous due (₹) (optional)', 'pd')}
        <input id="pd" className="input" type="number" min={0} step="any" placeholder="0" value={prevDue} onChange={(e) => setPrevDue(e.target.value)} />
        <p className="text-muted text-[13px] mt-1">Money this customer still has to pay from before. It will show as pending.</p>
      </div>
      <div className="bg-canvas rounded-lg p-3 mt-4 flex items-center justify-between gap-3">
        <div>
          {!discError && discount > 0 && <div className="text-muted text-xs tabular-nums">{inr(subtotal)} − {inr(discount)} discount</div>}
          <div className="text-muted text-xs">Total</div><div className="font-semibold text-ink text-lg tabular-nums">{inr(total)}</div>
        </div>
        <div className="text-right"><div className="text-muted text-xs">Customer will owe</div><div className={`font-semibold text-lg tabular-nums ${due > 0 ? 'text-rose' : 'text-brand-dark'}`}>{inr(due)}</div></div>
      </div>
      {due > 0 && !member && !walkIn.phone && <p className="text-amber text-[13px] mt-2">Add the customer&apos;s name and phone so you know who owes you.</p>}
      {err && <div className="mt-3"><ErrorNote message={err} /></div>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={async () => {
          const items = cart.filter((c) => c.product_id);
          if (!items.length) return setErr('Choose at least one product');
          if (discError) return setErr(discError);
          if (prevDue !== '' && !(Number(prevDue) >= 0)) return setErr('Previous due is not a valid amount');
          if (Number(prevDue) > 0 && !member && !walkIn.phone) return setErr('Add the customer’s name and phone so you know who owes the previous due');
          if ((Number(amount) || 0) > total + 0.005) return setErr('Received amount is more than the total after discount');
          setBusy(true); setErr(null);
          try {
            const r = await api('/products/sell', { body: {
              items, member_id: member, discount: discount || null, payment: toPayment({ ...pay, pay_amount: amount }), previous_due: Number(prevDue) || null,
              customer_name: member ? null : walkIn.name || null, customer_phone: member ? null : walkIn.phone || null,
            } });
            toast('Sale recorded'); onDone(r.invoice.id);
          } catch (e: any) { setErr(e.message); setBusy(false); }
        }}>Complete sale</Button>
      </div>
    </Modal>
  );
}

/* ---------- Buying ---------- */

function Buy({ products, start, onClose, onDone }: { products: any[]; start?: any; onClose: () => void; onDone: () => void }) {
  const suppliers = useApi<any[]>('/suppliers');
  const [supplierId, setSupplierId] = useState('');
  const [newSupplier, setNewSupplier] = useState(false);
  const [head, setHead] = useState({ bill_no: '', purchase_date: todayIST(), notes: '' });
  const [cart, setCart] = useState<{ product_id: string; qty: number; unit_cost: any }[]>([
    start ? { product_id: String(start.id), qty: 1, unit_cost: start.cost_price } : { product_id: '', qty: 1, unit_cost: '' },
  ]);
  const [pay, setPay] = useState<any>({ method: 'cash', reference: '' });
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = cart.reduce((a, c) => a + (Number(c.qty) || 0) * (Number(c.unit_cost) || 0), 0);
  const paid = touched ? pay.amount : total;
  const owe = Math.max(0, total - (Number(paid) || 0));
  const update = (i: number, patch: any) => setCart(cart.map((c, x) => (x === i ? { ...c, ...patch } : c)));
  const pick = (i: number, id: string) => update(i, { product_id: id, unit_cost: products.find((p) => String(p.id) === id)?.cost_price ?? '' });
  return (
    <Modal wide title="Buy stock from a supplier" subtitle="Enter the supplier's bill. Stock goes up, and whatever you don't pay now shows as owed to the supplier." onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-3">
          {label('Supplier', 'sup')}
          <div className="flex gap-2">
            <select id="sup" className="input flex-1 min-w-0" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose supplier…</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.owed > 0 ? ` · you owe ${inr(s.owed)}` : ''}</option>)}
            </select>
            <Button onClick={() => setNewSupplier(true)}><Plus /> New supplier</Button>
          </div>
        </div>
        <div>{label('Supplier bill no.', 'bn')}<input id="bn" className="input" placeholder="Optional" value={head.bill_no} onChange={(e) => setHead({ ...head, bill_no: e.target.value })} /></div>
        <div>{label('Bill date', 'bd')}<input id="bd" className="input" type="date" value={head.purchase_date} onChange={(e) => setHead({ ...head, purchase_date: e.target.value })} /></div>
      </div>

      <h3 className="font-semibold mt-5 mb-2">Products received</h3>
      <div className="space-y-2">
        <div className="hidden sm:flex gap-2 text-muted text-xs"><span className="flex-1">Product</span><span className="w-20">Qty</span><span className="w-28">Price each (₹)</span><span className="w-24 text-right">Amount</span><span className="w-9" /></div>
        {cart.map((c, i) => (
          <div key={i} className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
            <select className="input flex-1 min-w-[12rem]" aria-label="Product" value={c.product_id} onChange={(e) => pick(i, e.target.value)}>
              <option value="">Choose product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stock} in stock</option>)}
            </select>
            <input className="input !w-20" type="number" min={1} aria-label="Quantity" value={c.qty} onChange={(e) => update(i, { qty: Number(e.target.value) })} />
            <input className="input !w-28" type="number" min={0} step="any" aria-label="Buying price each" value={c.unit_cost} onChange={(e) => update(i, { unit_cost: e.target.value })} />
            <span className="w-24 text-right tabular-nums text-ink">{inr((Number(c.qty) || 0) * (Number(c.unit_cost) || 0))}</span>
            {cart.length > 1 ? <Button variant="ghost" aria-label="Remove" onClick={() => setCart(cart.filter((_, x) => x !== i))}><Trash2 /></Button> : <span className="w-9" />}
          </div>
        ))}
        <Button size="sm" onClick={() => setCart([...cart, { product_id: '', qty: 1, unit_cost: '' }])}><Plus /> Add another product</Button>
        <p className="text-muted text-xs">Enter the price you paid per piece, including GST, as on the supplier&apos;s bill. Not in the list? Add the product first.</p>
      </div>

      <h3 className="font-semibold mt-5 mb-2">Payment to supplier</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>{label('Paid now (₹)', 'pn')}<input id="pn" className="input" type="number" min={0} step="any" value={paid} onChange={(e) => { setTouched(true); setPay({ ...pay, amount: e.target.value }); }} />
          <p className="text-muted text-xs mt-1">Enter 0 if you will pay later.</p></div>
        <div>{label('Paid by', 'pm')}<select id="pm" className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
        <div>{label('Reference', 'pr')}<input id="pr" className="input" placeholder="Optional" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
      </div>

      <div className="bg-canvas rounded-lg p-3 mt-4 flex items-center justify-between gap-3">
        <div><div className="text-muted text-xs">Bill total</div><div className="font-semibold text-ink text-lg tabular-nums">{inr(total)}</div></div>
        <div className="text-right"><div className="text-muted text-xs">You will owe the supplier</div><div className={`font-semibold text-lg tabular-nums ${owe > 0 ? 'text-rose' : 'text-brand-dark'}`}>{inr(owe)}</div></div>
      </div>
      {err && <div className="mt-3"><ErrorNote message={err} /></div>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={async () => {
          const items = cart.filter((c) => c.product_id);
          if (!supplierId) return setErr('Choose the supplier');
          if (!items.length) return setErr('Choose at least one product');
          setBusy(true); setErr(null);
          try {
            const amount = Number(paid) || 0;
            await api('/purchases', { body: {
              supplier_id: supplierId, ...head,
              items: items.map((c) => ({ product_id: c.product_id, qty: c.qty, unit_cost: Number(c.unit_cost) || 0 })),
              payment: amount > 0 ? { amount, method: pay.method, reference: pay.reference || null, paid_on: head.purchase_date } : null,
            } });
            toast('Purchase saved and stock updated'); onDone(); onClose();
          } catch (e: any) { setErr(e.message); setBusy(false); }
        }}>Save purchase</Button>
      </div>
      {newSupplier && <FormModal title="New supplier" fields={supplierFields} onClose={() => setNewSupplier(false)}
        onSubmit={async (v) => { const s = await api('/suppliers', { body: v }); await suppliers.reload(); setSupplierId(String(s.id)); toast('Supplier added'); }} />}
    </Modal>
  );
}

function PurchaseView({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useApi<any>(`/purchases/${id}`);
  const [paying, setPaying] = useState(false);
  const [undo, setUndo] = useState<any>(null);
  const [cancel, setCancel] = useState(false);
  const changed = () => { reload(); onChanged(); };
  const p = data?.purchase;
  return (
    <Modal wide title={p ? `Purchase from ${p.supplier_name}` : 'Purchase'} subtitle={p ? `${p.bill_no ? `Bill ${p.bill_no} · ` : ''}${fmtDate(p.purchase_date)}` : undefined} onClose={onClose}>
      {error ? <ErrorNote message={error} retry={reload} /> : !data ? <Loading /> : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Bill total" value={inr(p.total)} />
            <Stat label="Paid" value={inr(p.paid)} />
            <Stat label="Still owed" value={inr(p.status === 'cancelled' ? 0 : p.balance)} tone={p.balance > 0 && p.status !== 'cancelled' ? 'red' : undefined} />
          </div>
          <div className="mt-3"><StatusBadge status={p.status} /></div>
          <Card pad={false} className="mt-4">
            <Table rows={data.items} cols={[
              { key: 'product_name', label: 'Product', render: (r) => <span className="font-medium text-ink">{r.product_name}</span> },
              { key: 'qty', label: 'Qty', align: 'right', render: (r) => `${r.qty} ${r.unit}` },
              { key: 'unit_cost', label: 'Price each', align: 'right', render: (r) => inr(r.unit_cost) },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amount) },
            ]} />
          </Card>
          <h3 className="font-semibold mt-5 mb-2">Payments</h3>
          {data.payments.length === 0 ? <p className="text-muted">Nothing paid yet.</p> : (
            <Card pad={false}>
              <Table rows={data.payments} cols={[
                { key: 'paid_on', label: 'Date', render: (r) => fmtDate(r.paid_on) },
                { key: 'method', label: 'Paid by', render: (r) => <span className="capitalize">{r.method}{r.reference ? ` · ${r.reference}` : ''}</span> },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className={r.voided ? 'line-through text-muted' : ''}>{inr(r.amount)}</span> },
                { key: 'a', label: '', align: 'right', render: (r) => r.voided ? <Badge>Undone</Badge> : <Button size="sm" variant="ghost" onClick={() => setUndo(r)}>Undo</Button> },
              ]} />
            </Card>
          )}
          {p.notes && <p className="text-muted mt-3">{p.notes}</p>}
          <div className="flex flex-wrap justify-end gap-2 mt-5">
            {p.status !== 'cancelled' && p.paid === 0 && <Button variant="ghost" onClick={() => setCancel(true)}>Cancel purchase</Button>}
            {p.status !== 'cancelled' && p.balance > 0 && <Button variant="primary" onClick={() => setPaying(true)}>Pay {inr(p.balance)}</Button>}
          </div>
        </>
      )}
      {paying && p && <FormModal title={`Pay ${p.supplier_name}`} subtitle={`Balance on this bill: ${inr(p.balance)}`} fields={payFields}
        initial={{ amount: p.balance, method: 'cash', paid_on: todayIST() }} submitLabel="Record payment" onClose={() => setPaying(false)}
        onSubmit={async (v) => { await api(`/purchases/${id}/payments`, { body: v }); toast('Payment recorded'); changed(); }} />}
      {undo && <Confirm danger title="Undo this payment?" text={`${inr(undo.amount)} paid on ${fmtDate(undo.paid_on)}. It is also removed from Expenses.`} confirmLabel="Undo payment"
        onClose={() => setUndo(null)} onConfirm={async () => { await api(`/supplier-payments/${undo.id}/void`, { method: 'POST' }); toast('Payment undone'); changed(); }} />}
      {cancel && <Confirm danger title="Cancel this purchase?" text="The stock from this purchase is taken back out. Use this for a wrong entry or goods returned to the supplier." confirmLabel="Cancel purchase"
        onClose={() => setCancel(false)} onConfirm={async () => { await api(`/purchases/${id}/cancel`, { method: 'POST' }); toast('Purchase cancelled'); changed(); }} />}
    </Modal>
  );
}

function SupplierView({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useApi<any>(`/suppliers/${id}`);
  const [edit, setEdit] = useState(false);
  const [paying, setPaying] = useState(false);
  const [remove, setRemove] = useState(false);
  const [purchase, setPurchase] = useState<number | null>(null);
  const changed = () => { reload(); onChanged(); };
  const s = data?.supplier;
  const owed = data ? data.purchases.filter((p: any) => p.status !== 'cancelled').reduce((a: number, p: any) => a + p.balance, 0) : 0;
  const bought = data ? data.purchases.filter((p: any) => p.status !== 'cancelled').reduce((a: number, p: any) => a + p.total, 0) : 0;
  return (
    <Modal wide title={s?.name ?? 'Supplier'} subtitle={s ? [s.phone, s.gstin && `GSTIN ${s.gstin}`].filter(Boolean).join(' · ') || undefined : undefined} onClose={onClose}>
      {error ? <ErrorNote message={error} retry={reload} /> : !data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="You owe" value={inr(owed)} tone={owed > 0 ? 'red' : undefined} />
            <Stat label="Bought in total" value={inr(bought)} />
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {owed > 0 && <Button variant="primary" onClick={() => setPaying(true)}>Pay supplier</Button>}
            <Button onClick={() => setEdit(true)}>Edit details</Button>
            <Button variant="ghost" onClick={() => setRemove(true)}>Remove supplier</Button>
          </div>
          <h3 className="font-semibold mt-5 mb-2">Bills</h3>
          <Card pad={false}>
            <Table rows={data.purchases} onRow={(r) => setPurchase(r.id)} empty={<Empty title="No purchases from this supplier yet" />} cols={[
              { key: 'purchase_date', label: 'Date', render: (r) => fmtDate(r.purchase_date) },
              { key: 'bill_no', label: 'Bill no.', render: (r) => r.bill_no ?? '—' },
              { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
              { key: 'balance', label: 'Owed', align: 'right', render: (r) => r.status === 'cancelled' ? '—' : <span className={r.balance > 0 ? 'text-rose' : ''}>{inr(r.balance)}</span> },
              { key: 'status', label: '', render: (r) => <StatusBadge status={r.status} /> },
            ]} />
          </Card>
          <h3 className="font-semibold mt-5 mb-2">Payments made</h3>
          <Card pad={false}>
            <Table rows={data.payments} empty={<Empty title="No payments yet" />} cols={[
              { key: 'paid_on', label: 'Date', render: (r) => fmtDate(r.paid_on) },
              { key: 'bill_no', label: 'For bill', render: (r) => r.bill_no ?? '—' },
              { key: 'method', label: 'Paid by', render: (r) => <span className="capitalize">{r.method}</span> },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amount) },
            ]} />
          </Card>
        </>
      )}
      {edit && s && <FormModal title={`Edit ${s.name}`} fields={supplierFields} initial={s} onClose={() => setEdit(false)}
        onSubmit={async (v) => { await api(`/suppliers/${id}`, { method: 'PUT', body: v }); toast('Supplier saved'); changed(); }} />}
      {paying && <FormModal title={`Pay ${s.name}`} subtitle={`You owe ${inr(owed)}. The payment clears the oldest bills first.`} fields={payFields}
        initial={{ amount: owed, method: 'cash', paid_on: todayIST() }} submitLabel="Record payment" onClose={() => setPaying(false)}
        onSubmit={async (v) => { await api(`/suppliers/${id}/pay`, { body: v }); toast('Payment recorded'); changed(); }} />}
      {remove && s && <Confirm danger title={`Remove ${s.name}?`} text="Their old bills and payments stay in your records." confirmLabel="Remove"
        onClose={() => setRemove(false)} onConfirm={async () => { await api(`/suppliers/${id}`, { method: 'DELETE' }); toast('Supplier removed'); onChanged(); onClose(); }} />}
      {purchase && <PurchaseView id={purchase} onClose={() => setPurchase(null)} onChanged={changed} />}
    </Modal>
  );
}

/* ---------- Page ---------- */

export default function InventoryPage() {
  const router = useRouter();
  const { data, error, reload } = useApi<any[]>('/products');
  const moves = useApi<any[]>('/stock-movements');
  const sales = useApi<any>('/product-sales');
  const purchases = useApi<any>('/purchases');
  const suppliers = useApi<any[]>('/suppliers');
  const [tab, setTab] = useState('stock');
  const [edit, setEdit] = useState<any>(null);
  const [stock, setStock] = useState<any>(null);
  const [sell, setSell] = useState(false);
  const [buy, setBuy] = useState<any>(null);
  const [newSupplier, setNewSupplier] = useState(false);
  const [supplier, setSupplier] = useState<number | null>(null);
  const [purchase, setPurchase] = useState<number | null>(null);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const done = () => { reload(); moves.reload(); sales.reload(); purchases.reload(); suppliers.reload(); };
  const value = data.reduce((a, p) => a + p.stock * p.cost_price, 0);
  const blank = { category: 'Supplements', gst_rate: 18, reorder_level: 5, opening_stock: 0, active: true };

  return (
    <>
      <PageHeader title="Shop & Stock" help="What you buy from suppliers, what you sell to members and walk-in customers, and the money owed on both sides.">
        <Button onClick={() => setBuy({})}><Truck /> Buy stock</Button>
        <Button onClick={() => setSell(true)}><ShoppingCart /> Sell</Button>
        <Button variant="primary" onClick={() => setEdit(blank)}><Plus /> Add product</Button>
      </PageHeader>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Stock value at cost" value={inr(value)} hint={`${data.length} products`} />
        <Stat label="Running low" value={data.filter((p) => p.low).length} tone={data.some((p) => p.low) ? 'amber' : undefined} />
        <Stat label="You owe suppliers" value={inr(purchases.data?.summary.owed ?? 0)} tone={purchases.data?.summary.owed > 0 ? 'red' : undefined} hint={`Bought this month: ${inr(purchases.data?.summary.month ?? 0)}`} />
        <Stat label="Customers owe you" value={inr(sales.data?.summary.owed ?? 0)} tone={sales.data?.summary.owed > 0 ? 'amber' : undefined} hint={`Sold this month: ${inr(sales.data?.summary.month ?? 0)}`} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'stock', label: 'Stock' }, { key: 'sales', label: 'Sales' }, { key: 'purchases', label: 'Purchases' },
        { key: 'suppliers', label: 'Suppliers', count: suppliers.data?.length }, { key: 'history', label: 'Stock history' },
      ]} />

      {tab === 'stock' && (
        <Card pad={false}>
          <Table rows={data} onRow={setEdit} empty={<Empty icon={Package} title="No products yet" text="Add what you sell so stock and bills stay correct." action={<Button variant="primary" onClick={() => setEdit(blank)}>Add product</Button>} />}
            cols={[
              { key: 'name', label: 'Product', render: (r) => <span><span className="block font-medium text-ink">{r.name}</span><span className="text-muted text-[13px]">{r.category}</span></span> },
              { key: 'stock', label: 'In stock', align: 'right', render: (r) => <span className="font-medium text-ink">{r.stock} {r.unit}</span> },
              { key: 'low', label: '', render: (r) => r.low ? <Badge tone={r.stock === 0 ? 'red' : 'amber'}>{r.stock === 0 ? 'Out of stock' : 'Running low'}</Badge> : null },
              { key: 'cost_price', label: 'Buy at', align: 'right', render: (r) => inr(r.cost_price) },
              { key: 'sale_price', label: 'Sell at', align: 'right', render: (r) => inr(r.sale_price) },
              { key: 'a', label: '', align: 'right', render: (r) => (
                <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" onClick={() => setBuy({ start: r })}><PackagePlus /> Buy more</Button>
                  <Button size="sm" variant="ghost" aria-label="Correct stock" onClick={() => setStock({ ...r, type: 'adjustment' })}><SlidersHorizontal /></Button>
                </span>) },
            ]} />
        </Card>
      )}

      {tab === 'sales' && (
        <Card pad={false}>
          <Table rows={sales.data?.rows ?? []} onRow={(r) => router.push(`/billing/${r.id}`)}
            empty={<Empty icon={ShoppingCart} title="No sales yet" action={<Button variant="primary" onClick={() => setSell(true)}>Sell</Button>} />}
            cols={[
              { key: 'invoice_date', label: 'Date', render: (r) => fmtDate(r.invoice_date) },
              { key: 'customer_name', label: 'Customer', render: (r) => <span><span className="block font-medium text-ink">{r.customer_name}</span><span className="text-muted text-[13px]">{r.member_id ? 'Member' : 'Walk-in'}{r.customer_phone ? ` · ${r.customer_phone}` : ''}</span></span> },
              { key: 'items', label: 'Items', render: (r) => <span className="text-[13px]">{r.items}</span> },
              { key: 'discount', label: 'Discount', align: 'right', render: (r) => r.discount > 0 ? inr(r.discount) : '—' },
              { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
              { key: 'balance', label: 'Owes you', align: 'right', render: (r) => r.status === 'cancelled' ? '—' : <span className={r.balance > 0 ? 'text-rose font-medium' : ''}>{inr(r.balance)}</span> },
              { key: 'status', label: '', render: (r) => <StatusBadge status={r.status} /> },
            ]} />
          <p className="text-muted text-[13px] px-4 py-3 border-t border-line">Open a sale to collect the balance or print the bill.</p>
        </Card>
      )}

      {tab === 'purchases' && (
        <Card pad={false}>
          <Table rows={purchases.data?.rows ?? []} onRow={(r) => setPurchase(r.id)}
            empty={<Empty icon={Truck} title="No purchases yet" text="When stock arrives from a supplier, enter their bill here." action={<Button variant="primary" onClick={() => setBuy({})}>Buy stock</Button>} />}
            cols={[
              { key: 'purchase_date', label: 'Date', render: (r) => fmtDate(r.purchase_date) },
              { key: 'supplier_name', label: 'Supplier', render: (r) => <span><span className="block font-medium text-ink">{r.supplier_name}</span>{r.bill_no && <span className="text-muted text-[13px]">Bill {r.bill_no}</span>}</span> },
              { key: 'items', label: 'Items', render: (r) => <span className="text-[13px]">{r.items}</span> },
              { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
              { key: 'balance', label: 'You owe', align: 'right', render: (r) => r.status === 'cancelled' ? '—' : <span className={r.balance > 0 ? 'text-rose font-medium' : ''}>{inr(r.balance)}</span> },
              { key: 'status', label: '', render: (r) => <StatusBadge status={r.status} /> },
            ]} />
        </Card>
      )}

      {tab === 'suppliers' && (
        <Card pad={false} title="Suppliers" action={<Button size="sm" onClick={() => setNewSupplier(true)}><Plus /> New supplier</Button>}>
          <Table rows={suppliers.data ?? []} onRow={(r) => setSupplier(r.id)}
            empty={<Empty icon={Truck} title="No suppliers yet" text="Add the shops and distributors you buy stock from." action={<Button variant="primary" onClick={() => setNewSupplier(true)}>New supplier</Button>} />}
            cols={[
              { key: 'name', label: 'Supplier', render: (r) => <span><span className="block font-medium text-ink">{r.name}</span>{r.phone && <span className="text-muted text-[13px]">{r.phone}</span>}</span> },
              { key: 'last_purchase', label: 'Last bought', render: (r) => r.last_purchase ? fmtDate(r.last_purchase) : '—' },
              { key: 'bought', label: 'Bought in total', align: 'right', render: (r) => inr(r.bought) },
              { key: 'owed', label: 'You owe', align: 'right', render: (r) => <span className={r.owed > 0 ? 'text-rose font-medium' : ''}>{inr(r.owed)}</span> },
            ]} />
        </Card>
      )}

      {tab === 'history' && (
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
      {stock && <FormModal title={`Correct stock: ${stock.name}`} subtitle={`Currently ${stock.stock} ${stock.unit} in stock. To add stock you bought, use Buy stock instead.`} onClose={() => setStock(null)} initial={{ type: stock.type }}
        fields={[
          { name: 'type', label: 'Reason', type: 'select', required: true, options: [{ value: 'adjustment', label: 'Count correction' }, { value: 'damage', label: 'Damaged or expired' }] },
          { name: 'qty', label: 'Quantity', type: 'number', required: true, help: 'For a correction use + or −, like −2. For damage enter the number lost.' },
          { name: 'note', label: 'Note', full: true },
        ]}
        onSubmit={async (v) => { await api(`/products/${stock.id}/stock`, { body: v }); toast('Stock updated'); done(); }} />}
      {sell && <Sell products={data} onClose={() => setSell(false)} onDone={(id) => router.push(`/billing/${id}`)} />}
      {buy && <Buy products={data} start={buy.start} onClose={() => setBuy(null)} onDone={done} />}
      {newSupplier && <FormModal title="New supplier" fields={supplierFields} onClose={() => setNewSupplier(false)}
        onSubmit={async (v) => { await api('/suppliers', { body: v }); toast('Supplier added'); suppliers.reload(); }} />}
      {supplier && <SupplierView id={supplier} onClose={() => setSupplier(null)} onChanged={done} />}
      {purchase && <PurchaseView id={purchase} onClose={() => setPurchase(null)} onChanged={done} />}
    </>
  );
}
