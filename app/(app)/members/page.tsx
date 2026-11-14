'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Clock, Download, FileUp, Layers, Loader2, Plus, Users } from 'lucide-react';
import { api, daysFromToday, downloadCsv, fmtDate, inr, parseCsv, photoUrl, toast, useApi } from '@/lib/client';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Field, FormModal, Loading, Modal, PageHeader, StatusBadge, Table, Tabs } from '@/components/ui';
import { BillSummary, saleFields, slotField, slotLabel, syncPay, toSale } from '@/components/sales';
import { memberFieldsShared as memberFields } from '@/components/member-fields';
import { useShell } from '@/components/shell';

const FILTERS = [
  { key: '', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'expiring', label: 'Ending soon' },
  { key: 'expired', label: 'Expired' }, { key: 'frozen', label: 'On hold' }, { key: 'dues', label: 'Owes money' },
];

const duration = (r: any) => [r.duration_months && `${r.duration_months} month${r.duration_months > 1 ? 's' : ''}`, r.duration_days && `${r.duration_days} days`].filter(Boolean).join(' ');

function SlotsCard({ slots, reload }: { slots: any[]; reload: () => void }) {
  const [edit, setEdit] = useState<any>(null);
  const fields: Field[] = [
    { name: 'name', label: 'Slot name', required: true, placeholder: 'Morning', full: true },
    { name: 'start_time', label: 'From', type: 'time', required: true },
    { name: 'end_time', label: 'To', type: 'time', required: true },
    { name: 'active', label: 'In use', type: 'checkbox' },
  ];
  const fresh = { active: true, start_time: '05:00', end_time: '07:00' };
  return (
    <Card title="Time slots" subtitle="Batches such as Morning 5–7 or Evening 6–8. Pick them when you set up a plan." pad={false}
      action={<Button onClick={() => setEdit(fresh)}><Plus /> Add slot</Button>}>
      <Table rows={slots} onRow={(r) => setEdit({ ...r, start_time: r.start_time.slice(0, 5), end_time: r.end_time.slice(0, 5) })}
        empty={<Empty icon={Clock} title="No time slots yet" text="Add slots if members choose a fixed batch time. Plans work without them too." action={<Button onClick={() => setEdit(fresh)}>Add a slot</Button>} />}
        cols={[
          { key: 'name', label: 'Slot', render: (r) => <span className="font-medium text-ink">{slotLabel(r)}</span> },
          { key: 'active_members', label: 'Members now', align: 'right' },
          { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'In use' : 'Hidden'}</Badge> },
        ]} />
      {edit && <FormModal title={edit.id ? 'Edit slot' : 'Add slot'} fields={fields} initial={edit} onClose={() => setEdit(null)}
        onSubmit={async (v) => { await api(edit.id ? `/slots/${edit.id}` : '/slots', { method: edit.id ? 'PUT' : 'POST', body: v }); toast('Slot saved'); reload(); }} />}
    </Card>
  );
}

