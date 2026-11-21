'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api, fmtDate, inr, todayIST, toast, useApi } from '@/lib/client';
import { FormModal, Loading, Modal, paymentFields, syncMixed, toPayment } from './ui';

type Owing = { key: string; name: string; phone: string | null; ids: number[]; owed: number; oldest: string };

/** Groups unpaid bills by customer, so one person with several bills shows once with the total they owe. */
function byCustomer(bills: any[]): Owing[] {
  const map = new Map<string, Owing>();
  for (const b of bills) {
    const key = b.member_id ? `m${b.member_id}` : `${b.customer_name}|${b.customer_phone ?? ''}`;
    const cur: Owing = map.get(key) ?? { key, name: b.customer_name, phone: b.customer_phone, ids: [], owed: 0, oldest: b.invoice_date };
    cur.ids.push(b.id);
    cur.owed = Math.round((cur.owed + Number(b.balance)) * 100) / 100;
    if (b.invoice_date < cur.oldest) cur.oldest = b.invoice_date;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.owed - a.owed);
}

/** Quick add → Collect dues: find who owes money, then take what they are paying now. */
export function CollectDues({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Owing | null>(null);
  useEffect(() => { const t = setTimeout(() => setTerm(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, error } = useApi(`/invoices?status=due&q=${encodeURIComponent(term)}`);
  const people = useMemo(() => (data ? byCustomer(data.rows) : []), [data]);

  if (picked) {
    return (
      <FormModal title={`Collect dues from ${picked.name}`} submitLabel="Save payment" onClose={onClose}
        subtitle={`They owe ${inr(picked.owed)} on ${picked.ids.length} bill${picked.ids.length > 1 ? 's' : ''}. The payment goes to the oldest bill first.`}
        initial={{ pay_amount: picked.owed, pay_method: 'cash', paid_on: todayIST() }}
        fields={[...paymentFields.map((f) => (f.name === 'pay_amount' ? { ...f, label: 'Amount received (₹)', required: true, help: 'Enter less if they are paying only part of it.' } : f)), { name: 'paid_on', label: 'Date', type: 'date', max: todayIST }]}
        onChangeValues={syncMixed}
        summary={(v) => (
          <div className="bg-canvas rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="text-muted text-xs">Still owed after this</div>
            <div className="text-lg font-semibold tabular-nums text-ink">{inr(Math.max(0, picked.owed - (Number(v.pay_amount) || 0)))}</div>
          </div>
        )}
        onSubmit={async (v) => {
          const p = toPayment(v);
          if (!p) throw new Error('Enter the amount received');
          if ((Number(v.pay_amount) || 0) > picked.owed + 0.005) throw new Error(`They owe only ${inr(picked.owed)}`);
          const payments = (Array.isArray(p) ? p : [p]).map((x) => ({ ...x, paid_on: v.paid_on }));
          const r = await api('/invoices/collect-dues', { body: { invoice_ids: picked.ids, payments } });
          toast(r.still_due > 0 ? `Payment saved. ${inr(r.still_due)} is still due` : 'Payment saved. Nothing is due now');
          onDone?.();
        }} />
    );
  }

  return (
    <Modal title="Collect dues" subtitle="Choose the person who is paying what they owe." onClose={onClose}>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-3 size-4 text-faint" />
        <input className="input !pl-9" autoFocus placeholder="Search name or phone number" aria-label="Search who owes" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error ? <p className="text-rose text-[13px]">{error}</p> : !data ? <Loading /> : !people.length ? (
        <p className="text-muted py-6 text-center">{term ? 'Nobody with dues matches this search.' : 'Nobody owes any money right now.'}</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-line border border-line rounded-lg">
          {people.map((p) => (
            <li key={p.key}>
              <button type="button" className="w-full text-left px-3 py-2.5 hover:bg-canvas flex items-center justify-between gap-3" onClick={() => setPicked(p)}>
                <span className="min-w-0">
                  <span className="block font-medium text-ink truncate">{p.name}</span>
                  <span className="block text-muted text-[13px]">{p.phone ?? 'No phone'} · {p.ids.length} bill{p.ids.length > 1 ? 's' : ''} · since {fmtDate(p.oldest)}</span>
                </span>
                <span className="text-rose font-semibold tabular-nums shrink-0">{inr(p.owed)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.rows.length >= 200 && <p className="text-muted text-[13px] mt-2">Showing the first 200 unpaid bills. Search by name to find someone else.</p>}
    </Modal>
  );
}
