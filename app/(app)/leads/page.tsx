'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Megaphone, MessageCircle, Pencil, Phone, Plus, UserPlus } from 'lucide-react';
import { api, billTotal, daysFromToday, fmtDate, fmtDateTime, toast, useApi, waLink } from '@/lib/client';
import { Badge, Button, Card, Empty, ErrorNote, Field, FormModal, Loading, Modal, PageHeader, paymentFields, Stat, toPayment } from '@/components/ui';
import { BillSummary, planLabel, slotField, syncPay } from '@/components/sales';

const STAGES = [
  { key: 'new', label: 'New' }, { key: 'contacted', label: 'Contacted' }, { key: 'trial', label: 'On trial' }, { key: 'follow_up', label: 'Thinking it over' },
];
const ALL = [...STAGES, { key: 'won', label: 'Joined' }, { key: 'lost', label: 'Not interested' }];
const SOURCES = ['Walk-in', 'Friend or member', 'Instagram', 'Facebook', 'Google', 'JustDial', 'Flyer', 'Other'].map((x) => ({ value: x, label: x }));
const LOST = ['Too expensive', 'Too far', 'Joined another gym', 'Not interested now', 'Could not reach'].map((x) => ({ value: x, label: x }));

function followLabel(d?: string | null) {
  const n = daysFromToday(d);
  if (n === null) return null;
  if (n < 0) return <Badge tone="red">Follow-up overdue</Badge>;
  if (n === 0) return <Badge tone="amber">Follow up today</Badge>;
  return <span className="text-muted text-xs">Follow up {fmtDate(d)}</span>;
}

function Convert({ lead, onClose, onDone }: { lead: any; onClose: () => void; onDone: (id: number) => void }) {
  const plans = useApi<any[]>('/plans');
  const slots = useApi<any[]>('/slots');
  const settings = useApi('/settings');
  if (!plans.data || !slots.data || !settings.data) return null;
  const price = (v: any) => plans.data!.find((p) => String(p.id) === String(v.plan_id))?.price ?? 0;
  const fields: Field[] = [
    { name: 'plan_id', label: 'Membership plan', type: 'select', full: true, options: plans.data.filter((p) => p.active).map((p) => ({ value: p.id, label: planLabel(p) })), help: 'Leave blank to add them as a member without a plan.' },
    slotField(plans.data, slots.data),
    { name: 'discount', label: 'Discount (₹)', type: 'number', min: 0, show: (v) => !!v.plan_id },
    { name: 'start_date', label: 'Start date', type: 'date', show: (v) => !!v.plan_id },
    ...paymentFields.map((f) => ({ ...f, show: (v: any) => !!v.plan_id && (!f.show || f.show(v)) })),
  ];
  return <FormModal title={`${lead.name} is joining`} subtitle="Creates their member profile and bill." fields={fields} initial={{ pay_method: 'cash' }} submitLabel="Make member" onClose={onClose}
    onChangeValues={syncPay(settings.data, price)}
    summary={(v) => v.plan_id ? <BillSummary settings={settings.data} gross={price(v)} discount={Number(v.discount) || 0} pay={Number(v.pay_amount) || 0} /> : null}
    onSubmit={async (v) => { const r = await api(`/leads/${lead.id}/convert`, { body: { plan_id: v.plan_id, slot_id: v.slot_id || null, start_date: v.start_date, discount: Number(v.discount) || 0, payment: toPayment(v) } }); toast(`${lead.name} is now a member`); onDone(r.member.id); }} />;
}

