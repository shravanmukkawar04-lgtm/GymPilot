'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/components/shell';
import { Building2, Loader2, Plus, UserPlus } from 'lucide-react';
import { api, photoUrl, toast, useApi } from '@/lib/client';
import { Badge, Button, Card, Empty, ErrorNote, Field, FormFields, FormModal, Loading, PageHeader } from '@/components/ui';

const GROUPS: { title: string; subtitle: string; fields: Field[] }[] = [
  { title: 'Gym details', subtitle: 'Shown on your bills and messages', fields: [
    { name: 'gym_photo', label: 'Gym photo or logo', type: 'photo', current: (v) => photoUrl('gym', v.gym_id, v.gym_photo_v) },
    { name: 'gym_name', label: 'Gym name', required: true, full: true },
    { name: 'address', label: 'Address', type: 'textarea' },
    { name: 'phone', label: 'Phone' },
    { name: 'email', label: 'Email', type: 'email' },
  ] },
  { title: 'GST and billing', subtitle: 'How your bills are calculated', fields: [
    { name: 'gst_enabled', label: 'My gym charges GST', type: 'checkbox' },
    { name: 'prices_include_gst', label: 'My prices already include GST', type: 'checkbox', help: 'If off, GST is added on top of your prices.', show: (v) => v.gst_enabled },
    { name: 'gstin', label: 'GSTIN', placeholder: '27ABCDE1234F1Z5', show: (v) => v.gst_enabled },
    { name: 'default_gst_rate', label: 'GST rate (%)', type: 'number', min: 0, required: true, show: (v) => v.gst_enabled },
    { name: 'sac_code', label: 'SAC code', required: true, help: 'Confirm this with your accountant', show: (v) => v.gst_enabled },
    { name: 'invoice_prefix', label: 'Bill number starts with', required: true },
    { name: 'upi_id', label: 'UPI ID', placeholder: 'yourgym@upi', help: 'Used for the QR code on unpaid bills', full: true },
    { name: 'invoice_terms', label: 'Terms printed on bills', type: 'textarea' },
  ] },
  { title: 'Attendance and salaries', subtitle: 'Used to work out pay and spot members who stop coming', fields: [
    { name: 'weekly_off', label: 'Weekly off day', type: 'select', required: true, options: [{ value: -1, label: 'No weekly off' }, ...['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => ({ value: i, label: d }))] },
    { name: 'inactive_days', label: 'Call a member inactive after (days)', type: 'number', min: 1, required: true },
  ] },
  { title: 'Automatic reminders', subtitle: 'Prepared every day in Messages', fields: [
    { name: 'auto_expiry', label: 'Membership ending', type: 'checkbox', help: '7, 3 and 1 days before, on the day, and the day after' },
    { name: 'auto_dues', label: 'Payment due', type: 'checkbox', help: 'Once a week while money is owed' },
    { name: 'auto_birthday', label: 'Birthday wishes', type: 'checkbox' },
    { name: 'auto_welcome', label: 'Welcome message for new members', type: 'checkbox', help: 'Sent on WhatsApp when a new member is added. You can untick it for one member while adding them.' },
  ] },
];

export default function SettingsPage() {
  const { data, error, reload } = useApi('/settings');
  const [v, setV] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState(false);
  const [photo, setPhoto] = useState(false);
  const me = useUser();
  useEffect(() => { if (data) setV({ ...data, gym_photo: undefined, weekly_off: data.weekly_off ?? -1 }); }, [data]);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!v) return <Loading />;
  return (
    <>
    <form onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try { await api('/settings', { method: 'PUT', body: v }); toast('Settings saved'); if (v.gym_photo !== undefined) window.location.reload(); else reload(); } catch (x: any) { setErr(x.message); }
      setBusy(false);
    }}>
      <PageHeader title="Settings" help="Set these once and the rest of the app follows.">
        <Button type="button" onClick={() => setPhoto(true)}>My photo</Button>
        <Button type="button" onClick={() => setPw(true)}>Change my password</Button>
        <Button variant="primary" type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Save changes</Button>
      </PageHeader>
      {err && <div className="mb-4"><ErrorNote message={err} /></div>}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {GROUPS.map((g) => (
          <Card key={g.title} title={g.title} subtitle={g.subtitle}>
            <FormFields fields={g.fields} values={v} set={(n, x) => setV({ ...v, [n]: x })} />
          </Card>
        ))}
      </div>
    </form>
      {/* Outside the settings form: these have forms of their own. */}
      <div className="mt-4"><Branches /></div>
      {photo && <FormModal title="My photo" subtitle="Shown next to your name in the menu." submitLabel="Save photo" onClose={() => setPhoto(false)}
        fields={[{ name: 'photo', label: 'Photo', type: 'photo', current: () => photoUrl('user', me.id, me.photo_v) }]} initial={{ name: me.name }}
        onSubmit={async (x) => { if (x.photo !== undefined) await api('/auth/photo', { body: { photo: x.photo } }); toast('Photo saved'); window.location.reload(); }} />}
      {pw && <FormModal title="Change my password" submitLabel="Change password" onClose={() => setPw(false)}
        fields={[{ name: 'current', label: 'Current password', type: 'password', required: true, full: true }, { name: 'next', label: 'New password', type: 'password', required: true, full: true, help: 'At least 8 characters' }]}
        onSubmit={async (x) => { await api('/auth/password', { body: x }); toast('Password changed'); }} />}
    </>
  );
}

