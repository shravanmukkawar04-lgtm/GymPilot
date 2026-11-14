'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Fingerprint, MessageCircle, PauseCircle, Pencil, RefreshCw, Repeat } from 'lucide-react';
import { api, daysFromToday, fmtDate, fmtTime, inr, photoUrl, todayIST, toast, useApi, waLink } from '@/lib/client';
import { Avatar, Badge, Button, Card, Confirm, Empty, ErrorNote, FormModal, Loading, StatusBadge, Table, Tabs } from '@/components/ui';
import { MembershipSale } from '@/components/sales';
import { memberFieldsShared } from '@/components/member-fields';

export default function MemberPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi(`/members/${id}`);
  const [tab, setTab] = useState('plans');
  const [modal, setModal] = useState<string | null>(null);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const m = data.member;
  const current = data.memberships.find((x: any) => x.id === m.membership_id);
  const left = daysFromToday(m.valid_until);

  const credit = (() => {
    if (!current || m.status !== 'active') return 0;
    const total = (Date.parse(current.end_date) - Date.parse(current.start_date)) / 86400000 + 1;
    const remaining = (daysFromToday(current.end_date) ?? 0) + 1;
    return Math.max(0, Math.round((current.price * remaining) / total));
  })();

  const checkIn = async () => {
    try {
      const r = await api('/attendance/manual', { body: { member_id: m.id } });
      toast(r.membershipOk ? (r.result === 'in' ? 'Checked in' : 'Checked out') : 'Recorded, but this membership is not valid today', r.membershipOk ? 'ok' : 'error');
      reload();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <>
      <Link href="/members" className="inline-flex items-center gap-1 text-muted hover:text-ink mb-3"><ArrowLeft className="size-4" /> All members</Link>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={m.name} size={64} src={photoUrl('member', m.id, m.photo_v)} />
          <div className="flex-1 min-w-48">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{m.name}</h1>
              <StatusBadge status={m.status} />
            </div>
            <p className="text-muted mt-0.5">{m.member_code} · {m.phone}{m.occupation ? ` · ${m.occupation}` : ''}{m.goal ? ` · Goal: ${m.goal}` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setModal('renew')}><RefreshCw /> Renew</Button>
            <Button onClick={checkIn}><Fingerprint /> Check in/out</Button>
            <Button onClick={async () => {
              try {
                const r = await api('/attendance/enroll', { body: { member_id: m.id } });
                toast(`Ask ${m.name} to place a finger on the machine. Number: ${r.pin}`);
                reload();
              } catch (e: any) { toast(e.message, 'error'); }
            }}>Register finger</Button>
            <Button href={waLink(m.phone)} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</Button>
            <Button onClick={() => setModal('edit')}><Pencil /> Edit</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-line">
          <div><div className="text-muted text-[13px]">Current plan</div><div className="font-medium text-ink mt-0.5">{m.plan_name ?? 'None'}{m.slot_name && <span className="block text-muted font-normal text-[13px]">{m.slot_name}</span>}</div></div>
          <div><div className="text-muted text-[13px]">Valid till</div><div className="font-medium text-ink mt-0.5">{fmtDate(m.valid_until)}{left !== null && left >= 0 && <span className="text-muted font-normal"> ({left} days left)</span>}</div></div>
          <div><div className="text-muted text-[13px]">Last visit</div><div className="font-medium text-ink mt-0.5">{fmtDate(m.last_visit)}</div></div>
          <div><div className="text-muted text-[13px]">Money due</div><div className={`font-medium mt-0.5 ${m.dues > 0 ? 'text-rose' : 'text-ink'}`}>{inr(m.dues)}</div></div>
        </div>
        {m.health_notes && <div className="mt-4 bg-amber-soft text-amber rounded-lg px-3 py-2"><b>Health note:</b> {m.health_notes}</div>}
      </Card>

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'plans', label: 'Memberships', count: data.memberships.length },
        { key: 'bills', label: 'Bills & payments', count: data.invoices.length },
        { key: 'visits', label: 'Visits', count: data.attendance.length },
        { key: 'pt', label: 'Personal training', count: data.pt.length },
        { key: 'info', label: 'Details' },
      ]} />

      {tab === 'plans' && (
        <Card pad={false}>
          <Table rows={data.memberships} empty={<Empty title="No membership yet" action={<Button variant="primary" onClick={() => setModal('renew')}>Add a membership</Button>} />}
            cols={[
              { key: 'plan_name', label: 'Plan', render: (r) => <span className="font-medium text-ink">{r.plan_name}</span> },
              { key: 'slot_name', label: 'Time slot' },
              { key: 'start_date', label: 'From', render: (r) => fmtDate(r.start_date) },
              { key: 'end_date', label: 'To', render: (r) => fmtDate(r.end_date) },
              { key: 'freeze', label: 'On hold', render: (r) => r.freeze_start ? `${fmtDate(r.freeze_start)} to ${fmtDate(r.freeze_end)}` : '—' },
              { key: 'status', label: 'Status', render: (r) => r.status === 'cancelled' ? <Badge>Cancelled</Badge> : r.end_date < todayIST() ? <Badge tone="red">Ended</Badge> : <Badge tone="green">Running</Badge> },
              { key: 'a', label: '', align: 'right', render: (r) => r.id === m.membership_id && r.status === 'active' && r.end_date >= todayIST() ? (
                <span className="inline-flex gap-1.5">
                  <Button size="sm" onClick={() => setModal('freeze')}><PauseCircle /> Hold</Button>
                  <Button size="sm" onClick={() => setModal('upgrade')}><Repeat /> Change plan</Button>
                </span>) : null },
            ]} />
        </Card>
      )}

      {tab === 'bills' && (
        <Card pad={false}>
          <Table rows={data.invoices} onRow={(r) => { window.location.href = `/billing/${r.id}`; }} empty={<Empty title="No bills yet" />}
            cols={[
              { key: 'invoice_no', label: 'Bill no.', render: (r) => <span className="font-medium text-ink">{r.invoice_no}</span> },
              { key: 'invoice_date', label: 'Date', render: (r) => fmtDate(r.invoice_date) },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'total', label: 'Amount', align: 'right', render: (r) => inr(r.total) },
              { key: 'balance', label: 'Balance', align: 'right', render: (r) => r.status === 'cancelled' ? '—' : inr(r.balance) },
            ]} />
        </Card>
      )}

      {tab === 'visits' && (
        <Card pad={false}>
          <Table rows={data.attendance} empty={<Empty icon={Fingerprint} title="No visits recorded yet" />}
            cols={[
              { key: 'day', label: 'Date', render: (r) => fmtDate(r.day) },
              { key: 'check_in', label: 'In', render: (r) => fmtTime(r.check_in) },
              { key: 'check_out', label: 'Out', render: (r) => fmtTime(r.check_out) },
              { key: 'source', label: 'How', render: (r) => r.source === 'manual' ? 'Front desk' : 'Fingerprint' },
              { key: 'ok', label: '', render: (r) => r.membership_ok ? null : <Badge tone="red">Membership not valid</Badge> },
            ]} />
        </Card>
      )}

      {tab === 'pt' && (
        <Card pad={false}>
          <Table rows={data.pt} empty={<Empty title="No personal training yet" action={<Button href="/pt?tab=clients" variant="primary">Go to Personal Training</Button>} />}
            cols={[
              { key: 'package_name', label: 'Package', render: (r) => <span className="font-medium text-ink">{r.package_name}</span> },
              { key: 'trainer_name', label: 'Trainer' },
              { key: 'u', label: 'Sessions used', render: (r) => `${r.used_sessions} of ${r.total_sessions}` },
              { key: 'end_date', label: 'Valid till', render: (r) => fmtDate(r.end_date) },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]} />
        </Card>
      )}

      {tab === 'info' && (
        <Card>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            {[['Branch', m.branch_name], ['Occupation', m.occupation], ['Email', m.email], ['Gender', m.gender], ['Date of birth', fmtDate(m.dob)], ['Joined on', fmtDate(m.joined_on)], ['Fingerprint number', m.biometric_id], ['Emergency contact', m.emergency_name ? `${m.emergency_name} ${m.emergency_phone ?? ''}` : null], ['Address', m.address]].map(([k, v]) => (
              <div key={k as string}><dt className="text-muted text-[13px]">{k}</dt><dd className="text-ink">{v ?? '—'}</dd></div>
            ))}
          </dl>
          <div className="mt-4 pt-4 border-t border-line"><Button variant="danger" onClick={() => setModal('archive')}>Remove member</Button></div>
        </Card>
      )}

      {modal === 'renew' && <MembershipSale member={m} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'upgrade' && <MembershipSale member={m} credit={credit} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'edit' && <FormModal wide title="Edit member" fields={memberFieldsShared} initial={{ ...m, photo: undefined }} onClose={() => setModal(null)}
        onSubmit={async (v) => { await api(`/members/${m.id}`, { method: 'PUT', body: v }); toast('Saved'); reload(); }} />}
      {modal === 'freeze' && <FormModal title="Put membership on hold" subtitle="The end date moves forward by the same number of days, so nothing is lost."
        fields={[{ name: 'start_date', label: 'Hold from', type: 'date', required: true }, { name: 'days', label: 'Number of days', type: 'number', min: 1, required: true }, { name: 'reason', label: 'Reason', full: true, placeholder: 'Travel, injury…' }]}
        initial={{ start_date: todayIST() }} submitLabel="Put on hold" onClose={() => setModal(null)}
        onSubmit={async (v) => { await api(`/memberships/${m.membership_id}/freeze`, { body: v }); toast('Membership put on hold'); reload(); }} />}
      {modal === 'archive' && <Confirm danger title={`Remove ${m.name}?`} text="They will disappear from your member list. Bills and history are kept for your records." confirmLabel="Remove member" onClose={() => setModal(null)}
        onConfirm={async () => { await api(`/members/${m.id}/archive`, { body: {} }); window.location.href = '/members'; }} />}
    </>
  );
}
