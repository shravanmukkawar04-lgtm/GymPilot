'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Layers, Plus, Users } from 'lucide-react';
import { api, daysFromToday, fmtDate, inr, toast, useApi } from '@/lib/client';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Field, FormModal, Loading, PageHeader, StatusBadge, Table, Tabs } from '@/components/ui';
import { BillSummary, saleFields, syncPay, toSale } from '@/components/sales';
import { memberFieldsShared as memberFields } from '@/components/member-fields';

const FILTERS = [
  { key: '', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'expiring', label: 'Ending soon' },
  { key: 'expired', label: 'Expired' }, { key: 'frozen', label: 'On hold' }, { key: 'dues', label: 'Owes money' },
];

function PlansTab() {
  const { data, reload } = useApi<any[]>('/plans');
  const [edit, setEdit] = useState<any>(null);
  if (!data) return <Loading />;
  const fields: Field[] = [
    { name: 'name', label: 'Plan name', required: true, placeholder: 'Quarterly', full: true },
    { name: 'duration_months', label: 'Months', type: 'number', min: 0, required: true },
    { name: 'duration_days', label: 'Extra days', type: 'number', min: 0, help: 'For short passes, use 0 months and 7 days' },
    { name: 'price', label: 'Price (₹)', type: 'number', min: 0, required: true },
    { name: 'description', label: 'What is included', type: 'textarea' },
    { name: 'active', label: 'Available for sale', type: 'checkbox' },
  ];
  return (
    <Card title="Membership plans" subtitle="The packages you sell at the front desk" action={<Button variant="primary" onClick={() => setEdit({ active: true, duration_months: 1, duration_days: 0 })}><Plus /> Add plan</Button>} pad={false}>
      <Table rows={data} onRow={setEdit}
        empty={<Empty icon={Layers} title="No plans yet" text="Create a plan like Monthly or Yearly so you can start adding members." action={<Button variant="primary" onClick={() => setEdit({ active: true, duration_months: 1, duration_days: 0 })}>Create your first plan</Button>} />}
        cols={[
          { key: 'name', label: 'Plan', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
          { key: 'd', label: 'Duration', render: (r) => [r.duration_months && `${r.duration_months} month${r.duration_months > 1 ? 's' : ''}`, r.duration_days && `${r.duration_days} days`].filter(Boolean).join(' ') },
          { key: 'active_members', label: 'Members now', align: 'right' },
          { key: 'price', label: 'Price', align: 'right', render: (r) => inr(r.price) },
          { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'On sale' : 'Hidden'}</Badge> },
        ]} />
      {edit && <FormModal title={edit.id ? 'Edit plan' : 'Add plan'} fields={fields} initial={edit} onClose={() => setEdit(null)}
        onSubmit={async (v) => { await api(edit.id ? `/plans/${edit.id}` : '/plans', { method: edit.id ? 'PUT' : 'POST', body: v }); toast('Plan saved'); reload(); }} />}
    </Card>
  );
}

function AddMember({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const plans = useApi<any[]>('/plans');
  const settings = useApi('/settings');
  if (!plans.data || !settings.data) return null;
  const price = (v: any) => plans.data!.find((p) => String(p.id) === String(v.plan_id))?.price ?? 0;
  const sale = saleFields(plans.data).map((f) => (f.name === 'plan_id' ? { ...f, required: false } : { ...f, show: (v: any) => !!v.plan_id && (!f.show || f.show(v)) }));
  return (
    <FormModal wide title="Add a new member" subtitle="Only name and phone are required. Everything else can be added later." submitLabel="Add member"
      fields={[{ name: 's1', label: 'Member details', type: 'section' }, ...memberFields, { name: 's2', label: 'Membership', type: 'section' }, ...sale]}
      initial={{ pay_method: 'cash' }} onClose={onClose}
      onChangeValues={syncPay(settings.data, price)}
      summary={(v) => v.plan_id ? <BillSummary settings={settings.data} gross={price(v)} discount={Number(v.discount) || 0} pay={Number(v.pay_amount) || 0} /> : null}
      onSubmit={async (v) => {
        const { plan_id, start_date, discount, pay_amount, pay_method, pay_reference, ...member } = v;
        const r = await api('/members', { body: { ...member, sale: plan_id ? toSale(v) : undefined } });
        toast(`${member.name} added`);
        onDone(r.member.id);
      }} />
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') === 'plans' ? 'plans' : 'list');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(sp.get('new') === '1');
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (sp.get('new') === '1') setAdding(true); }, [sp]);
  const { data, error, reload } = useApi(`/members?status=${status}&q=${encodeURIComponent(term)}&page=${page}`);

  return (
    <>
      <PageHeader title="Members" help="Everyone who has joined your gym. Click a name to renew, collect payment or see their history.">
        <Button variant="primary" onClick={() => setAdding(true)}><Plus /> Add member</Button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'list', label: 'Members' }, { key: 'plans', label: 'Membership plans' }]} />
      {tab === 'plans' ? <PlansTab /> : (
        <Card pad={false}>
          <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
            <input className="input sm:max-w-xs" placeholder="Search name, phone or member ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" />
            <div className="flex gap-1 overflow-x-auto">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => { setStatus(f.key); setPage(1); }} className={`h-8 px-3 rounded-full whitespace-nowrap text-[13px] font-medium ${status === f.key ? 'bg-ink text-white' : 'bg-canvas text-muted hover:text-ink'}`}>
                  {f.label}{data?.counts && <span className="ml-1 opacity-70 tabular-nums">{data.counts[f.key || 'all']}</span>}
                </button>
              ))}
            </div>
          </div>
          {error ? <div className="p-4"><ErrorNote message={error} retry={reload} /></div> : !data ? <Loading /> : (
            <>
              <Table rows={data.rows} onRow={(r) => router.push(`/members/${r.id}`)}
                empty={<Empty icon={Users} title={term || status ? 'No members match this filter' : 'No members yet'} text={term || status ? 'Try another search or filter.' : 'Add your first member to get started.'} action={!term && !status ? <Button variant="primary" onClick={() => setAdding(true)}>Add member</Button> : undefined} />}
                cols={[
                  { key: 'name', label: 'Member', render: (r) => <span className="flex items-center gap-2.5"><Avatar name={r.name} /><span><span className="block font-medium text-ink">{r.name}</span><span className="text-muted text-[13px]">{r.member_code} · {r.phone}</span></span></span> },
                  { key: 'plan_name', label: 'Plan' },
                  { key: 'valid_until', label: 'Valid till', render: (r) => { const d = daysFromToday(r.valid_until); return r.valid_until ? <span>{fmtDate(r.valid_until)}{d !== null && d >= 0 && d <= 7 && <span className="block text-amber text-xs font-medium">{d === 0 ? 'Ends today' : `${d} day${d > 1 ? 's' : ''} left`}</span>}</span> : '—'; } },
                  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'last_visit', label: 'Last visit', render: (r) => fmtDate(r.last_visit) },
                  { key: 'dues', label: 'Owes', align: 'right', render: (r) => r.dues > 0 ? <span className="text-rose font-medium">{inr(r.dues)}</span> : '—' },
                ]} />
              {data.total > data.limit && (
                <div className="flex items-center justify-between p-3 border-t border-line">
                  <span className="text-muted">Page {data.page} of {Math.ceil(data.total / data.limit)}</span>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                    <Button size="sm" disabled={page >= Math.ceil(data.total / data.limit)} onClick={() => setPage(page + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}
      {adding && <AddMember onClose={() => setAdding(false)} onDone={(id) => router.push(`/members/${id}`)} />}
    </>
  );
}

export default function MembersPage() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