function PlansTab() {
  const { data, reload } = useApi<any[]>('/plans');
  const slots = useApi<any[]>('/slots');
  const [edit, setEdit] = useState<any>(null);
  if (!data || !slots.data) return <Loading />;
  const slotOpts = slots.data.filter((s) => s.active).map((s) => ({ value: s.id, label: slotLabel(s) }));
  const fields: Field[] = [
    { name: 'name', label: 'Plan name', required: true, placeholder: 'Quarterly', full: true },
    { name: 'duration_months', label: 'Months', type: 'number', min: 0, required: true },
    { name: 'duration_days', label: 'Extra days', type: 'number', min: 0, help: 'For short passes, use 0 months and 7 days' },
    { name: 'price', label: 'Price (₹)', type: 'number', min: 0, required: true },
    { name: 'slot_ids', label: 'Time slots for this plan', type: 'checks', options: slotOpts, placeholder: 'Add time slots below to offer this plan at fixed timings.',
      help: 'Leave all unticked if members can come at any time.' },
    { name: 'description', label: 'What is included', type: 'textarea' },
    { name: 'active', label: 'Available for sale', type: 'checkbox' },
  ];
  const fresh = { active: true, duration_months: 1, duration_days: 0, slot_ids: [] };
  const names = (ids: number[]) => ids.map((id) => slots.data!.find((s) => s.id === id)?.name).filter(Boolean).join(', ');
  return (
    <div className="space-y-4">
      <Card title="Membership plans" subtitle="The packages you sell at the front desk" action={<Button variant="primary" onClick={() => setEdit(fresh)}><Plus /> Add plan</Button>} pad={false}>
        <Table rows={data} onRow={(r) => setEdit({ ...r, slot_ids: (r.slot_ids ?? []).map(String) })}
          empty={<Empty icon={Layers} title="No plans yet" text="Create a plan like Monthly or Yearly so you can start adding members." action={<Button variant="primary" onClick={() => setEdit(fresh)}>Create your first plan</Button>} />}
          cols={[
            { key: 'name', label: 'Plan', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
            { key: 'd', label: 'Duration', render: duration },
            { key: 'slots', label: 'Timings', render: (r) => (r.slot_ids?.length ? names(r.slot_ids) : <span className="text-muted">Any time</span>) },
            { key: 'active_members', label: 'Members now', align: 'right' },
            { key: 'price', label: 'Price', align: 'right', render: (r) => inr(r.price) },
            { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'On sale' : 'Hidden'}</Badge> },
          ]} />
        {edit && <FormModal title={edit.id ? 'Edit plan' : 'Add plan'} fields={fields} initial={edit} onClose={() => setEdit(null)}
          onSubmit={async (v) => {
            await api(edit.id ? `/plans/${edit.id}` : '/plans', { method: edit.id ? 'PUT' : 'POST', body: { ...v, slot_ids: (v.slot_ids ?? []).map(Number) } });
            toast('Plan saved'); reload();
          }} />}
      </Card>
      <SlotsCard slots={slots.data} reload={() => { slots.reload(); reload(); }} />
    </div>
  );
}

function welcomeToast(name: string, w: any) {
  toast(`${name} added`);
  if (!w) return;
  if (w.status === 'sent') toast('Welcome message sent on WhatsApp');
  else if (w.status === 'queued') toast('Welcome message is ready to send in Messages');
  else if (w.status === 'failed') toast(`Welcome message could not be sent: ${w.error ?? 'unknown error'}`, 'error');
}

