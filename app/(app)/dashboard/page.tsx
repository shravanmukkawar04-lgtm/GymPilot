'use client';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, BarChart3, Check, Circle, Fingerprint, MessageCircle, Package, PhoneCall, ReceiptText, RefreshCw, UserX } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDate, fmtTime, inr, useApi } from '@/lib/client';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Loading, Stat, StatusBadge } from '@/components/ui';
import { useUser } from '@/components/shell';

const INCOME = '#2a78d6';
const SHOP = '#1f9d8a';

/** Rupees for the usual INR account, otherwise the account's own currency code. */
const waMoney = (n: number, currency?: string | null) =>
  !currency || currency === 'INR' ? inr(n) : `${currency} ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n ?? 0))}`;
const SPENDING = '#eb6834';
const AXIS = { tickLine: false as const, axisLine: { stroke: '#d5d9d4' }, tick: { fill: '#626c76', fontSize: 12 } };
const PLAN_COLORS = ['#2a78d6', '#1f9d8a', '#eb6834', '#8b5cf6', '#e0a100', '#94a3b8'];

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

const noData = (what: string) => <Empty icon={BarChart3} title="Nothing to show yet" text={what} />;

/** Members who came in each day over the last 30 days. */
function CheckinsGraph({ rows }: { rows: { label: string; n: number }[] }) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return noData('Once members start scanning in, their daily visits are drawn here.');
  const best = rows.reduce((a, b) => (b.n > a.n ? b : a));
  return (
    <>
      <p className="mb-2 text-[13px] text-muted"><b className="text-ink tabular-nums">{total}</b> visits · about <b className="text-ink tabular-nums">{Math.round(total / rows.length)}</b> a day · busiest {best.label} ({best.n})</p>
      <div className="h-[220px]" role="img" aria-label={`Daily check-ins for the last 30 days, ${total} in total`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ left: 0, right: 8, top: 4 }}>
            <defs><linearGradient id="gCheckins" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={INCOME} stopOpacity={0.35} /><stop offset="100%" stopColor={INCOME} stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#eceeec" />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={{ fill: '#626c76', fontSize: 12 }} />
            <Tooltip formatter={(v: any) => [`${v} check-ins`, '']} separator="" labelStyle={{ fontWeight: 500 }} />
            <Area type="monotone" dataKey="n" stroke={INCOME} strokeWidth={2} fill="url(#gCheckins)" activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** Active members on each plan as a donut. The biggest five plans get a colour each and the rest are added together. */
