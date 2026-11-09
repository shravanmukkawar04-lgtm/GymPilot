'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Wallet } from 'lucide-react';
import { api, fmtDate, inr, monthIST, todayIST, toast, useApi } from '@/lib/client';
import { Button, Card, Confirm, Empty, ErrorNote, Field, FormModal, Loading, METHODS, PageHeader, Stat, Table } from '@/components/ui';

const CATEGORIES = ['Rent', 'Electricity', 'Water', 'Internet', 'Equipment repair', 'New equipment', 'Cleaning', 'Marketing', 'Stock purchase', 'Staff welfare', 'Other'];
const fields: Field[] = [
  { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0, required: true },
  { name: 'expense_date', label: 'Date', type: 'date', required: true },
  { name: 'category', label: 'Category', type: 'select', required: true, options: CATEGORIES.map((c) => ({ value: c, label: c })) },
  { name: 'method', label: 'Paid by', type: 'select', required: true, options: METHODS },
  { name: 'description', label: 'What was this for?', full: true },
  { name: 'vendor', label: 'Paid to' },
  { name: 'reference', label: 'Bill or reference no.' },
];

function Inner() {
  const sp = useSearchParams();
  const [month, setMonth] = useState(monthIST());
  const { data, error, reload } = useApi(`/expenses?month=${month}`);
  const [edit, setEdit] = useState<any>(sp.get('new') === '1' ? {} : null);
  const [del, setDel] = useState<any>(null);
  useEffect(() => { if (sp.get('new') === '1') setEdit({}); }, [sp]);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const total = data.rows.reduce((a: number, r: any) => a + r.amount, 0);
  const top = data.byCategory[0];
  const max = top?.total || 1;

  return (
    <>
      <PageHeader title="Expenses" help="Rent, bills, repairs and anything else you pay for. Salaries are tracked under Salaries.">
        <input className="input !w-auto" type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <Button variant="primary" onClick={() => setEdit({})}><Plus /> Add expense</Button>
      </PageHeader>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <Stat label="Spent this month" value={inr(total)} />
        <Stat label="Entries" value={data.rows.length} />
        <Stat label="Biggest category" value={top?.category ?? '—'} hint={top ? inr(top.total) : undefined} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card pad={false} className="lg:col-span-2">
          <Table rows={data.rows} onRow={setEdit} empty={<Empty icon={Wallet} title="No expenses this month" action={<Button variant="primary" onClick={() => setEdit({})}>Add expense</Button>} />}
            cols={[
              { key: 'expense_date', label: 'Date', render: (r) => fmtDate(r.expense_date) },
              { key: 'category', label: 'Category', render: (r) => <span className="font-medium text-ink">{r.category}</span> },
              { key: 'description', label: 'For' },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amount) },
            ]} />
        </Card>
        <Card title="Where the money went">
          {data.byCategory.length === 0 ? <p className="text-muted">Nothing yet.</p> : (
            <ul className="space-y-3">
              {data.byCategory.map((c: any) => (
                <li key={c.category}>
                  <div className="flex justify-between mb-1"><span className="text-ink">{c.category}</span><span className="tabular-nums">{inr(c.total)}</span></div>
                  <div className="h-1.5 rounded-full bg-slate-soft"><div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${(c.total / max) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {edit && (
        <FormModal title={edit.id ? 'Edit expense' : 'Add expense'} fields={fields} initial={edit.id ? edit : { expense_date: todayIST(), method: 'cash' }} onClose={() => setEdit(null)}
          summary={edit.id ? () => <button type="button" className="text-rose underline" onClick={() => { setDel(edit); setEdit(null); }}>Delete this expense</button> : undefined}
          onSubmit={async (v) => { await api(edit.id ? `/expenses/${edit.id}` : '/expenses', { method: edit.id ? 'PUT' : 'POST', body: v }); toast('Expense saved'); reload(); }} />
      )}
      {del && <Confirm danger title="Delete this expense?" text={`${del.category}, ${inr(del.amount)}`} confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api(`/expenses/${del.id}`, { method: 'DELETE' }); toast('Deleted'); reload(); }} />}
    </>
  );
}

export default function ExpensesPage() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
