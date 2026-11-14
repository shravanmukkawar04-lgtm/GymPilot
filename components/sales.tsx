'use client';
import { api, billTotal, inr, useApi, toast } from '@/lib/client';
import { Field, FormModal, paymentFields, syncMixed, toPayment } from './ui';

export function planLabel(p: any) {
  const parts = [p.duration_months ? `${p.duration_months} month${p.duration_months > 1 ? 's' : ''}` : '', p.duration_days ? `${p.duration_days} days` : ''].filter(Boolean);
  return `${p.name} · ${parts.join(' ')} · ${inr(p.price)}`;
}

const time12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
export const slotLabel = (s: any) => `${s.name} · ${time12(s.start_time)}–${time12(s.end_time)}`;

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
  const extra = syncMixed(name, v);
  if (['plan_id', 'package_id', 'discount'].includes(name)) return { ...extra, pay_amount: billTotal(settings, price(v), Number(v.discount) || 0) };
  return extra;
};

/** The slots a member on this plan can choose. A plan without slots can use any slot. */
export const slotsForPlan = (plans: any[], slots: any[], planId: any) => {
  const plan = plans.find((p) => String(p.id) === String(planId));
  const active = slots.filter((s) => s.active);
  const allowed = plan?.slot_ids?.length ? active.filter((s) => plan.slot_ids.includes(s.id)) : active;
  return { plan, allowed, needed: !!plan?.slot_ids?.length };
};

export function slotField(plans: any[], slots: any[]): Field {
  return {
    name: 'slot_id', label: 'Time slot', type: 'select',
    show: (v) => !!v.plan_id && slotsForPlan(plans, slots, v.plan_id).allowed.length > 0,
    required: (v) => slotsForPlan(plans, slots, v.plan_id).needed,
    options: (v) => slotsForPlan(plans, slots, v.plan_id).allowed.map((s) => ({ value: s.id, label: slotLabel(s) })),
    help: (v) => (slotsForPlan(plans, slots, v.plan_id).needed ? 'This plan is sold for these timings only.' : undefined),
  };
}

export function saleFields(plans: any[], slots: any[] = []): Field[] {
  return [
    { name: 'plan_id', label: 'Membership plan', type: 'select', required: true, full: true, options: plans.filter((p) => p.active).map((p) => ({ value: p.id, label: planLabel(p) })) },
    slotField(plans, slots),
    { name: 'start_date', label: 'Start date', type: 'date', help: 'Leave blank to start today or after the current plan ends.' },
    { name: 'discount', label: 'Discount (₹)', type: 'number', min: 0 },
    ...paymentFields,
  ];
}

export const toSale = (v: any) => ({ plan_id: v.plan_id, slot_id: v.slot_id || null, start_date: v.start_date, discount: Number(v.discount) || 0, payment: toPayment(v) });

export function MembershipSale({ member, credit, onClose, onDone }: { member: any; credit?: number; onClose: () => void; onDone: () => void }) {
  // Only this member's branch's plans and slots, even when the owner is looking at all branches.
  const plans = useApi<any[]>(`/plans?member_id=${member.id}`);
  const slots = useApi<any[]>(`/slots?member_id=${member.id}`);
  const settings = useApi('/settings');
  if (!plans.data || !slots.data || !settings.data) return null;
  const price = (v: any) => plans.data!.find((p) => String(p.id) === String(v.plan_id))?.price ?? 0;
  const upgrade = credit !== undefined;
  return (
    <FormModal
      title={upgrade ? `Change plan for ${member.name}` : `Renew ${member.name}`}
      subtitle={upgrade ? 'The current plan stops today and the new one starts. Unused value is offered as a discount.' : 'Choose a plan. A bill is created automatically.'}
      fields={saleFields(plans.data, slots.data)} initial={{ pay_method: 'cash', discount: upgrade ? credit : '', slot_id: member.slot_id ?? '' }}
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