function PlansGraph({ rows }: { rows: { plan_name: string; n: number }[] }) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return noData('Members appear here by plan once they have a running membership.');
  const top = rows.slice(0, 5);
  const rest = rows.slice(5).reduce((a, r) => a + r.n, 0);
  const data = [...top.map((r) => ({ name: r.plan_name, n: r.n })), ...(rest ? [{ name: 'Other plans', n: rest }] : [])];
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row lg:flex-col xl:flex-row">
      <div className="relative size-[170px] shrink-0" role="img" aria-label={`Active members by plan: ${data.map((r) => `${r.name} ${r.n}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="n" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={data.length > 1 ? 2 : 0} stroke="none">
              {data.map((r, i) => <Cell key={r.name} fill={PLAN_COLORS[i % PLAN_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v: any, name: any) => [`${v} members`, name]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-semibold tabular-nums text-ink">{total}</span><span className="text-xs text-muted">active</span></div>
      </div>
      <ul className="w-full min-w-0 space-y-1.5 text-[13px]">
        {data.map((r, i) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PLAN_COLORS[i % PLAN_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
            <span className="shrink-0 tabular-nums text-muted"><b className="text-ink">{r.n}</b> · {Math.round((r.n / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Members who joined and members who left, month by month. */
function GrowthGraph({ rows }: { rows: { label: string; joined: number; left: number }[] }) {
  if (!rows.some((r) => r.joined || r.left)) return noData('Joins and exits are drawn here once you add members.');
  const joined = rows.reduce((a, r) => a + r.joined, 0), left = rows.reduce((a, r) => a + r.left, 0);
  return (
    <>
      <p className="mb-2 text-[13px] text-muted"><b className="text-brand-dark tabular-nums">+{joined}</b> joined · <b className="text-rose tabular-nums">−{left}</b> left in 6 months</p>
      <div className="h-[220px]" role="img" aria-label={`Members joined and left by month: ${joined} joined and ${left} left in 6 months`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ left: 0, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} stroke="#eceeec" />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={{ fill: '#626c76', fontSize: 12 }} />
            <Tooltip />
            <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 13, color: '#626c76' }} />
            <Line type="monotone" dataKey="joined" name="Joined" stroke={SHOP} strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 0, fill: SHOP }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="left" name="Left" stroke={SPENDING} strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 0, fill: SPENDING }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function OwnerDashboard({ d }: { d: any }) {
  const k = d.kpis;
  const user = useUser();
  const tasks = [
    { n: k.expiring_7, icon: RefreshCw, one: 'membership ends in the next 7 days', many: 'memberships end in the next 7 days', action: 'Renew', href: '/members?status=expiring' },
    { n: k.members_with_dues, icon: ReceiptText, one: `member owes money (${inr(k.dues_total)})`, many: `members owe money (${inr(k.dues_total)} in total)`, action: 'Collect', href: '/billing?status=due' },
    { n: k.followups_due, icon: PhoneCall, one: 'enquiry needs a follow-up call', many: 'enquiries need a follow-up call', action: 'Call', href: '/leads' },
    { n: k.wa_no_credit, icon: MessageCircle, one: 'WhatsApp message was refused because Meta credit ran out', many: 'WhatsApp messages were refused because Meta credit ran out', action: 'Check', href: '/messages?tab=setup' },
    { n: k.messages_queued, icon: MessageCircle, one: 'reminder is ready to send', many: 'reminders are ready to send', action: 'Send', href: '/messages' },
    { n: k.flagged_today, icon: AlertTriangle, one: 'person entered today without a valid membership', many: 'people entered today without a valid membership', action: 'Review', href: '/attendance' },
    { n: k.inactive, icon: UserX, one: 'active member has stopped coming', many: 'active members have stopped coming', action: 'View', href: '/members?status=inactive' },
    { n: k.low_stock, icon: Package, one: 'product is running low', many: 'products are running low', action: 'Restock', href: '/inventory' },
    { n: k.unmatched, icon: Fingerprint, one: 'fingerprint is not linked to anyone', many: 'fingerprints are not linked to anyone', action: 'Link', href: '/attendance?tab=unmatched' },
  ].filter((t) => t.n > 0).map((t) => ({ ...t, text: t.n === 1 ? t.one : t.many }));
  // Membership money is everything collected that is not a shop sale.
  const chart = d.chart.map((c: any) => ({ ...c, members: Math.max(0, Math.round((c.income - c.pos) * 100) / 100) }));
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

      <div className={`grid grid-cols-2 ${k.wa_connected ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3 mb-4`}>
        <Stat label="Active members" value={k.active_members} hint={`${k.new_week} joined this week · ${k.new_month} this month`} href="/members?status=active" />
        <Stat label="Came in today" value={k.checkins_today} hint={`${k.pt_today} PT sessions booked`} href="/attendance" />
        <Stat label="Collected this month" value={inr(k.collected_month)} hint={`${inr(k.collected_month - k.pos_month)} members · ${inr(k.pos_month)} POS · ${inr(k.collected_today)} today`} href="/billing" />
        {k.wa_connected && (
          <Stat label="WhatsApp cost this month" value={waMoney(k.wa_cost_month, k.wa_currency)} href="/messages?tab=setup"
            hint={k.wa_cost_error && !k.wa_messages_month ? 'Could not read from Meta' : `${waMoney(k.wa_cost_marketing, k.wa_currency)} marketing · ${waMoney(k.wa_cost_utility, k.wa_currency)} utility · ${k.wa_messages_month} messages`} />
        )}
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

        <Card title="Money in and out" subtitle="Last 6 months. Collected is split into membership and other bills, and shop (POS) sales. Spending includes salaries paid." className="lg:col-span-3">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} barGap={2} barCategoryGap="28%" margin={{ left: 0, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke="#eceeec" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d5d9d4' }} tick={{ fill: '#626c76', fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#626c76', fontSize: 12 }} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(19,26,34,0.04)' }} />
                <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 13, color: '#626c76' }} />
                <Bar dataKey="members" name="Collected: members" stackId="in" fill={INCOME} maxBarSize={22} />
                <Bar dataKey="pos" name="Collected: POS" stackId="in" fill={SHOP} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="spending" name="Spent" fill={SPENDING} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card title="Daily check-ins" subtitle="Members who came in, last 30 days"><CheckinsGraph rows={d.graphs.checkins} /></Card>
        <Card title="Members by plan" subtitle="Active members on each plan"><PlansGraph rows={d.graphs.plans} /></Card>
        <Card title="Joined and left" subtitle="Last 6 months"><GrowthGraph rows={d.graphs.growth} /></Card>
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
