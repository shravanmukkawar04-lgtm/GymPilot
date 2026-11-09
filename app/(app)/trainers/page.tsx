'use client';
import { useState } from 'react';
import { KeyRound, Pencil, Plus, UserCog, UserMinus } from 'lucide-react';
import { api, inr, toast, useApi } from '@/lib/client';
import { Avatar, Badge, Button, Card, Confirm, Empty, ErrorNote, Field, FormModal, Loading, PageHeader, Table, Tabs } from '@/components/ui';

const fields: Field[] = [
  { name: 'name', label: 'Full name', required: true },
  { name: 'phone', label: 'Phone number', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'role_title', label: 'Job title', required: true, placeholder: 'Trainer, Receptionist, Cleaner…' },
  { name: 'is_trainer', label: 'This person trains clients', type: 'checkbox', help: 'Turn on to assign personal training clients and earn commission.' },
  { name: 'specialization', label: 'Speciality', placeholder: 'Strength, yoga, weight loss…', show: (v) => v.is_trainer },
  { name: 'experience_years', label: 'Years of experience', type: 'number', min: 0, show: (v) => v.is_trainer },
  { name: 'certifications', label: 'Certifications', full: true, show: (v) => v.is_trainer },
  { name: 's', label: 'Pay and attendance', type: 'section' },
  { name: 'joined_on', label: 'Joining date', type: 'date' },
  { name: 'base_salary', label: 'Monthly salary (₹)', type: 'number', min: 0 },
  { name: 'pt_commission_pct', label: 'PT commission (%)', type: 'number', min: 0, help: 'Share of package price, earned per session done', show: (v) => v.is_trainer },
  { name: 'paid_leaves', label: 'Paid leaves per month', type: 'number', min: 0 },
  { name: 'biometric_id', label: 'Fingerprint number', help: 'The user number on your fingerprint machine' },
  { name: 'bank_details', label: 'Bank account or UPI for salary', full: true },
];

export default function TrainersPage() {
  const { data, error, reload } = useApi<any[]>('/staff');
  const [tab, setTab] = useState('trainers');
  const [edit, setEdit] = useState<any>(null);
  const [login, setLogin] = useState<any>(null);
  const [remove, setRemove] = useState<any>(null);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const trainers = data.filter((s) => s.is_trainer);
  const others = data.filter((s) => !s.is_trainer);
  const blank = { is_trainer: tab === 'trainers', role_title: tab === 'trainers' ? 'Trainer' : '', base_salary: 0, paid_leaves: 0, pt_commission_pct: 0 };

  return (
    <>
      <PageHeader title="Trainers & Staff" help="Your team, their clients, commission and app access.">
        <Button variant="primary" onClick={() => setEdit(blank)}><Plus /> {tab === 'trainers' ? 'Add trainer' : 'Add staff'}</Button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'trainers', label: 'Trainers', count: trainers.length }, { key: 'staff', label: 'Other staff', count: others.length }]} />

      {tab === 'trainers' && (trainers.length === 0
        ? <Card><Empty icon={UserCog} title="No trainers yet" text="Add a trainer to assign personal training clients." action={<Button variant="primary" onClick={() => setEdit(blank)}>Add trainer</Button>} /></Card>
        : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {trainers.map((t) => (
            <Card key={t.id}>
              <div className="flex items-center gap-3">
                <Avatar name={t.name} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink truncate">{t.name}</div>
                  <div className="text-muted text-[13px] truncate">{t.specialization || t.role_title}{t.experience_years ? ` · ${t.experience_years} yrs` : ''}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 py-3 border-y border-line text-center">
                <div><div className="font-semibold text-ink tabular-nums">{t.active_clients}</div><div className="text-muted text-xs">Clients</div></div>
                <div><div className="font-semibold text-ink tabular-nums">{t.sessions_month}</div><div className="text-muted text-xs">Sessions this month</div></div>
                <div><div className="font-semibold text-ink tabular-nums">{inr(t.commission_month)}</div><div className="text-muted text-xs">Commission</div></div>
              </div>
              <div className="flex items-center justify-between gap-2 mt-3">
                {t.login_active ? <Badge tone="green">Can log in</Badge> : <Badge>No login</Badge>}
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => setLogin(t)}><KeyRound /> Login</Button>
                  <Button size="sm" onClick={() => setEdit(t)}><Pencil /> Edit</Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${t.name}`} onClick={() => setRemove(t)}><UserMinus /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>)}

      {tab === 'staff' && (
        <Card pad={false}>
          <Table rows={others} onRow={setEdit} empty={<Empty icon={UserCog} title="No other staff yet" text="Add receptionists, cleaners and managers so you can run their salaries." action={<Button variant="primary" onClick={() => setEdit(blank)}>Add staff</Button>} />}
            cols={[
              { key: 'name', label: 'Name', render: (r) => <span className="flex items-center gap-2.5"><Avatar name={r.name} size={32} /><span className="font-medium text-ink">{r.name}</span></span> },
              { key: 'role_title', label: 'Job' },
              { key: 'phone', label: 'Phone' },
              { key: 'days_present_month', label: 'Days present', align: 'right' },
              { key: 'base_salary', label: 'Salary', align: 'right', render: (r) => inr(r.base_salary) },
            ]} />
        </Card>
      )}

      {edit && <FormModal wide title={edit.id ? `Edit ${edit.name}` : tab === 'trainers' ? 'Add trainer' : 'Add staff'} fields={fields} initial={edit} onClose={() => setEdit(null)}
        onSubmit={async (v) => { await api(edit.id ? `/staff/${edit.id}` : '/staff', { method: edit.id ? 'PUT' : 'POST', body: v }); toast('Saved'); reload(); }} />}
      {login && <FormModal title={`Login for ${login.name}`} subtitle="Trainers see only their own clients, schedule and commission."
        fields={[{ name: 'email', label: 'Login email', type: 'email', required: true, full: true }, { name: 'password', label: login.login_active ? 'New password' : 'Password', type: 'password', required: true, full: true, help: 'At least 8 characters. Share it with the trainer privately.' }]}
        initial={{ email: login.login_email ?? login.email ?? '' }} submitLabel="Save login" onClose={() => setLogin(null)}
        onSubmit={async (v) => { await api(`/staff/${login.id}/login`, { body: v }); toast('Login saved'); reload(); }} />}
      {remove && <Confirm danger title={`Remove ${remove.name}?`} text="They will leave your team list and lose app access. Past salaries and sessions stay on record." confirmLabel="Remove" onClose={() => setRemove(null)}
        onConfirm={async () => { await api(`/staff/${remove.id}/active`, { body: { active: false } }); toast('Removed'); reload(); }} />}
    </>
  );
}
