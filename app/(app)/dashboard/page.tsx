'use client';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Check, Circle, Fingerprint, MessageCircle, Package, PhoneCall, ReceiptText, RefreshCw, UserX } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDate, fmtTime, inr, useApi } from '@/lib/client';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Loading, Stat, StatusBadge } from '@/components/ui';
import { useUser } from '@/components/shell';

const INCOME = '#2a78d6';
const SPENDING = '#eb6834';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-line rounded-lg shadow-md px-3 py-2 text-[13px]">
      <div className="font-medium text-ink mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-muted">
          <span className="size-2.5 rounded-sm" style={{ background: p.fill }} /> {p.name}
          <span className="ml-auto pl-4 text-ink font-medium tabular-nums">{inr(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

const SETUP = [
  { key: 'profile', label: 'Add your gym details and GST number', href: '/settings' },
  { key: 'plans', label: 'Create your membership plans', href: '/members?tab=plans' },
  { key: 'staff', label: 'Add your trainers and staff', href: '/trainers' },
  { key: 'members', label: 'Add your first member', href: '/members?new=1' },
  { key: 'device', label: 'Connect your fingerprint machine', href: '/attendance?tab=devices' },
  { key: 'leads', label: 'Record your first enquiry', href: '/leads?new=1' },
];

function OwnerDashboard({ d }: { d: any }) {
  const k = d.kpis;
  const user = useUser();
  const tasks = [
    { n: k.expiring_7, icon: RefreshCw, one: 'membership ends in the next 7 days', many: 'memberships end in the next 7 days', action: 'Renew', href: '/members?status=expiring' },
    { n: k.members_with_dues, icon: ReceiptText, one: `member owes money (${inr(k.dues_total)})`, many: `members owe money (${inr(k.dues_total)} in total)`, action: 'Collect', href: '/billing?status=due' },
    { n: k.followups_due, icon: PhoneCall, one: 'enquiry needs a follow-up call', many: 'enquiries need a follow-up call', action: 'Call', href: '/leads' },
    { n: k.messages_queued, icon: MessageCircle, one: 'reminder is ready to send', many: 'reminders are ready to send', action: 'Send', href: '/messages' },
    { n: k.flagged_today, icon: AlertTriangle, one: 'person entered today without a valid membership', many: 'people entered today without a valid membership', action: 'Review', href: '/attendance' },
    { n: k.inactive, icon: UserX, one: 'active member has stopped coming', many: 'active members have stopped coming', action: 'View', href: '/members?status=inactive' },
    { n: k.low_stock, icon: Package, one: 'product is running low', many: 'products are running low', action: 'Restock', href: '/inventory' },
    { n: k.unmatched, icon: Fingerprint, one: 'fingerprint is not linked to anyone', many: 'fingerprints are not linked to anyone', action: 'Link', href: '/attendance?tab=unmatched' },
  ].filter((t) => t.n > 0).map((t) => ({ ...t, text: t.n === 1 ? t.one : t.many }));
  const setupDone = SETUP.filter((s) => d.setup[s.key]).length;

  return (
    <>
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold">{greeting()}, {user.name.split(' ')[0]}</h1>
        <p className="text-muted mt-0.5">Here is what is happening at your gym today.</p>
      </div>

      {setupDone < SETUP.length && (
        <Card title="Get your gym ready" subtitle={`${setupDone} of ${SETUP.length} steps done`} className="mb-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1">
            {SETUP.map((s) => (
              <Link key={s.key} href={s.href} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-canvas">
                {d.setup[s.key] ? <Check className="size-4 text-brand shrink-0" /> : <Circle className="size-4 text-faint shrink-0" />}
                <span className={d.setup[s.key] ? 'text-muted line-through' : 'text-ink'}>{s.label}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Active members" value={k.active_members} hint={`${k.new_month} joined this month`} href="/members?status=active" />
        <Stat label="Came in today" value={k.checkins_today} hint={`${k.pt_today} PT sessions booked`} href="/attendance" />
        <Stat label="Collected this month" value={inr(k.collected_month)} hint={`${inr(k.collected_today)} today`} href="/billing" />
        <Stat label="Money still due" value={inr(k.dues_total)} hint={`from ${k.members_with_dues} members`} href="/billing?status=due" tone={k.dues_total > 0 ? 'red' : undefined} />
      </div>

      <div className="grid lg:grid-cols-5 gap-4 mb-4">
        <Card title="What needs your attention" subtitle="Clear these and your day is done" className="lg:col-span-2" pad={false}>
          {tasks.length === 0
            ? <Empty icon={Check} title="All caught up" text="Nothing needs your attention right now." />
            : <ul className="pb-1.5">
              {tasks.map((t) => (
                <li key={t.href + t.text}>
                  <Link href={t.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-canvas text-muted"><t.icon className="size-4" /></span>
                    <span className="flex-1 min-w-0"><b className="text-ink tabular-nums">{t.n}</b> {t.text}</span>
                    <span className="text-brand font-medium inline-flex items-center gap-0.5">{t.action}<ArrowRight className="size-3.5" /></span>
                  </Link>
                </li>
              ))}
            </ul>}
        </Card>

        <Card title="Money in and out" subtitle="Last 6 months. Spending includes salaries paid." className="lg:col-span-3">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.chart} barGap={2} barCategoryGap="28%" margin={{ left: 0, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke="#eceeec" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d5d9d4' }} tick={{ fill: '#626c76', fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#626c76', fontSize: 12 }} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(19,26,34,0.04)' }} />
                <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 13, color: '#626c76' }} />
                <Bar dataKey="income" name="Collected" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="spending" name="Spent" fill={SPENDING} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Latest check-ins" action={<Button size="sm" variant="ghost" href="/attendance">See all</Button>} pad={false}>
        {d.recent.length === 0
          ? <Empty icon={Fingerprint} title="No one has checked in yet today" text="Check-ins appear here as members scan their finger." />
          : <ul className="pb-1.5">
            {d.recent.map((r: any) => (
              <li key={r.id}>
                <Link href={`/members/${r.member_id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-canvas">
                  <Avatar name={r.name} size={32} />
                  <span className="flex-1 min-w-0"><span className="font-medium text-ink">{r.name}</span> <span className="text-muted">{r.plan_name ?? ''}</span></span>
                  {!r.membership_ok && <Badge tone="red">Membership not valid</Badge>}
                  <span className="text-muted tabular-nums">{fmtTime(r.check_in)}</span>
                </Link>
              </li>
            ))}
          </ul>}
      </Card>
    </>
  );
}

function TrainerDashboard({ d }: { d: any }) {
  const k = d.kpis;
  const user = useUser();
  return (
    <>
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold">{greeting()}, {user.name.split(' ')[0]}</h1>
        <p className="text-muted mt-0.5">Your clients and sessions for today.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Sessions today" value={k.sessions_today} href="/pt" />
        <Stat label="My clients" value={k.clients} href="/pt?tab=clients" />
        <Stat label="Sessions done this month" value={k.completed_month} />
        <Stat label="Commission this month" value={inr(k.commission_month)} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Today's sessions" action={<Button size="sm" variant="ghost" href="/pt">Open schedule</Button>} pad={false}>
          {d.sessions.length === 0 ? <Empty title="No sessions today" /> : (
            <ul className="pb-1.5">{d.sessions.map((s: any) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="tabular-nums text-muted w-16 shrink-0">{fmtTime(s.scheduled_at)}</span>
                <span className="flex-1 min-w-0 font-medium text-ink">{s.member_name}</span>
                <StatusBadge status={s.status} />
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="Clients to renew soon" subtitle="2 or fewer sessions left, or ending within 7 days" pad={false}>
          {d.lowClients.length === 0 ? <Empty title="No renewals coming up" /> : (
            <ul className="pb-1.5">{d.lowClients.map((c: any) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 min-w-0 font-medium text-ink">{c.member_name}</span>
                <span className="text-muted">{c.remaining} left · ends {fmtDate(c.end_date)}</span>
              </li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { data, error, reload } = useApi('/dashboard');
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  return data.kind === 'trainer' ? <TrainerDashboard d={data} /> : <OwnerDashboard d={data} />;
}
