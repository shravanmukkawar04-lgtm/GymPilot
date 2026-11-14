'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, Ban, IndianRupee, MessageCircle, Printer, X } from 'lucide-react';
import { api, fmtDate, inr, toast, todayIST, useApi, waLink } from '@/lib/client';
import { Button, Card, Confirm, ErrorNote, FormModal, Loading, METHODS, paymentFields, StatusBadge, syncMixed, toPayment } from '@/components/ui';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim();
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred ${words(n % 100)}`.trim();
  if (n < 100000) return `${words(Math.floor(n / 1000))} Thousand ${words(n % 1000)}`.trim();
  if (n < 10000000) return `${words(Math.floor(n / 100000))} Lakh ${words(n % 100000)}`.trim();
  return `${words(Math.floor(n / 10000000))} Crore ${words(n % 10000000)}`.trim();
}
function rupeesInWords(n: number) {
  const r = Math.floor(n);
  const p = Math.round((n - r) * 100);
  return `Rupees ${words(r) || 'Zero'}${p ? ` and ${words(p)} Paise` : ''} Only`;
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi(`/invoices/${id}`);
  const [collect, setCollect] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [voidPay, setVoidPay] = useState<any>(null);
  const [qr, setQr] = useState<string | null>(null);

  const inv = data?.invoice; const s = data?.settings;
  useEffect(() => {
    if (!inv || !s?.upi_id || inv.balance <= 0 || inv.status === 'cancelled') return setQr(null);
    const url = `upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.gym_name)}&am=${inv.balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.invoice_no)}`;
    QRCode.toDataURL(url, { width: 180, margin: 1 }).then(setQr);
  }, [inv, s]);

  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const gst = s.gst_enabled;
  const open = inv.status !== 'cancelled';
  const message = `Hi ${inv.customer_name}, your bill ${inv.invoice_no} from ${s.gym_name}: total ${inr(inv.total)}, paid ${inr(inv.paid)}, balance ${inr(inv.balance)}.${s.upi_id && inv.balance > 0 ? ` Pay by UPI to ${s.upi_id}.` : ''} Thank you!`;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 no-print">
        <Link href="/billing" className="inline-flex items-center gap-1 text-muted hover:text-ink"><ArrowLeft className="size-4" /> All bills</Link>
        <div className="flex flex-wrap gap-2">
          {open && inv.balance > 0 && <Button variant="primary" onClick={() => setCollect(true)}><IndianRupee /> Collect payment</Button>}
          {inv.customer_phone && <Button href={waLink(inv.customer_phone, message)} target="_blank" rel="noreferrer"><MessageCircle /> Send on WhatsApp</Button>}
          <Button onClick={() => window.print()}><Printer /> Print</Button>
          {open && <Button variant="danger" onClick={() => setCancel(true)}><Ban /> Cancel bill</Button>}
        </div>
      </div>

      <div className="print-area bg-surface border border-line rounded-xl p-6">
        <div className="flex flex-wrap justify-between gap-4 pb-4 border-b border-line">
          <div>
            <div className="text-lg font-semibold text-ink">{s.gym_name}</div>
            {s.address && <div className="text-muted whitespace-pre-line">{s.address}</div>}
            {s.phone && <div className="text-muted">{s.phone}</div>}
            {gst && s.gstin && <div className="text-ink mt-1">GSTIN: {s.gstin}</div>}
          </div>
          <div className="text-right">
            <div className="font-semibold text-ink">{gst ? 'TAX INVOICE' : 'BILL'}</div>
            <div className="text-ink mt-1">{inv.invoice_no}</div>
            <div className="text-muted">Date: {fmtDate(inv.invoice_date)}</div>
            <div className="mt-1"><StatusBadge status={inv.status} /></div>
          </div>
        </div>
        <div className="py-3">
          <div className="text-muted text-[13px]">Billed to</div>
          <div className="font-medium text-ink">{inv.customer_name}</div>
          {inv.customer_phone && <div className="text-muted">{inv.customer_phone}</div>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-y border-line text-xs text-muted text-right">
              <th className="py-2 pr-2 text-left font-medium">Item</th>
              {gst && <th className="py-2 px-2 text-left font-medium">SAC/HSN</th>}
              <th className="py-2 px-2 font-medium">Qty</th><th className="py-2 px-2 font-medium">Rate</th>
              {gst && <th className="py-2 px-2 font-medium">Taxable</th>}{gst && <th className="py-2 px-2 font-medium">GST</th>}
              <th className="py-2 pl-2 font-medium">Amount</th>
            </tr></thead>
            <tbody>
              {data.items.map((it: any) => (
                <tr key={it.id} className="border-b border-line text-right tabular-nums">
                  <td className="py-2 pr-2 text-left text-ink">{it.description}</td>
                  {gst && <td className="py-2 px-2 text-left">{it.sac_hsn ?? '—'}</td>}
                  <td className="py-2 px-2">{it.qty}</td><td className="py-2 px-2">{inr(it.rate)}</td>
                  {gst && <td className="py-2 px-2">{inr(it.taxable)}</td>}{gst && <td className="py-2 px-2">{it.gst_rate}%</td>}
                  <td className="py-2 pl-2 text-ink">{inr(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-between gap-6 mt-4">
          <div className="flex-1 min-w-48">
            <p className="text-muted text-[13px]">{rupeesInWords(inv.total)}</p>
            {qr && <div className="mt-3 flex items-center gap-3"><img src={qr} alt="UPI QR code" className="size-28" /><div className="text-muted text-[13px]">Scan to pay<br /><b className="text-ink">{inr(inv.balance)}</b> by UPI</div></div>}
            {s.invoice_terms && <p className="text-muted text-xs mt-3 whitespace-pre-line">{s.invoice_terms}</p>}
          </div>
          <dl className="w-64 space-y-1 tabular-nums">
            {inv.discount > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd>−{inr(inv.discount)}</dd></div>}
            {gst && <div className="flex justify-between"><dt className="text-muted">Taxable value</dt><dd>{inr(inv.taxable)}</dd></div>}
            {gst && <div className="flex justify-between"><dt className="text-muted">CGST</dt><dd>{inr(inv.cgst)}</dd></div>}
            {gst && <div className="flex justify-between"><dt className="text-muted">SGST</dt><dd>{inr(inv.sgst)}</dd></div>}
            <div className="flex justify-between font-semibold text-ink text-base pt-1 border-t border-line"><dt>Total</dt><dd>{inr(inv.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd>{inr(inv.paid)}</dd></div>
            <div className={`flex justify-between font-medium ${inv.balance > 0 && open ? 'text-rose' : ''}`}><dt>Balance</dt><dd>{inr(open ? inv.balance : 0)}</dd></div>
          </dl>
        </div>
        {inv.cancel_reason && <p className="text-rose mt-3">Cancelled: {inv.cancel_reason}</p>}
      </div>

      {data.payments.length > 0 && (
        <Card title="Payments on this bill" className="mt-4 no-print">
          <ul className="divide-y divide-line">
            {data.payments.map((p: any) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <span className="text-muted w-24">{fmtDate(p.paid_on)}</span>
                <span className={`flex-1 ${p.voided ? 'line-through text-faint' : ''}`}>{METHODS.find((m) => m.value === p.method)?.label}{p.reference ? ` · ${p.reference}` : ''}</span>
                <span className={`tabular-nums font-medium ${p.voided ? 'line-through text-faint' : 'text-ink'}`}>{inr(p.amount)}</span>
                {!p.voided && open && <button className="p-1 text-faint hover:text-rose" aria-label="Remove payment" onClick={() => setVoidPay(p)}><X className="size-4" /></button>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {collect && <FormModal title="Collect payment" subtitle={`Balance due: ${inr(inv.balance)}`} initial={{ pay_amount: inv.balance, pay_method: 'cash', paid_on: todayIST() }} submitLabel="Save payment" onClose={() => setCollect(false)}
        fields={[...paymentFields.map((f) => (f.name === 'pay_amount' ? { ...f, label: 'Amount received (₹)', required: true, help: undefined } : f)), { name: 'paid_on', label: 'Date', type: 'date' }]}
        onChangeValues={syncMixed}
        onSubmit={async (v) => {
          const p = toPayment(v);
          if (!p) throw new Error('Enter the amount received');
          const list = (Array.isArray(p) ? p : [p]).map((x) => ({ ...x, paid_on: v.paid_on }));
          await api(`/invoices/${id}/payments`, { body: { payments: list } });
          toast('Payment saved'); reload();
        }} />}
      {cancel && <FormModal title="Cancel this bill?" subtitle="Any membership, PT package or stock on this bill is reversed." submitLabel="Cancel bill" onClose={() => setCancel(false)}
        fields={[{ name: 'reason', label: 'Reason', required: true, full: true }]}
        onSubmit={async (v) => { await api(`/invoices/${id}/cancel`, { body: v }); toast('Bill cancelled'); reload(); }} />}
      {voidPay && <Confirm danger title="Remove this payment?" text={`${inr(voidPay.amount)} will be added back to the balance due.`} confirmLabel="Remove payment" onClose={() => setVoidPay(null)}
        onConfirm={async () => { await api(`/payments/${voidPay.id}/void`, { body: {} }); toast('Payment removed'); reload(); }} />}
    </div>
  );
}
