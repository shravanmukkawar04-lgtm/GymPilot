'use client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { downloadCsv, fmtDate, inr, useApi } from '@/lib/client';
import { Button, Card, Empty, ErrorNote, Loading, METHODS, PageHeader, Stat, Table, Tabs } from '@/components/ui';

export default function ReportsPage() {
  const router = useRouter();
  const { data, error, reload } = useApi('/reports');
  const [tab, setTab] = useState('pnl');
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const pnl = data.pnl.map((r: any) => ({ ...r, profit: r.income - r.expenses - r.payroll }));
  const year = pnl.reduce((a: any, r: any) => ({ income: a.income + r.income, spent: a.spent + r.expenses + r.payroll }), { income: 0, spent: 0 });
  const csv = (name: string, rows: any[]) => <Button size="sm" onClick={() => downloadCsv(name, rows)} disabled={!rows.length}><Download /> Excel (CSV)</Button>;
  const maxPlan = data.plans[0]?.revenue || 1;
  return (
    <>
      <PageHeader title="Reports" help="How your gym is doing. Download any report for your accountant." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'pnl', label: 'Profit & loss' }, { key: 'plans', label: 'Plans & enquiries' }, { key: 'gst', label: 'GST' }, { key: 'inactive', label: 'Stopped coming', count: data.inactive.length }]} />
      {tab === 'pnl' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <Stat label="Collected, last 12 months" value={inr(year.income)} />
            <Stat label="Spent, last 12 months" value={inr(year.spent)} />
            <Stat label="Profit, last 12 months" value={inr(year.income - year.spent)} tone={year.income - year.spent < 0 ? 'red' : undefined} />
          </div>
          <Card pad={false} title="Month by month" subtitle="Based on money actually received and paid" action={csv('profit-loss', pnl)}>
            <Table rows={pnl} cols={[
              { key: 'label', label: 'Month', render: (r) => <span className="font-medium text-ink">{r.label}</span> },
              { key: 'income', label: 'Collected', align: 'right', render: (r) => inr(r.income) },
              { key: 'expenses', label: 'Expenses', align: 'right', render: (r) => inr(r.expenses) },
              { key: 'payroll', label: 'Salaries', align: 'right', render: (r) => inr(r.payroll) },
              { key: 'profit', label: 'Profit', align: 'right', render: (r) => <span className={`font-medium ${r.profit < 0 ? 'text-rose' : 'text-ink'}`}>{inr(r.profit)}</span> },
            ]} />
          </Card>
        </>
      )}
      {tab === 'plans' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Income by plan" subtitle="Memberships billed in the last 12 months">
            {data.plans.length === 0 ? <Empty title="No plans sold yet" /> : (
              <ul className="space-y-3">{data.plans.map((p: any) => (
                <li key={p.plan_name}>
                  <div className="flex justify-between mb-1"><span className="text-ink">{p.plan_name} <span className="text-muted">({p.sold} sold)</span></span><span className="tabular-nums">{inr(p.revenue)}</span></div>
                  <div className="h-1.5 rounded-full bg-slate-soft"><div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${(p.revenue / maxPlan) * 100}%` }} /></div>
                </li>))}</ul>
            )}
          </Card>
          <Card pad={false} title="Where enquiries come from">
            <Table rows={data.sources} empty={<Empty title="No enquiries yet" />} cols={[
              { key: 'source', label: 'Source', render: (r) => <span className="font-medium text-ink">{r.source}</span> },
              { key: 'total', label: 'Enquiries', align: 'right' },
              { key: 'won', label: 'Joined', align: 'right' },
              { key: 'rate', label: 'Join rate', align: 'right', render: (r) => `${Math.round((r.won / r.total) * 100)}%` },
            ]} />
          </Card>
          <Card pad={false} title="This month’s collections by payment type" className="lg:col-span-2">
            <Table rows={data.methods} empty={<Empty title="No payments this month" />} cols={[
              { key: 'method', label: 'Paid by', render: (r) => <span className="font-medium text-ink">{METHODS.find((m) => m.value === r.method)?.label}</span> },
              { key: 'total', label: 'Amount', align: 'right', render: (r) => inr(r.total) },
            ]} />
          </Card>
        </div>
      )}
      {tab === 'gst' && (
        <Card pad={false} title="GST summary" subtitle="From bills in the last 12 months. Share with your accountant for filing." action={csv('gst-summary', data.gst)}>
          <Table rows={data.gst} empty={<Empty title="No bills yet" />} cols={[
            { key: 'label', label: 'Month', render: (r) => <span className="font-medium text-ink">{r.label}</span> },
            { key: 'invoices', label: 'Bills', align: 'right' },
            { key: 'taxable', label: 'Taxable value', align: 'right', render: (r) => inr(r.taxable) },
            { key: 'cgst', label: 'CGST', align: 'right', render: (r) => inr(r.cgst) },
            { key: 'sgst', label: 'SGST', align: 'right', render: (r) => inr(r.sgst) },
            { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
          ]} />
        </Card>
      )}
      {tab === 'inactive' && (
        <Card pad={false} title="Members who stopped coming" subtitle="Active plan, but no visit recently. A quick call can save the renewal." action={csv('inactive-members', data.inactive)}>
          <Table rows={data.inactive} onRow={(r) => router.push(`/members/${r.id}`)} empty={<Empty title="Everyone is coming regularly" />} cols={[
            { key: 'name', label: 'Member', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
            { key: 'phone', label: 'Phone' },
            { key: 'plan_name', label: 'Plan' },
            { key: 'last_visit', label: 'Last visit', render: (r) => fmtDate(r.last_visit) },
            { key: 'days_away', label: 'Days away', align: 'right' },
          ]} />
        </Card>
      )}
    </>
  );
}
