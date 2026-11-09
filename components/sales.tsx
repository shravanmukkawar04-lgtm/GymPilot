'use client';
import { api, billTotal, inr, useApi, toast } from '@/lib/client';
import { Field, FormModal, paymentFields, toPayment } from './ui';

export function planLabel(p: any) {
  const parts = [p.duration_months ? `${p.duration_months} month${p.duration_months > 1 ? 's' : ''}` : '', p.duration_days ? `${p.duration_days} days` : ''].filter(Boolean);
  return `${p.name} · ${parts.join(' ')} · ${inr(p.price)}`;
}

export function BillSummary({ settings, gross, discount, pay }: { settings: any; gross: number; discount: number; pay: number }) {
  const total = billTotal(settings, gross, discount);
  const due = Math.max(0, total - (pay || 0));
  return (
    <div className="bg-canvas rounded-lg p-3 flex items-center justify-between gap-3">
      <div>
        <div className="text-muted text-xs">Bill total {settings?.gst_enabled ? (settings.prices_include_gst ? '(GST included)' : '(with GST)') : ''}</div>
        <div className="text-lg font-semibold text-ink tabular-nums">{inr(total)}</div>
      </div>
      <div className="text-right">
        <div className="text-muted text-xs">Balance due</div>
        <div className={`text-lg font-semibold tabular-nums ${due > 0 ? 'text-rose' : 'text-brand-dark'}`}>{inr(due)}</div>
      </div>
    </div>
  );
}

/** Keeps "amount received" equal to the bill total while the plan or discount changes. */
export const syncPay = (settings: any, price: (v: any) => number) => (name: string, v: any) => {
  if (['plan_id', 'package_id', 'discount'].includes(name)) return { pay_amount: billTotal(settings, price(v), Number(v.discount) || 0) };
  return {};
};

export function saleFields(plans: any[]): Field[] {
  return [
    { name: 'plan_id', label: 'Membership plan', type: 'select', required: true, full: true, options: plans.filter((p) => p.active).map((p) => ({ value: p.id, label: planLabel(p) })) },
    { name: 'start_date', label: 'Start date', type: 'date', help: 'Leave blank to start today or after the current plan ends.' },
    { name: 'discount', label: 'Discount (₹)', type: 'number', min: 0 },
    ...paymentFields,
  ];
}

export const toSale = (v: any) => ({ plan_id: v.plan_id, start_date: v.start_date, discount: Number(v.discount) || 0, payment: toPayment(v) });

export function MembershipSale({ member, credit, onClose, onDone }: { member: any; credit?: number; onClose: () => void; onDone: () => void }) {
  const plans = useApi<any[]>('/plans');
  const settings = useApi('/settings');
  if (!plans.data || !settings.data) return null;
  const price = (v: any) => plans.data!.find((p) => String(p.id) === String(v.plan_id))?.price ?? 0;
  const upgrade = credit !== undefined;
  return (
    <FormModal
      title={upgrade ? `Change plan for ${member.name}` : `Renew ${member.name}`}
      subtitle={upgrade ? 'The current plan stops today and the new one starts. Unused value is offered as a discount.' : 'Choose a plan. A bill is created automatically.'}
      fields={saleFields(plans.data)} initial={{ pay_method: 'cash', discount: upgrade ? credit : '' }}
      submitLabel={upgrade ? 'Change plan' : 'Renew membership'}
      onChangeValues={syncPay(settings.data, price)}
      summary={(v) => <BillSummary settings={settings.data} gross={price(v)} discount={Number(v.discount) || 0} pay={Number(v.pay_amount) || 0} />}
      onClose={onClose}
      onSubmit={async (v) => {
        await api(`/members/${member.id}/membership`, { body: { ...toSale(v), replace_current: upgrade } });
        toast(upgrade ? 'Plan changed' : 'Membership renewed');
        onDone();
      }}
    />
  );
}