function Detail({ id, staff, fields, onClose, onChange }: { id: number; staff: any[]; fields: Field[]; onClose: () => void; onChange: () => void }) {
  const router = useRouter();
  const { data, reload } = useApi(`/leads/${id}`);
  const [form, setForm] = useState<string | null>(null);
  const [note, setNote] = useState<any>({ type: 'call', note: '', next_followup: '' });
  if (!data) return null;
  const l = data.lead;
  const refresh = () => { reload(); onChange(); };
  const move = async (status: string) => {
    if (status === 'lost') return setForm('lost');
    try { await api(`/leads/${id}/move`, { body: { status } }); refresh(); } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={l.name} subtitle={[l.phone, l.source, l.interest].filter(Boolean).join(' · ')} onClose={onClose} wide>
      <div className="flex flex-wrap gap-2 mb-4">
        <Button href={`tel:${l.phone}`}><Phone /> Call</Button>
        <Button href={waLink(l.phone)} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</Button>
        <Button onClick={() => setForm('edit')}><Pencil /> Edit</Button>
        {!l.converted_member_id && <Button variant="primary" onClick={() => setForm('convert')}><UserPlus /> They joined</Button>}
      </div>
      {!l.converted_member_id && (
        <div className="mb-4">
          <div className="text-[13px] font-medium text-ink mb-1.5">Stage</div>
          <div className="flex flex-wrap gap-1.5">
            {ALL.filter((s) => s.key !== 'won').map((s) => (
              <button key={s.key} onClick={() => move(s.key)} className={`h-8 px-3 rounded-full text-[13px] font-medium ${l.status === s.key ? 'bg-ink text-white' : 'bg-canvas text-muted hover:text-ink'}`}>{s.label}</button>
            ))}
          </div>
        </div>
      )}
      <form className="bg-canvas rounded-lg p-3 mb-4" onSubmit={async (e) => {
        e.preventDefault();
        try { await api(`/leads/${id}/activities`, { body: note }); setNote({ type: 'call', note: '', next_followup: '' }); toast('Saved'); refresh(); } catch (x: any) { toast(x.message, 'error'); }
      }}>
        <div className="text-[13px] font-medium text-ink mb-1.5">What happened?</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select className="input sm:!w-32" aria-label="Type" value={note.type} onChange={(e) => setNote({ ...note, type: e.target.value })}><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="visit">Visit</option><option value="note">Note</option></select>
          <input className="input flex-1" required placeholder="Said they will come on Monday…" aria-label="Note" value={note.note} onChange={(e) => setNote({ ...note, note: e.target.value })} />
        </div>
        <div className="flex items-center justify-between gap-2 mt-2">
          <label className="flex items-center gap-2 text-muted text-[13px]">Next follow-up <input className="input !w-auto" type="date" value={note.next_followup} onChange={(e) => setNote({ ...note, next_followup: e.target.value })} /></label>
          <Button type="submit" variant="primary">Save</Button>
        </div>
      </form>
      <ul className="space-y-2.5">
        {data.activities.map((a: any) => (
          <li key={a.id} className="flex gap-3">
            <span className="text-muted text-xs w-28 shrink-0 pt-0.5">{fmtDateTime(a.created_at)}</span>
            <span><span className="capitalize font-medium text-ink">{a.type === 'status' ? '' : `${a.type}: `}</span>{a.note}{a.by_name && <span className="text-faint"> · {a.by_name}</span>}</span>
          </li>
        ))}
      </ul>
      {form === 'edit' && <FormModal wide title="Edit enquiry" fields={fields} initial={l} onClose={() => setForm(null)} onSubmit={async (v) => { await api(`/leads/${id}`, { method: 'PUT', body: v }); toast('Saved'); refresh(); }} />}
      {form === 'lost' && <FormModal title="Why not interested?" fields={[{ name: 'lost_reason', label: 'Reason', type: 'select', required: true, options: LOST, full: true }]} submitLabel="Save" onClose={() => setForm(null)}
        onSubmit={async (v) => { await api(`/leads/${id}/move`, { body: { status: 'lost', lost_reason: v.lost_reason } }); refresh(); }} />}
      {form === 'convert' && <Convert lead={l} onClose={() => setForm(null)} onDone={(mid) => { onChange(); router.push(`/members/${mid}`); }} />}
    </Modal>
  );
}

