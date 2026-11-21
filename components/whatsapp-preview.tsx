'use client';
import { BadgeCheck, BatteryFull, ChevronLeft, MoreVertical, Mic, Phone, Plus, Signal, Smile, Video, Wifi } from 'lucide-react';
import { Badge, WaText } from './ui';

/** Example details shown in previews, so a template reads like a real message. Real messages use each person's own details. */
export const SAMPLE_VALUES: Record<string, string> = {
  name: 'Rohan Patil', plan: 'Quarterly plan', package: 'Quarterly plan', expiry_date: '25 Dec 2026', start_date: '25 Sep 2026', days_left: '7', due_date: '30 Nov 2026',
  total_fee: '₹4,000', paid_amount: '₹2,500', payment_method: 'UPI', amount_due: '₹1,500', due_amount: '₹1,500', username: 'M0042', login_url: 'yourgym.com/login',
  receipt_no: 'FIT/26-27/0042', previously_paid: '₹1,000', payment_received: '₹1,500', outstanding_balance: '₹1,500', payment_date: '21 Nov 2026',
  bill_no: 'FIT/26-27/0051', invoice_no: 'FIT/26-27/0051', products: 'Whey protein × 1', purchase_date: '21 Nov 2026', total_amount: '₹2,000', discount: '₹200',
  payable_amount: '₹1,800', pos_paid_amount: '₹1,800', pos_payment_method: 'Cash', remaining_amount: '₹0', outstanding_amount: '₹600', resume_date: '05 Dec 2026',
  employee_id: 'EMP012', department: 'Training', designation: 'Trainer', joining_date: '21 Nov 2026',
  holiday_name: 'Diwali', holiday_date: '8 Nov', reopen_date: '10 Nov', open_time: '7 AM', close_time: '12 PM',
  addon_package: 'Personal training',
};

const BLANK = /\{\{\s*(\w+)\s*\}\}/g;
/** Fills a template's blanks with example details, plus the gym's own name, phone and email when known. */
export const withSamples = (body: string, gym?: { gym_name?: string | null; phone?: string | null; email?: string | null }, extra: Record<string, string> = {}) => {
  const values: Record<string, string> = { ...SAMPLE_VALUES, gym_name: gym?.gym_name || 'Your gym', contact_phone: gym?.phone || '98765 43210', contact_email: gym?.email || 'info@yourgym.com', ...extra };
  return body.replace(BLANK, (m, k) => values[k] || m);
};

const STATUS: Record<string, [string, string]> = { APPROVED: ['green', 'Approved'], PENDING: ['amber', 'Waiting for Meta'], REJECTED: ['red', 'Rejected'], PAUSED: ['red', 'Paused by Meta'], DISABLED: ['red', 'Disabled by Meta'] };
/** Where a template stands with WhatsApp. */
export function WaStatus({ t }: { t: { wa_status?: string | null } }) {
  if (!t.wa_status) return <Badge>Not submitted</Badge>;
  const [tone, label] = STATUS[t.wa_status] ?? ['gray', t.wa_status];
  return <Badge tone={tone}>{label}</Badge>;
}

const WALLPAPER = { backgroundColor: '#efeae2', backgroundImage: 'radial-gradient(rgba(0,0,0,0.045) 1px, transparent 1px)', backgroundSize: '14px 14px' };

/**
 * A message as it looks in WhatsApp on a phone: status bar, chat header with the gym's name, the message bubble
 * with its bold and italic, the time, and the reply box. Long messages scroll inside the chat.
 */
export function PhoneMock({ gymName, header, body, footer, time = '9:41 AM' }: { gymName?: string | null; header?: string | null; body: string; footer?: string | null; time?: string }) {
  const name = gymName?.trim() || 'Your gym';
  return (
    <figure aria-label={`Preview of the WhatsApp message from ${name}`} className="mx-auto w-full max-w-[300px] rounded-[2.4rem] bg-[#16181b] p-[7px] shadow-xl ring-1 ring-black/10">
      <div className="relative overflow-hidden rounded-[1.9rem] bg-[#efeae2]">
        <div className="absolute left-1/2 top-0 z-10 h-[15px] w-24 -translate-x-1/2 rounded-b-2xl bg-[#16181b]" aria-hidden />

        {/* Phone status bar and WhatsApp header */}
        <div className="bg-[#008069] text-white">
          <div className="flex items-center justify-between px-5 pt-1.5 text-[11px] font-semibold tabular-nums" aria-hidden>
            <span>9:41</span>
            <span className="flex items-center gap-1"><Signal className="size-3" /><Wifi className="size-3" /><BatteryFull className="size-3.5" /></span>
          </div>
          <div className="flex items-center gap-1.5 px-2 pb-2 pt-2.5">
            <ChevronLeft className="size-5 shrink-0" aria-hidden />
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/25 text-[13px] font-semibold" aria-hidden>{name[0]?.toUpperCase()}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="flex items-center gap-1 text-[14px] font-medium"><span className="truncate">{name}</span><BadgeCheck className="size-3.5 shrink-0 fill-[#25d366] text-[#008069]" /></span>
              <span className="block text-[10.5px] text-white/80">Business account</span>
            </span>
            <Video className="size-[18px] shrink-0" aria-hidden /><Phone className="size-[17px] shrink-0" aria-hidden /><MoreVertical className="size-[18px] shrink-0" aria-hidden />
          </div>
        </div>

        {/* Chat */}
        <div className="max-h-[420px] min-h-[300px] overflow-y-auto px-2.5 pb-4 pt-3" style={WALLPAPER}>
          <div className="mb-2.5 flex justify-center"><span className="rounded-md bg-white/85 px-2 py-0.5 text-[10.5px] font-medium text-[#54656f] shadow-sm">TODAY</span></div>
          <div className="relative max-w-[92%]">
            <span className="absolute -left-[5px] top-0 size-2.5 bg-white [clip-path:polygon(100%_0,0_0,100%_100%)]" aria-hidden />
            <div className="rounded-lg rounded-tl-none bg-white px-2.5 pb-1.5 pt-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
              {header && <div className="mb-0.5 text-[13px] font-semibold text-[#111b21]">{header}</div>}
              <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.35] text-[#111b21]">
                {body.trim() ? <WaText text={body} /> : <span className="italic text-[#8696a0]">Your message appears here</span>}
              </div>
              {footer && <div className="mt-1 text-[11.5px] text-[#667781]">{footer}</div>}
              <div className="mt-0.5 text-right text-[10px] text-[#667781]">{time}</div>
            </div>
          </div>
        </div>

        {/* Reply box */}
        <div className="flex items-center gap-1.5 bg-[#efeae2] px-2 pb-3 pt-1.5" aria-hidden>
          <div className="flex h-9 flex-1 items-center gap-2 rounded-full bg-white px-2.5 text-[#667781] shadow-sm">
            <Smile className="size-[18px]" /><span className="flex-1 text-[13px]">Message</span><Plus className="size-[18px]" />
          </div>
          <span className="grid size-9 place-items-center rounded-full bg-[#008069] text-white"><Mic className="size-[18px]" /></span>
        </div>
      </div>
    </figure>
  );
}
