'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarPlus, Check, Dumbbell, Plus, X } from 'lucide-react';
import { api, billTotal, fmtDate, fmtTime, inr, todayIST, toast, useApi } from '@/lib/client';
import { Badge, Button, Card, Empty, ErrorNote, Field, FormModal, Loading, PageHeader, paymentFields, StatusBadge, Table, Tabs, toPayment } from '@/components/ui';
import { BillSummary, syncPay } from '@/components/sales';
import { canSee, useUser } from '@/components/shell';

function SellPackage({ options, onClose, onDone }: { options: any; onClose: () => void; onDone: () => void }) {
  const settings = useApi('/settings');
  if (!settings.data) return null;
  const price = (v: any) => options.packages.find((p: any) => String(p.id) === String(v.package_id))?.price ?? 0;
  const fields: Field[] = [
    { name: 'member_id', label: 'Member', type: 'member', required: true },
    { name: 'trainer_id', label: 'Trainer', type: 'select', required: true, options: options.trainers.map((t: any) => ({ value: t.id, label: t.name })) },
    { name: 'package_id', label: 'Package', type: 'select', required: true, options: options.packages.map((p: any) => ({ value: p.id, label: `${p.name} · ${p.sessions} sessions · ${inr(p.price)}` })) },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'discount', label: 'Discount (₹)', type: 'number', min: 0 },
    ...paymentFields,
  ];
  return <FormModal title="Sell a PT package" subtitle="A bill is created automatically." fields={fields} initial={{ pay_method: 'cash', start_date: todayIST() }} submitLabel="Sell package"
    onChangeValues={syncPay(settings.data, price)} onClose={onClose}
    summary={(v) => <BillSummary settings={settings.data} gross={price(v)} discount={Number(v.discount) || 0} pay={Number(v.pay_amount) || 0} />}
    onSubmit={async (v) => { await api('/pt/subscriptions', { body: { member_id: v.member_id, trainer_id: v.trainer_id, package_id: v.package_id, start_date: v.start_date, discount: Number(v.discount) || 0, payment: toPayment(v) } }); toast('Package sold'); onDone(); }} />;
}

function Schedule({ options, reloadOptions }: { options: any; reloadOptions: () => void }) {
  const [day, setDay] = useState(todayIST());
  const { data, error, reload } = useApi<any[]>(`/pt/sessions?date=${day}`);
  const [book, setBook] = useState(false);
  const setStatus = async (id: number, status: string) => {
    try { await api(`/pt/sessions/${id}/status`, { body: { status } }); toast('Updated'); reload(); reloadOptions(); } catch (e: any) { toast(e.message, 'error'); }
  };
  const open = options.subscriptions.filter((s: any) => s.used_sessions + s.booked < s.total_sessions);
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-line">
        <input className="input !w-auto" type="date" aria-label="Date" value={day} onChange={(e) => setDay(e.target.value)} />
        <Button variant="primary" onClick={() => setBook(true)}><CalendarPlus /> Book a session</Button>
      </div>
      {error ? <div className="p-4"><ErrorNote message={error} retry={reload} /></div> : !data ? <Loading /> : (
        <Table rows={data} empty={<Empty icon={Dumbbell} title={`No sessions on ${fmtDate(day)}`} text="Book a session to see it here." />}
          cols={[
            { key: 't', label: 'Time', render: (r) => <span className="tabular-nums font-medium text-ink">{fmtTime(r.scheduled_at)}</span> },
            { key: 'member_name', label: 'Client', render: (r) => <span><span className="block font-medium text-ink">{r.member_name}</span><span className="text-muted text-[13px]">{r.package_name} · {r.used_sessions} of {r.total_sessions} used</span></span> },
            { key: 'trainer_name', label: 'Trainer' },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'a', label: '', align: 'right', render: (r) => r.status === 'scheduled' ? (
              <span className="inline-flex gap-1.5">
                <Button size="sm" variant="primary" onClick={() => setStatus(r.id, 'completed')}><Check /> Done</Button>
                <Button size="sm" onClick={() => setStatus(r.id, 'no_show')}>Did not come</Button>
                <Button size="sm" variant="ghost" aria-label="Cancel session" onClick={() => setStatus(r.id, 'cancelled')}><X /></Button>
              </span>) : <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, 'scheduled')}>Undo</Button> },
          ]} />
      )}
      {book && <FormModal title="Book a session"
        fields={[
          { name: 'subscription_id', label: 'Client', type: 'select', required: true, full: true, options: open.map((s: any) => ({ value: s.id, label: `${s.member_name} (${s.total_sessions - s.used_sessions - s.booked} sessions left) · ${s.trainer_name}` })), help: open.length ? undefined : 'No client has sessions left to book. Sell a package first.' },
          { name: 'scheduled_at', label: 'Date and time', type: 'datetime-local', required: true },
          { name: 'duration_min', label: 'Minutes', type: 'number', min: 10 },
          { name: 'notes', label: 'Plan for this session', type: 'textarea' },
        ]}
        initial={{ scheduled_at: `${day}T07:00`, duration_min: 60 }} submitLabel="Book session" onClose={() => setBook(false)}
        onSubmit={async (v) => { await api('/pt/sessions', { body: v }); toast('Session booked'); reload(); reloadOptions(); }} />}
    </Card>
  );
}