function Inner() {
  const sp = useSearchParams();
  const { data, error, reload } = useApi('/leads');
  const [adding, setAdding] = useState(sp.get('new') === '1');
  const [open, setOpen] = useState<number | null>(sp.get('open') ? Number(sp.get('open')) : null);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => { if (sp.get('new') === '1') setAdding(true); if (sp.get('open')) setOpen(Number(sp.get('open'))); }, [sp]);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const { rows, staff, stats } = data;
  const fields: Field[] = [
    { name: 'name', label: 'Name', required: true },
    { name: 'phone', label: 'Phone number', type: 'tel', required: true },
    { name: 'source', label: 'How did they hear about us?', type: 'select', options: SOURCES },
    { name: 'interest', label: 'Interested in', placeholder: 'Weight loss, PT, yearly plan…' },
    { name: 'assigned_to', label: 'Who will follow up?', type: 'select', options: staff.map((s: any) => ({ value: s.id, label: s.name })) },
    { name: 'next_followup', label: 'Next follow-up date', type: 'date' },
    { name: 'trial_start', label: 'Trial from', type: 'date' },
    { name: 'trial_end', label: 'Trial to', type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  const drop = async (status: string) => {
    if (drag === null) return;
    const id = drag; setDrag(null);
    try { await api(`/leads/${id}/move`, { body: { status } }); reload(); } catch (e: any) { toast(e.message, 'error'); }
  };
  const rate = stats.total ? Math.round((stats.won_total / stats.total) * 100) : 0;

  return (
    <>
      <PageHeader title="Enquiries" help="Everyone who asked about joining. Drag a card to the next stage, or click it to log a call.">
        <Button variant="primary" onClick={() => setAdding(true)}><Plus /> Add enquiry</Button>
      </PageHeader>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Open enquiries" value={stats.open} />
        <Stat label="Follow up today" value={stats.due_today} tone={stats.due_today > 0 ? 'amber' : undefined} />
        <Stat label="Joined this month" value={stats.won_month} hint={`from ${stats.new_month} new enquiries`} />
        <Stat label="Join rate" value={`${rate}%`} hint="Of all enquiries" />
      </div>
      {stats.total === 0 ? (
        <Card><Empty icon={Megaphone} title="No enquiries yet" text="When someone calls or walks in, add them here so no one is forgotten." action={<Button variant="primary" onClick={() => setAdding(true)}>Add enquiry</Button>} /></Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((st) => {
            const cards = rows.filter((r: any) => r.status === st.key);
            return (
              <div key={st.key} className="flex-1 min-w-60 bg-slate-soft/70 rounded-xl p-2" onDragOver={(e) => e.preventDefault()} onDrop={() => drop(st.key)}>
                <div className="flex justify-between px-1.5 py-1 mb-1"><span className="font-semibold text-ink">{st.label}</span><span className="text-muted tabular-nums">{cards.length}</span></div>
                <div className="space-y-2 min-h-20">
                  {cards.map((l: any) => (
                    <button key={l.id} draggable onDragStart={() => setDrag(l.id)} onClick={() => setOpen(l.id)} className="block w-full text-left bg-surface rounded-lg border border-line p-3 hover:border-brand">
                      <div className="font-medium text-ink">{l.name}</div>
                      <div className="text-muted text-[13px]">{l.phone}{l.source ? ` · ${l.source}` : ''}</div>
                      {l.interest && <div className="text-[13px] mt-1">{l.interest}</div>}
                      <div className="mt-2 flex items-center justify-between gap-2">{followLabel(l.next_followup)}{l.assigned_name && <span className="text-faint text-xs truncate">{l.assigned_name}</span>}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {adding && <FormModal wide title="Add an enquiry" subtitle="Only name and phone are needed." fields={fields} submitLabel="Add enquiry" onClose={() => setAdding(false)} onSubmit={async (v) => { await api('/leads', { body: v }); toast('Enquiry added'); reload(); }} />}
      {open !== null && <Detail id={open} staff={staff} fields={fields} onClose={() => setOpen(null)} onChange={reload} />}
    </>
  );
}

export default function LeadsPage() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
