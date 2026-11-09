'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, toast, useApi } from '@/lib/client';
import { Button, Card, ErrorNote, Field, FormFields, FormModal, Loading, PageHeader } from '@/components/ui';

const GROUPS: { title: string; subtitle: string; fields: Field[] }[] = [
  { title: 'Gym details', subtitle: 'Shown on your bills and messages', fields: [
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
  ] },
];

export default function SettingsPage() {
  const { data, error, reload } = useApi('/settings');
  const [v, setV] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState(false);
  useEffect(() => { if (data) setV({ ...data, weekly_off: data.weekly_off ?? -1 }); }, [data]);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!v) return <Loading />;
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try { await api('/settings', { method: 'PUT', body: v }); toast('Settings saved'); reload(); } catch (x: any) { setErr(x.message); }
      setBusy(false);
    }}>
      <PageHeader title="Settings" help="Set these once and the rest of the app follows.">
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
      {pw && <FormModal title="Change my password" submitLabel="Change password" onClose={() => setPw(false)}
        fields={[{ name: 'current', label: 'Current password', type: 'password', required: true, full: true }, { name: 'next', label: 'New password', type: 'password', required: true, full: true, help: 'At least 8 characters' }]}
        onSubmit={async (x) => { await api('/auth/password', { body: x }); toast('Password changed'); }} />}
    </form>
  );
}
