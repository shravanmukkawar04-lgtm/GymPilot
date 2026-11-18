'use client';
import { api, fmtDate, todayIST, toast } from '@/lib/client';
import { FormModal } from './ui';

const ms = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(ms(iso) + n * 864e5).toISOString().slice(0, 10);
/** Days on hold from the first date to the last, counting both. */
export const holdDays = (from?: string, to?: string) => (from && to ? Math.round((ms(to) - ms(from)) / 864e5) + 1 : 0);

type Member = { name: string; membership_id: number; start_date: string; end_date: string };

/** Hold a membership between two dates. The frozen days are added to the plan's end date. */
export function FreezeModal({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => void }) {
  const planStart = member.start_date.slice(0, 10), planEnd = member.end_date.slice(0, 10);
  const today = todayIST();
  const problem = (from?: string, to?: string) => {
    if (!from || !to) return null;
    if (to < from) return 'The hold cannot end before it starts.';
    if (from < planStart) return `The hold cannot start before the plan starts (${fmtDate(planStart)}).`;
    if (from > planEnd) return `The hold must start before the plan ends (${fmtDate(planEnd)}).`;
    if (holdDays(from, to) > 365) return 'A hold can be at most 365 days.';
    return null;
  };
  return (
    <FormModal title={`Put ${member.name} on hold`} subtitle="Choose the first and last day of the hold. The days on hold are added to the end of the plan, so nothing is lost."
      fields={[
        { name: 'start_date', label: 'Hold from', type: 'date', required: true },
        { name: 'end_date', label: 'Hold until', type: 'date', required: true, help: 'The last day of the hold' },
        { name: 'reason', label: 'Reason', full: true, placeholder: 'Travel, injury…' },
      ]}
      initial={{ start_date: today < planStart ? planStart : today, end_date: '' }} submitLabel="Put on hold" onClose={onClose}
      summary={(v) => {
        const days = holdDays(v.start_date, v.end_date);
        const err = problem(v.start_date, v.end_date);
        return (
          <div className={`rounded-lg p-3 ${err ? 'bg-rose-soft text-rose' : 'bg-canvas'}`}>
            {err ? err : days > 0 ? (
              <>
                <div><b className="text-ink">{days} day{days > 1 ? 's' : ''}</b> on hold</div>
                <div className="text-muted text-[13px] mt-0.5">Plan ends {fmtDate(planEnd)} now · <b className="text-ink">{fmtDate(addDays(planEnd, days))}</b> after the hold</div>
              </>
            ) : <span className="text-muted">Pick both dates to see how many days will be added.</span>}
          </div>
        );
      }}
      onSubmit={async (v) => {
        const err = problem(v.start_date, v.end_date);
        if (err) throw new Error(err);
        const r = await api(`/memberships/${member.membership_id}/freeze`, { body: { start_date: v.start_date, end_date: v.end_date, reason: v.reason } });
        toast(`On hold for ${r.frozen_days} day${r.frozen_days > 1 ? 's' : ''}. Plan now ends ${fmtDate(r.end_date)}`);
        onDone();
      }} />
  );
}
