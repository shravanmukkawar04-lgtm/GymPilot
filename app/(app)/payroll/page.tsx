'use client';
import { useState } from 'react';
import { AlertTriangle, Calculator, HandCoins, Plus, Printer, Trash2 } from 'lucide-react';
import { api, fmtDate, fmtMonth, inr, monthIST, todayIST, toast, useApi } from '@/lib/client';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, FormModal, Loading, METHODS, Modal, PageHeader, Stat, StatusBadge, Table, Tabs } from '@/components/ui';

function Payslip({ item, month, onClose }: { item: any; month: string; onClose: () => void }) {
  const gym = useApi('/settings');
  const row = (k: string, v: number, neg?: boolean) => <div className="flex justify-between py-1"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{neg && v > 0 ? '−' : ''}{inr(v)}</dd></div>;
  return (
    <Modal title="Payslip" onClose={onClose}>
      <div className="print-area">
        <div className="font-semibold text-ink text-lg">{gym.data?.gym_name}</div>
        <div className="text-muted mb-3">Salary slip for {fmtMonth(month)}</div>
        <div className="font-medium text-ink">{item.name}</div>
        <div className="text-muted mb-3">{item.role_title}</div>
        <div className="grid grid-cols-3 gap-2 text-center bg-canvas rounded-lg p-3 mb-3">
          <div><div className="font-semibold text-ink">{item.working_days}</div><div className="text-xs text-muted">Working days</div></div>
          <div><div className="font-semibold text-ink">{item.present_days}</div><div className="text-xs text-muted">Present</div></div>
          <div><div className="font-semibold text-ink">{item.absent_days}</div><div className="text-xs text-muted">Unpaid absent</div></div>
        </div>
        <dl>
          {row('Basic salary', item.base_salary)}
          {row('PT commission', item.commission)}
          {row('Bonus', item.bonus)}
          {row('Absence deduction', item.absence_deduction, true)}
          {row('Advance recovered', item.advance_deduction, true)}
          {row('Other deductions', item.other_deduction, true)}
          <div className="flex justify-between py-2 mt-1 border-t border-line font-semibold text-ink text-base"><dt>Net pay</dt><dd className="tabular-nums">{inr(item.net_pay)}</dd></div>
        </dl>
        {item.status === 'paid' && <p className="text-muted mt-1">Paid on {fmtDate(item.paid_on)} by {METHODS.find((m) => m.value === item.method)?.label}</p>}
      </div>
      <div className="flex justify-end mt-4 no-print"><Button onClick={() => window.print()}><Printer /> Print</Button></div>
    </Modal>
  );
}

function Advances() {
  const { data, reload } = useApi<any[]>('/advances');
  const staff = useApi<any[]>('/staff');
  const [add, setAdd] = useState(false);
  const [del, setDel] = useState<any>(null);
  if (!data) return <Loading />;
  return (
    <Card pad={false} title="Salary advances" subtitle="Money given early. It is deducted automatically from the next salary." action={<Button variant="primary" onClick={() => setAdd(true)}><Plus /> Give advance</Button>}>
      <Table rows={data} empty={<Empty icon={HandCoins} title="No advances given" />}
        cols={[
          { key: 'given_on', label: 'Date', render: (r) => fmtDate(r.given_on) },
          { key: 'staff_name', label: 'Staff', render: (r) => <span className="font-medium text-ink">{r.staff_name}</span> },
          { key: 'note', label: 'Note' },
          { key: 's', label: 'Status', render: (r) => r.recovered_item_id ? <Badge tone="green">Recovered</Badge> : <Badge tone="amber">To recover</Badge> },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amount) },
          { key: 'a', label: '', align: 'right', render: (r) => r.recovered_item_id ? null : <Button size="sm" variant="ghost" aria-label="Delete advance" onClick={() => setDel(r)}><Trash2 /></Button> },
        ]} />
      {add && <FormModal title="Give a salary advance" initial={{ given_on: todayIST() }} submitLabel="Save advance" onClose={() => setAdd(false)}
        fields={[
          { name: 'staff_id', label: 'Staff member', type: 'select', required: true, full: true, options: (staff.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
          { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0, required: true },
          { name: 'given_on', label: 'Date', type: 'date' },
          { name: 'note', label: 'Note', full: true },
        ]}
        onSubmit={async (v) => { await api('/advances', { body: v }); toast('Advance saved'); reload(); }} />}
      {del && <Confirm danger title="Delete this advance?" text={`${del.staff_name}, ${inr(del.amount)}`} confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api(`/advances/${del.id}`, { method: 'DELETE' }); reload(); }} />}
    </Card>
  );
}