/** Branches of this gym, and a manager login for each. Only the owner sees this page. */
function Branches() {
  const { data, error, reload } = useApi<any[]>('/branches');
  const [edit, setEdit] = useState<any>(null);
  const [manager, setManager] = useState<any>(null);
  const [reset, setReset] = useState<any>(null);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const done = () => { reload(); };
  return (
    <Card title="Branches" subtitle="Each branch keeps its own members, plans, staff, bills and attendance. Switch between them at the top of the screen." pad={false}
      action={<Button variant="primary" onClick={() => setEdit({ active: true })}><Plus /> Add branch</Button>}>
      {!data.length ? <Empty icon={Building2} title="No branches" /> : (
        <div className="divide-y divide-line">
          {data.map((b) => (
            <div key={b.id} className="px-4 py-3 flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-48">
                <div className="flex items-center gap-2"><span className="font-medium text-ink">{b.name}</span>{!b.active && <Badge>Closed</Badge>}</div>
                <div className="text-muted text-[13px]">{[b.address, b.phone].filter(Boolean).join(' · ') || 'No address yet'} · {b.active_members} active members · {b.staff} staff</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(b.managers ?? []).map((m: any) => (
                    <span key={m.id} className="inline-flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-1 text-[13px]">
                      <span className="text-ink font-medium">{m.name}</span><span className="text-muted">{m.email}</span>
                      {!m.active && <Badge>Off</Badge>}
                      <button type="button" className="text-brand-dark underline" onClick={() => setReset(m)}>Change</button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                {b.active && <Button size="sm" onClick={() => setManager(b)}><UserPlus /> Add manager login</Button>}
                <Button size="sm" onClick={() => setEdit(b)}>Edit</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <FormModal title={edit.id ? 'Edit branch' : 'Add branch'} onClose={() => setEdit(null)} initial={edit}
        subtitle={edit.id ? undefined : 'After adding it, choose it at the top of the screen to add its plans, staff and members.'}
        fields={[
          { name: 'name', label: 'Branch name', required: true, full: true, placeholder: 'Kothrud' },
          { name: 'phone', label: 'Phone' },
          { name: 'address', label: 'Address', type: 'textarea' },
          { name: 'active', label: 'Branch is open', type: 'checkbox', help: 'Closing a branch hides it and turns off its manager logins. Nothing is deleted.' },
        ]}
        onSubmit={async (v) => { await api(edit.id ? `/branches/${edit.id}` : '/branches', { method: edit.id ? 'PUT' : 'POST', body: v }); toast('Branch saved'); window.location.reload(); }} />}
      {manager && <FormModal title={`Manager login for ${manager.name}`} subtitle="A manager runs this branch only: members, bills, staff, attendance and messages. They cannot change gym settings or see salaries."
        submitLabel="Create login" onClose={() => setManager(null)}
        fields={[
          { name: 'name', label: 'Manager name', required: true, full: true },
          { name: 'email', label: 'Login email', type: 'email', required: true, full: true },
          { name: 'password', label: 'Password', type: 'password', required: true, full: true, help: 'At least 8 characters. Share it with the manager.' },
        ]}
        onSubmit={async (v) => { await api(`/branches/${manager.id}/managers`, { body: v }); toast('Manager login created'); done(); }} />}
      {reset && <FormModal title={`Change login for ${reset.name}`} submitLabel="Save" onClose={() => setReset(null)} initial={{ active: reset.active }}
        fields={[
          { name: 'password', label: 'New password', type: 'password', full: true, help: 'Leave blank to keep the current one.' },
          { name: 'active', label: 'Login is allowed', type: 'checkbox' },
        ]}
        onSubmit={async (v) => { await api(`/managers/${reset.id}`, { method: 'PUT', body: v }); toast('Saved'); done(); }} />}
    </Card>
  );
}