function Clients({ options, reloadOptions, owner }: { options: any; reloadOptions: () => void; owner: boolean }) {
  const { data, reload } = useApi<any[]>('/pt/subscriptions');
  const [sell, setSell] = useState(false);
  if (!data) return <Loading />;
  return (
    <Card pad={false} title="PT clients" subtitle="Who is training, with whom, and how many sessions are left" action={owner ? <Button variant="primary" onClick={() => setSell(true)}><Plus /> Sell package</Button> : undefined}>
      <Table rows={data} empty={<Empty icon={Dumbbell} title="No PT clients yet" text={owner ? 'Sell a package to get started.' : 'Clients assigned to you will appear here.'} />}
        cols={[
          { key: 'member_name', label: 'Client', render: (r) => <span><span className="block font-medium text-ink">{r.member_name}</span><span className="text-muted text-[13px]">{r.member_phone}</span></span> },
          { key: 'package_name', label: 'Package' },
          { key: 'trainer_name', label: 'Trainer' },
          { key: 'u', label: 'Sessions', render: (r) => (
            <div className="min-w-28">
              <div className="text-[13px] mb-1 tabular-nums">{r.used_sessions} of {r.total_sessions} used</div>
              <div className="h-1.5 rounded-full bg-slate-soft overflow-hidden"><div className="h-full bg-brand rounded-full" style={{ width: `${(r.used_sessions / r.total_sessions) * 100}%` }} /></div>
            </div>) },
          { key: 'end_date', label: 'Valid till', render: (r) => fmtDate(r.end_date) },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      {sell && <SellPackage options={options} onClose={() => setSell(false)} onDone={() => { reload(); reloadOptions(); }} />}
    </Card>
  );
}

function Packages() {
  const { data, reload } = useApi<any[]>('/pt/packages');
  const [edit, setEdit] = useState<any>(null);
  if (!data) return <Loading />;
  const blank = { sessions: 12, validity_days: 30, active: true };
  return (
    <Card pad={false} title="PT packages" subtitle="The training packages you sell" action={<Button variant="primary" onClick={() => setEdit(blank)}><Plus /> Add package</Button>}>
      <Table rows={data} onRow={setEdit} empty={<Empty icon={Dumbbell} title="No packages yet" action={<Button variant="primary" onClick={() => setEdit(blank)}>Create a package</Button>} />}
        cols={[
          { key: 'name', label: 'Package', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
          { key: 'sessions', label: 'Sessions', align: 'right' },
          { key: 'validity_days', label: 'Valid for (days)', align: 'right' },
          { key: 'active_clients', label: 'Clients now', align: 'right' },
          { key: 'price', label: 'Price', align: 'right', render: (r) => inr(r.price) },
          { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'On sale' : 'Hidden'}</Badge> },
        ]} />
      {edit && <FormModal title={edit.id ? 'Edit package' : 'Add package'} initial={edit} onClose={() => setEdit(null)}
        fields={[
          { name: 'name', label: 'Package name', required: true, full: true, placeholder: '12 sessions in 1 month' },
          { name: 'sessions', label: 'Number of sessions', type: 'number', min: 1, required: true },
          { name: 'validity_days', label: 'Valid for (days)', type: 'number', min: 1, required: true },
          { name: 'price', label: 'Price (₹)', type: 'number', min: 0, required: true },
          { name: 'active', label: 'Available for sale', type: 'checkbox' },
        ]}
        onSubmit={async (v) => { await api(edit.id ? `/pt/packages/${edit.id}` : '/pt/packages', { method: edit.id ? 'PUT' : 'POST', body: v }); toast('Package saved'); reload(); }} />}
    </Card>
  );
}

function Inner() {
  const user = useUser();
  const owner = canSee(user, 'pt_manage');
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') ?? 'schedule');
  const { data, error, reload } = useApi('/pt/options');
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader title="Personal Training" help={owner ? 'Sell packages, book sessions and track each trainer’s clients.' : 'Your schedule and your clients.'} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'schedule', label: 'Schedule' }, { key: 'clients', label: 'Clients' }, ...(owner ? [{ key: 'packages', label: 'Packages' }] : [])]} />
      {tab === 'schedule' && <Schedule options={data} reloadOptions={reload} />}
      {tab === 'clients' && <Clients options={data} reloadOptions={reload} owner={owner} />}
      {tab === 'packages' && owner && <Packages />}
    </>
  );
}

export default function PtPage() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