function AddMember({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const plans = useApi<any[]>('/plans');
  const slots = useApi<any[]>('/slots');
  const settings = useApi('/settings');
  if (!plans.data || !slots.data || !settings.data) return null;
  const price = (v: any) => plans.data!.find((p) => String(p.id) === String(v.plan_id))?.price ?? 0;
  const isNew = (v: any) => v.kind !== 'existing';
  const isOld = (v: any) => v.kind === 'existing';

  const sale = saleFields(plans.data, slots.data).map((f) => ({
    ...f, required: f.name === 'plan_id' ? false : f.required,
    show: (v: any) => isNew(v) && (f.name === 'plan_id' || !!v.plan_id) && (!f.show || f.show(v)),
  }));
  const planOpts = plans.data.map((p) => ({ value: p.id, label: `${p.name}${p.active ? '' : ' (hidden)'}` }));
  const oldSlot = slotField(plans.data, slots.data);
  const existing: Field[] = [
    { name: 'member_code', label: 'Member ID in your old system', placeholder: 'Leave blank to get a new one', show: isOld },
    { name: 'joined_on', label: 'Joined on', type: 'date', required: true, show: isOld, help: 'The date they first joined your gym' },
    { name: 's3', label: 'Current membership', type: 'section', show: isOld },
    { name: 'plan_id', label: 'Plan they are on', type: 'select', options: planOpts, full: true, show: isOld, help: 'Leave blank if they have no running plan.' },
    { ...oldSlot, show: (v) => isOld(v) && !!oldSlot.show?.(v) },
    { name: 'start_date', label: 'Plan started on', type: 'date', required: (v) => !!v.plan_id, show: (v) => isOld(v) && !!v.plan_id },
    { name: 'end_date', label: 'Plan ends on', type: 'date', required: (v) => !!v.plan_id, show: (v) => isOld(v) && !!v.plan_id },
    { name: 'balance_due', label: 'Amount they still owe (₹)', type: 'number', min: 0, show: isOld, help: 'Only what is unpaid. Money already paid in the old system is not added to your income again.' },
  ];
  const fields: Field[] = [
    { name: 'kind', label: 'Who are you adding?', type: 'choice', options: [{ value: 'new', label: 'New member' }, { value: 'existing', label: 'Existing member (moving from old system)' }] },
    { name: 's1', label: 'Member details', type: 'section' }, ...memberFields.filter((f) => f.name !== 'whatsapp_opt_out'),
    { name: 's2', label: 'Membership', type: 'section', show: isNew }, ...sale,
    ...existing,
    { name: 'send_welcome', label: 'Send a welcome message on WhatsApp', type: 'checkbox', help: 'Uses your Welcome template in Messages.' },
  ];
  return (
    <FormModal wide title="Add a member" subtitle="Only name and phone are required. Everything else can be added later." submitLabel="Add member"
      fields={fields} initial={{ kind: 'new', pay_method: 'cash', send_welcome: !!settings.data.auto_welcome }} onClose={onClose}
      onChangeValues={(name, v) => ({
        ...syncPay(settings.data, price)(name, v),
        // Migrated members usually should not get a welcome message.
        ...(name === 'kind' ? { send_welcome: v.kind === 'new' && !!settings.data.auto_welcome } : {}),
      })}
      summary={(v) => (isNew(v) && v.plan_id ? <BillSummary settings={settings.data} gross={price(v)} discount={Number(v.discount) || 0} pay={Number(v.pay_amount) || 0} /> : null)}
      onSubmit={async (v) => {
        const { kind, plan_id, slot_id, start_date, end_date, discount, pay_amount, pay_method, pay_cash, pay_online_method, pay_reference,
          member_code, joined_on, balance_due, send_welcome, ...member } = v;
        const body = kind === 'existing'
          ? { ...member, kind, send_welcome, existing: { member_code, joined_on, plan_id, slot_id, start_date, end_date, balance_due: Number(balance_due) || 0 } }
          : { ...member, kind, send_welcome, sale: plan_id ? toSale(v) : undefined };
        const r = await api('/members', { body });
        welcomeToast(member.name, r.welcome);
        onDone(r.member.id);
      }} />
  );
}

/* ---------- Import from Excel / CSV ---------- */

const COLUMNS: { key: string; label: string; aliases: string[] }[] = [
  { key: 'name', label: 'Name', aliases: ['name', 'full name', 'member name', 'member'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'mobile number', 'phone number', 'contact', 'whatsapp'] },
  { key: 'member_code', label: 'Member ID', aliases: ['member id', 'member code', 'id', 'code', 'membership no', 'reg no'] },
  { key: 'email', label: 'Email', aliases: ['email', 'email id', 'e-mail'] },
  { key: 'gender', label: 'Gender', aliases: ['gender', 'sex'] },
  { key: 'dob', label: 'Date of birth', aliases: ['dob', 'date of birth', 'birth date', 'birthday'] },
  { key: 'occupation', label: 'Occupation', aliases: ['occupation', 'profession', 'job'] },
  { key: 'address', label: 'Address', aliases: ['address'] },
  { key: 'joined_on', label: 'Joined on', aliases: ['joined on', 'joining date', 'join date', 'date of joining', 'doj', 'admission date'] },
  { key: 'plan', label: 'Plan', aliases: ['plan', 'plan name', 'package', 'membership'] },
  { key: 'slot', label: 'Slot', aliases: ['slot', 'batch', 'timing', 'time slot'] },
  { key: 'start_date', label: 'Plan start', aliases: ['plan start', 'start date', 'start', 'from'] },
  { key: 'end_date', label: 'Plan end', aliases: ['plan end', 'end date', 'expiry', 'expiry date', 'valid till', 'valid until', 'to'] },
  { key: 'balance_due', label: 'Balance due', aliases: ['balance due', 'balance', 'due', 'dues', 'pending', 'pending amount'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'remarks', 'comment'] },
];

function ImportMembers({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; added: number; skipped: number; errors: any[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const read = async (file?: File) => {
    if (!file) return;
    setErr(null); setRows(null); setProgress(null);
    if (!/\.csv$/i.test(file.name)) return setErr('Please choose a .csv file. In Excel: File → Save As → CSV (Comma delimited).');
    const table = parseCsv(await file.text());
    if (table.length < 2) return setErr('This file has no member rows under the headings.');
    const heads = table[0].map((h) => h.trim().toLowerCase().replace(/[_*]+/g, ' ').replace(/\s+/g, ' '));
    const map = heads.map((h) => COLUMNS.find((c) => c.aliases.includes(h))?.key ?? null);
    if (!map.includes('name') || !map.includes('phone')) return setErr('The first row must have headings, including Name and Phone. Download the template to see the layout.');
    setUnknown(table[0].filter((_, i) => !map[i] && table[0][i].trim()));
    setRows(table.slice(1).map((r, i) => Object.fromEntries([['__row', i + 2], ...map.map((k, j) => [k, r[j]?.trim() ?? '']).filter(([k]) => k)])));
  };

  const run = async () => {
    if (!rows) return;
    setBusy(true); setErr(null);
    const total = { done: 0, added: 0, skipped: 0, errors: [] as any[] };
    try {
      for (let i = 0; i < rows.length; i += 100) {
        const r = await api('/members/import', { body: { rows: rows.slice(i, i + 100) } });
        total.done = Math.min(rows.length, i + 100); total.added += r.added; total.skipped += r.skipped; total.errors.push(...r.errors);
        setProgress({ ...total });
      }
      toast(`${total.added} members imported`);
      onDone();
    } catch (e: any) { setErr(`${e.message} Rows already imported are kept; you can run the same file again and they will be skipped.`); }
    setBusy(false);
  };

  return (
    <Modal wide title="Import members from Excel" subtitle="Move everyone from your old software at once. They are added to the branch selected at the top." onClose={onClose}>
      <ol className="list-decimal pl-5 space-y-1 mb-4 text-body">
        <li>Download the template, or use your own sheet with headings in the first row.</li>
        <li>In Excel or Google Sheets, save it as <b>CSV</b>.</li>
        <li>Choose the file below, check the preview, then import.</li>
      </ol>
      <div className="flex flex-wrap gap-2 mb-4">
        <Button onClick={() => downloadCsv('gympilot-members-template', [{
          Name: 'Rohan Sharma', Phone: '9876543210', 'Member ID': 'OLD-101', Email: '', Gender: 'Male', 'Date of birth': '15-08-1995', Occupation: 'Engineer',
          Address: '', 'Joined on': '01-02-2025', Plan: 'Quarterly', Slot: 'Morning', 'Plan start': '01-10-2026', 'Plan end': '31-12-2026', 'Balance due': '500', Notes: '',
        }])}><Download /> Download template</Button>
        <label className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg font-medium bg-brand text-white hover:bg-brand-dark cursor-pointer">
          <FileUp className="size-4" /> Choose CSV file
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      <p className="text-muted text-[13px] mb-4">
        Dates can be 25-03-2026, 25/03/2026 or 2026-03-25. Plan and slot names should match the ones set up in GymPilot;
        if a plan is not found, the member still gets their plan dates. Members whose phone number is already in this branch are skipped.
      </p>
      {err && <div className="mb-3"><ErrorNote message={err} /></div>}
      {rows && (
        <>
          <div className="bg-canvas rounded-lg p-3 mb-3"><b className="text-ink">{rows.length}</b> members found.
            {unknown.length > 0 && <span className="text-muted"> Not used: {unknown.join(', ')}.</span>}
          </div>
          <div className="border border-line rounded-lg overflow-hidden mb-3">
            <Table rows={rows.slice(0, 5).map((r) => ({ ...r, id: r.__row }))} cols={[
              { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'plan', label: 'Plan' },
              { key: 'end_date', label: 'Plan end' }, { key: 'balance_due', label: 'Due', align: 'right' },
            ]} />
          </div>
        </>
      )}
      {progress && (
        <div className="mb-3 space-y-2">
          <div className="h-2 rounded-full bg-canvas overflow-hidden"><div className="h-full bg-brand" style={{ width: `${(progress.done / (rows?.length || 1)) * 100}%` }} /></div>
          <p><b className="text-ink">{progress.added}</b> added · {progress.skipped} already here · <span className={progress.errors.length ? 'text-rose' : ''}>{progress.errors.length} with problems</span></p>
          {progress.errors.length > 0 && (
            <div className="max-h-40 overflow-y-auto bg-rose-soft text-rose rounded-lg p-3 text-[13px]">
              {progress.errors.map((e) => <div key={e.row}>Row {e.row}: {e.message}</div>)}
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{progress && !busy ? 'Close' : 'Cancel'}</Button>
        <Button variant="primary" disabled={!rows || busy || !!progress} onClick={run}>{busy && <Loader2 className="animate-spin" />}Import {rows ? rows.length : ''} members</Button>
      </div>
    </Modal>
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const shell = useShell();
  const [tab, setTab] = useState(sp.get('tab') === 'plans' ? 'plans' : 'list');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [slot, setSlot] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(sp.get('new') === '1');
  const [importing, setImporting] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (sp.get('new') === '1') setAdding(true); }, [sp]);
  const { data, error, reload } = useApi(`/members?status=${status}&slot_id=${slot}&q=${encodeURIComponent(term)}&page=${page}`);
  const slots = useApi<any[]>('/slots');
  const allBranches = shell?.branch_id === null;
  const needBranch = () => toast('Choose a branch at the top first. New members are added to one branch.', 'error');

  return (
    <>
      <PageHeader title="Members" help="Everyone who has joined your gym. Click a name to renew, collect payment or see their history.">
        <Button onClick={() => (allBranches ? needBranch() : setImporting(true))}><FileUp /> Import from Excel</Button>
        <Button variant="primary" onClick={() => (allBranches ? needBranch() : setAdding(true))}><Plus /> Add member</Button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'list', label: 'Members' }, { key: 'plans', label: 'Plans & time slots' }]} />
      {tab === 'plans' ? <PlansTab /> : (
        <Card pad={false}>
          <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
            <input className="input sm:max-w-xs" placeholder="Search name, phone or member ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" />
            {!!slots.data?.length && (
              <select className="input sm:!w-48" aria-label="Time slot" value={slot} onChange={(e) => { setSlot(e.target.value); setPage(1); }}>
                <option value="">All time slots</option>
                {slots.data.map((s) => <option key={s.id} value={s.id}>{slotLabel(s)}</option>)}
              </select>
            )}
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
                empty={<Empty icon={Users} title={term || status || slot ? 'No members match this filter' : 'No members yet'} text={term || status || slot ? 'Try another search or filter.' : 'Add your first member, or import everyone from your old software.'} action={!term && !status && !slot && !allBranches ? <Button variant="primary" onClick={() => setAdding(true)}>Add member</Button> : undefined} />}
                cols={[
                  { key: 'name', label: 'Member', render: (r) => <span className="flex items-center gap-2.5"><Avatar name={r.name} src={photoUrl('member', r.id, r.photo_v)} /><span><span className="block font-medium text-ink">{r.name}</span><span className="text-muted text-[13px]">{r.member_code} · {r.phone}</span></span></span> },
                  ...(allBranches ? [{ key: 'branch_name', label: 'Branch' }] : []),
                  { key: 'plan_name', label: 'Plan', render: (r) => r.plan_name ? <span>{r.plan_name}{r.slot_name && <span className="block text-muted text-[13px]">{r.slot_name}</span>}</span> : '—' },
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
      {adding && !allBranches && <AddMember onClose={() => setAdding(false)} onDone={(id) => router.push(`/members/${id}`)} />}
      {importing && <ImportMembers onClose={() => { setImporting(false); reload(); }} onDone={reload} />}
    </>
  );
}

export default function MembersPage() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