export default function PayrollPage() {
  const [month, setMonth] = useState(monthIST());
  const [tab, setTab] = useState('run');
  const { data, error, reload } = useApi(`/payroll?month=${month}`);
  const [edit, setEdit] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [slip, setSlip] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const items: any[] = data.items;
  const total = items.reduce((a, i) => a + i.net_pay, 0);
  const paid = items.filter((i) => i.status === 'paid').reduce((a, i) => a + i.net_pay, 0);
  const assumed = items.filter((i) => i.attendance_assumed && i.status !== 'paid').length;

  const generate = async () => {
    setBusy(true);
    try { await api('/payroll/generate', { body: { month } }); toast('Salaries calculated'); await reload(); } catch (e: any) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="Salaries" help="Calculates each person’s pay from attendance, PT commission and advances. Check it, then mark as paid.">
        <input className="input !w-auto" type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <Button variant="primary" onClick={generate} disabled={busy}><Calculator /> {data.run ? 'Recalculate' : `Calculate ${fmtMonth(month)}`}</Button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'run', label: 'Monthly salaries' }, { key: 'advances', label: 'Advances' }]} />
      {tab === 'advances' ? <Advances /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <Stat label="Total salaries" value={inr(total)} />
            <Stat label="Paid" value={inr(paid)} />
            <Stat label="Still to pay" value={inr(total - paid)} tone={total - paid > 0 ? 'amber' : undefined} />
          </div>
          {assumed > 0 && (
            <div className="flex items-start gap-2 bg-amber-soft text-amber rounded-lg p-3 mb-4">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>{assumed} staff have no attendance this month, so full attendance is assumed. Click Edit to enter actual days.</span>
            </div>
          )}
          <Card pad={false}>
            <Table rows={items} empty={<Empty icon={HandCoins} title={`No salaries calculated for ${fmtMonth(month)}`} text="Add staff with a monthly salary, then calculate." action={<Button variant="primary" onClick={generate} disabled={busy}>Calculate salaries</Button>} />}
              cols={[
                { key: 'name', label: 'Staff', render: (r) => <span><span className="block font-medium text-ink">{r.name}</span><span className="text-muted text-[13px]">{r.role_title}</span></span> },
                { key: 'd', label: 'Present', render: (r) => <span className="tabular-nums">{r.present_days} of {r.working_days}{r.attendance_assumed && <span className="text-amber"> *</span>}</span> },
                { key: 'base_salary', label: 'Salary', align: 'right', render: (r) => inr(r.base_salary) },
                { key: 'commission', label: 'Added', align: 'right', render: (r) => inr(r.commission + r.bonus) },
                { key: 'cut', label: 'Deducted', align: 'right', render: (r) => inr(r.absence_deduction + r.advance_deduction + r.other_deduction) },
                { key: 'net_pay', label: 'To pay', align: 'right', render: (r) => <span className="font-semibold text-ink">{inr(r.net_pay)}</span> },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'a', label: '', align: 'right', render: (r) => (
                  <span className="inline-flex gap-1.5">
                    {r.status !== 'paid' && <Button size="sm" variant="primary" onClick={() => setPay(r)}>Pay</Button>}
                    {r.status !== 'paid' && <Button size="sm" onClick={() => setEdit(r)}>Edit</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setSlip(r)}>Slip</Button>
                  </span>) },
              ]} />
          </Card>
        </>
      )}
      {edit && <FormModal title={`Adjust salary: ${edit.name}`} subtitle={`${edit.working_days} working days in ${fmtMonth(month)}`} initial={edit} onClose={() => setEdit(null)}
        fields={[
          { name: 'present_days', label: 'Days present', type: 'number', min: 0, required: true },
          { name: 'paid_leaves', label: 'Paid leaves', type: 'number', min: 0, required: true },
          { name: 'bonus', label: 'Bonus (₹)', type: 'number', min: 0 },
          { name: 'advance_deduction', label: 'Advance to recover (₹)', type: 'number', min: 0 },
          { name: 'other_deduction', label: 'Other deductions (₹)', type: 'number', min: 0, help: 'PF, ESI, TDS or anything else', full: true },
        ]}
        onSubmit={async (v) => { await api(`/payroll/items/${edit.id}`, { method: 'PUT', body: v }); toast('Salary updated'); reload(); }} />}
      {pay && <FormModal title={`Pay ${pay.name}`} subtitle={`Net pay: ${inr(pay.net_pay)}`} initial={{ method: 'bank', paid_on: todayIST() }} submitLabel="Mark as paid" onClose={() => setPay(null)}
        fields={[{ name: 'method', label: 'Paid by', type: 'select', required: true, options: METHODS }, { name: 'paid_on', label: 'Date', type: 'date' }]}
        onSubmit={async (v) => { await api(`/payroll/items/${pay.id}/pay`, { body: v }); toast('Marked as paid'); reload(); }} />}
      {slip && <Payslip item={slip} month={month} onClose={() => setSlip(null)} />}
    </>
  );
}
