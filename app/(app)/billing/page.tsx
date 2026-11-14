'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, ReceiptText, Trash2 } from 'lucide-react';
import { api, fmtDate, inr, toast, useApi } from '@/lib/client';
import { Button, Card, Empty, ErrorNote, Loading, MemberPicker, METHODS, PayInputs, Modal, PageHeader, Stat, StatusBadge, Table, Tabs, toPayment } from '@/components/ui';

function NewBill({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [items, setItems] = useState([{ description: '', qty: 1, rate: '' as any }]);
  const [member, setMember] = useState<any>(null);
  const [name, setName] = useState('');
  const [discount, setDiscount] = useState('');
  const [pay, setPay] = useState<any>({ pay_amount: '', pay_method: 'cash' });
  const [err, setErr] = useState<string | null>(null);
  const up = (i: number, patch: any) => setItems(items.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const gross = items.reduce((a, x) => a + Number(x.qty) * (Number(x.rate) || 0), 0);
  return (
    <Modal title="New bill" subtitle="For anything other than memberships, PT or shop items. Those create bills on their own." onClose={onClose} wide>
      <label className="block text-[13px] font-medium text-ink mb-1">Member</label>
      <MemberPicker value={member} onChange={setMember} />
      {!member && <input className="input mt-2" placeholder="Or type a walk-in customer name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Customer name" />}
      <div className="mt-4 space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input className="input flex-1 min-w-0" placeholder="What is this for?" aria-label="Description" value={it.description} onChange={(e) => up(i, { description: e.target.value })} />
            <input className="input !w-16" type="number" min={1} aria-label="Quantity" value={it.qty} onChange={(e) => up(i, { qty: e.target.value })} />
            <input className="input !w-28" type="number" min={0} step="any" placeholder="Price ₹" aria-label="Price" value={it.rate} onChange={(e) => up(i, { rate: e.target.value })} />
            {items.length > 1 && <Button variant="ghost" aria-label="Remove line" onClick={() => setItems(items.filter((_, n) => n !== i))}><Trash2 /></Button>}
          </div>
        ))}
        <Button size="sm" onClick={() => setItems([...items, { description: '', qty: 1, rate: '' }])}><Plus /> Add line</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <div><label htmlFor="bd" className="block text-[13px] font-medium text-ink mb-1">Discount (₹)</label><input id="bd" className="input" type="number" min={0} step="any" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
        <div><label htmlFor="bp" className="block text-[13px] font-medium text-ink mb-1">Received now (₹)</label><input id="bp" className="input" type="number" min={0} step="any" value={pay.pay_amount} onChange={(e) => setPay({ ...pay, pay_amount: e.target.value })} /></div>
        <PayInputs pay={pay} setPay={setPay} amount={pay.pay_amount} />
      </div>
      <div className="bg-canvas rounded-lg p-3 mt-4 flex justify-between"><span className="text-muted">Before discount</span><span className="font-semibold text-ink tabular-nums">{inr(gross)}</span></div>
      {err && <div className="mt-3"><ErrorNote message={err} /></div>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => {
          try {
            const r = await api('/invoices', { body: { member_id: member, customer_name: name, items: items.filter((x) => x.description), discount: Number(discount) || 0, payment: toPayment(pay) } });
            toast('Bill created'); onDone(r.id);
          } catch (e: any) { setErr(e.message); }
        }}>Create bill</Button>
      </div>
    </Modal>
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [tab, setTab] = useState('bills');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(sp.get('new') === '1');
  useEffect(() => { const t = setTimeout(() => setTerm(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (sp.get('new') === '1') setAdding(true); }, [sp]);
  const { data, error, reload } = useApi(`/invoices?status=${status}&q=${encodeURIComponent(term)}`);
  const pays = useApi<any[]>(tab === 'payments' ? '/payments' : null);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const s = data.summary;

  return (
    <>
      <PageHeader title="Bills & Payments" help="Every bill and payment in one place. Click a bill to collect money, print it or show a UPI QR code.">
        <Button variant="primary" onClick={() => setAdding(true)}><Plus /> New bill</Button>
      </PageHeader>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Stat label="Collected today" value={inr(s.today)} />
        <Stat label="Collected this month" value={inr(s.month)} />
        <Stat label="Still to collect" value={inr(s.dues)} hint={`${s.due_count} bills`} tone={s.dues > 0 ? 'red' : undefined} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'bills', label: 'Bills' }, { key: 'payments', label: 'Payments received' }]} />
      {tab === 'bills' ? (
        <Card pad={false}>
          <div className="p-3 flex flex-wrap gap-2 border-b border-line">
            <input className="input sm:max-w-xs" placeholder="Search name, phone or bill number" aria-label="Search bills" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input !w-auto" aria-label="Filter" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All bills</option><option value="due">Money due</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
          <Table rows={data.rows} onRow={(r) => router.push(`/billing/${r.id}`)} empty={<Empty icon={ReceiptText} title="No bills found" text="Bills are created automatically when you sell a membership, PT package or product." />}
            cols={[
              { key: 'invoice_no', label: 'Bill no.', render: (r) => <span className="font-medium text-ink">{r.invoice_no}</span> },
              { key: 'customer_name', label: 'Customer' },
              { key: 'invoice_date', label: 'Date', render: (r) => fmtDate(r.invoice_date) },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'total', label: 'Amount', align: 'right', render: (r) => inr(r.total) },
              { key: 'balance', label: 'Balance', align: 'right', render: (r) => r.status === 'cancelled' || r.balance === 0 ? '—' : <span className="text-rose font-medium">{inr(r.balance)}</span> },
            ]} />
        </Card>
      ) : (
        <Card pad={false}>
          {!pays.data ? <Loading /> : <Table rows={pays.data} onRow={(r) => router.push(`/billing/${r.invoice_id}`)} empty={<Empty title="No payments yet" />}
            cols={[
              { key: 'paid_on', label: 'Date', render: (r) => fmtDate(r.paid_on) },
              { key: 'customer_name', label: 'From', render: (r) => <span className="font-medium text-ink">{r.customer_name}</span> },
              { key: 'invoice_no', label: 'Bill no.' },
              { key: 'method', label: 'Paid by', render: (r) => METHODS.find((m) => m.value === r.method)?.label },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amount) },
            ]} />}
        </Card>
      )}
      {adding && <NewBill onClose={() => setAdding(false)} onDone={(id) => router.push(`/billing/${id}`)} />}
    </>
  );
}

export default function BillingPage() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
