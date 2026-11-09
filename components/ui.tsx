'use client';
import Link from 'next/link';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, Search, X } from 'lucide-react';
import { api } from '@/lib/client';

/* ---------- Basics ---------- */

const BTN: Record<string, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark',
  secondary: 'bg-white text-ink border border-line hover:bg-canvas',
  ghost: 'text-muted hover:bg-canvas hover:text-ink',
  danger: 'bg-white text-rose border border-line hover:bg-rose-soft',
};

export function Button({ variant = 'secondary', size = 'md', className = '', href, ...p }: any) {
  const cls = `inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-50 [&>svg]:size-4 ${size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-10 px-3.5'} ${BTN[variant]} ${className}`;
  if (href) return <Link href={href} className={cls} {...p} />;
  return <button type="button" className={cls} {...p} />;
}

export function Card({ title, subtitle, action, children, className = '', pad = true }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`bg-surface border border-line rounded-xl ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-[15px]">{title}</h2>
            {subtitle && <p className="text-muted text-[13px] mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={pad ? `px-4 pb-4 ${title ? '' : 'pt-4'}` : ''}>{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  green: 'bg-brand-soft text-brand-dark', amber: 'bg-amber-soft text-amber', red: 'bg-rose-soft text-rose',
  blue: 'bg-sky-soft text-sky', gray: 'bg-slate-soft text-muted',
};
export function Badge({ tone = 'gray', children }: { tone?: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

const STATUS: Record<string, [string, string]> = {
  active: ['green', 'Active'], expired: ['red', 'Expired'], frozen: ['blue', 'On hold'], upcoming: ['blue', 'Starts soon'], none: ['gray', 'No plan'],
  paid: ['green', 'Paid'], partial: ['amber', 'Part paid'], unpaid: ['red', 'Not paid'], cancelled: ['gray', 'Cancelled'], pending: ['amber', 'Not paid yet'],
  scheduled: ['blue', 'Booked'], completed: ['green', 'Done'], no_show: ['red', 'Did not come'],
  queued: ['amber', 'Ready to send'], sent: ['green', 'Sent'], failed: ['red', 'Failed'],
};
export function StatusBadge({ status }: { status: string }) {
  const [tone, label] = STATUS[status] ?? ['gray', status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return <span style={{ width: size, height: size, fontSize: size * 0.36 }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-dark font-semibold">{initials}</span>;
}

export function PageHeader({ title, help, children }: { title: string; help: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5 no-print">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-[22px] font-semibold">{title}</h1>
        <p className="text-muted mt-0.5">{help}</p>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: 'red' | 'amber' }) {
  const body = (
    <>
      <div className="text-muted text-[13px]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'red' ? 'text-rose' : tone === 'amber' ? 'text-amber' : 'text-ink'}`}>{value}</div>
      {hint && <div className="text-faint text-xs mt-1">{hint}</div>}
    </>
  );
  const cls = 'block bg-surface border border-line rounded-xl p-4';
  return href ? <Link href={href} className={`${cls} hover:border-brand transition-colors`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Loading() {
  return <div className="flex items-center justify-center py-24 text-muted gap-2"><Loader2 className="size-5 animate-spin" /> Loading…</div>;
}

export function ErrorNote({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-rose-soft text-rose rounded-lg p-3">
      <AlertCircle className="size-4 shrink-0" /> <span className="flex-1">{message}</span>
      {retry && <button className="underline" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Empty({ icon: Icon = Info, title, text, action }: { icon?: any; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand mb-3"><Icon className="size-5" /></span>
      <div className="font-semibold text-ink">{title}</div>
      {text && <p className="text-muted mt-1 max-w-sm">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line mb-4 no-print">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-3 py-2.5 whitespace-nowrap font-medium border-b-2 -mb-px ${value === t.key ? 'border-brand text-brand-dark' : 'border-transparent text-muted hover:text-ink'}`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs text-faint tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export type Col = { key: string; label: string; render?: (r: any) => ReactNode; align?: 'right' };

export function Table({ cols, rows, onRow, empty }: { cols: Col[]; rows: any[]; onRow?: (r: any) => void; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? <Empty title="Nothing here yet" />}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line">
            {cols.map((c) => <th key={c.key} className={`px-4 py-2.5 text-xs font-medium text-muted whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} onClick={onRow ? () => onRow(r) : undefined} className={`border-b border-line last:border-0 ${onRow ? 'cursor-pointer hover:bg-canvas' : ''}`}>
              {cols.map((c) => <td key={c.key} className={`px-4 py-3 align-middle whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; message: string; kind: string }[]>([]);
  useEffect(() => {
    const on = (e: any) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, ...e.detail }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000);
    };
    window.addEventListener('gp-toast', on);
    return () => window.removeEventListener('gp-toast', on);
  }, []);
  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 no-print" role="status">
      {items.map((t) => (
        <div key={t.id} className="flex items-center gap-2 bg-ink text-white rounded-lg px-4 py-3 shadow-lg sm:max-w-sm">
          {t.kind === 'error' ? <AlertCircle className="size-4 text-red-300 shrink-0" /> : <CheckCircle2 className="size-4 text-emerald-300 shrink-0" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`bg-surface w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-2xl sm:rounded-2xl max-h-[92dvh] flex flex-col`}>
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 no-print">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <p className="text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button aria-label="Close" onClick={onClose} className="p-1 -m-1 rounded-md text-muted hover:text-ink"><X className="size-5" /></button>
        </header>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Data-driven forms ---------- */

export type Opt = { value: string | number; label: string };
export type Field = {
  name: string; label: string;
  type?: 'text' | 'number' | 'date' | 'datetime-local' | 'tel' | 'email' | 'password' | 'select' | 'textarea' | 'checkbox' | 'member' | 'section';
  options?: Opt[]; required?: boolean; help?: string; placeholder?: string; full?: boolean; min?: number; step?: string;
  show?: (v: any) => boolean;
};

export function MemberPicker({ value, onChange, required, initialName }: { value: any; onChange: (id: any, m?: any) => void; required?: boolean; initialName?: string }) {
  const [term, setTerm] = useState(initialName ?? '');
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<any>(null);
  const search = (t: string) => {
    setTerm(t); onChange(null); setOpen(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await api(`/members?limit=8&q=${encodeURIComponent(t)}`).catch(() => ({ rows: [] }));
      setRows(r.rows);
    }, 200);
  };
  return (
    <div className="relative">
      <Search className="absolute left-3 top-3 size-4 text-faint" />
      <input className="input !pl-9" placeholder="Type a name or phone number" value={term} required={required && !value} autoComplete="off"
        onChange={(e) => search(e.target.value)} onFocus={() => { if (!value) search(term); }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && rows.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-line rounded-lg shadow-lg">
          {rows.map((m) => (
            <button type="button" key={m.id} className="block w-full text-left px-3 py-2 hover:bg-canvas"
              onMouseDown={() => { setTerm(m.name); onChange(m.id, m); setOpen(false); }}>
              <span className="text-ink font-medium">{m.name}</span> <span className="text-muted">{m.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldInput({ f, v, set }: { f: Field; v: any; set: (val: any) => void }) {
  const common = { id: f.name, required: f.required, placeholder: f.placeholder };
  if (f.type === 'select') return (
    <select {...common} className="input" value={v ?? ''} onChange={(e) => set(e.target.value)}>
      {!f.required && <option value="">Not selected</option>}
      {f.required && (v === '' || v === undefined || v === null) && <option value="">Choose…</option>}
      {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  if (f.type === 'textarea') return <textarea {...common} rows={3} className="input" value={v ?? ''} onChange={(e) => set(e.target.value)} />;
  if (f.type === 'member') return <MemberPicker value={v} required={f.required} onChange={(id) => set(id)} />;
  return <input {...common} className="input" type={f.type ?? 'text'} min={f.min} step={f.step ?? (f.type === 'number' ? 'any' : undefined)} value={v ?? ''} onChange={(e) => set(e.target.value)} />;
}

export function FormFields({ fields, values, set }: { fields: Field[]; values: any; set: (name: string, val: any) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3.5">
      {fields.filter((f) => !f.show || f.show(values)).map((f) => {
        if (f.type === 'section') return <h3 key={f.name} className="sm:col-span-2 font-semibold pt-2 border-t border-line first:border-0 first:pt-0">{f.label}</h3>;
        if (f.type === 'checkbox') return (
          <label key={f.name} className="sm:col-span-2 flex items-start gap-2.5 py-1 cursor-pointer">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
            <span><span className="text-ink">{f.label}</span>{f.help && <span className="block text-muted text-[13px]">{f.help}</span>}</span>
          </label>
        );
        return (
          <div key={f.name} className={f.full || f.type === 'textarea' || f.type === 'member' ? 'sm:col-span-2' : ''}>
            <label htmlFor={f.name} className="block text-[13px] font-medium text-ink mb-1">{f.label}{f.required && <span className="text-rose"> *</span>}</label>
            <FieldInput f={f} v={values[f.name]} set={(val) => set(f.name, val)} />
            {f.help && <p className="text-muted text-xs mt-1">{f.help}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function FormModal({ title, subtitle, fields, initial, submitLabel = 'Save', onSubmit, onClose, onChangeValues, summary, wide }: {
  title: string; subtitle?: string; fields: Field[]; initial?: any; submitLabel?: string;
  onSubmit: (v: any) => Promise<unknown>; onClose: () => void;
  onChangeValues?: (name: string, v: any) => any; summary?: (v: any) => ReactNode; wide?: boolean;
}) {
  const [v, setV] = useState<any>(initial ?? {});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (name: string, val: any) => setV((p: any) => {
    const next = { ...p, [name]: val };
    return onChangeValues ? { ...next, ...onChangeValues(name, next) } : next;
  });
  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} wide={wide}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { await onSubmit(v); onClose(); } catch (x: any) { setErr(x.message); setBusy(false); }
      }}>
        <FormFields fields={fields} values={v} set={set} />
        {summary && <div className="mt-4">{summary(v)}</div>}
        {err && <div className="mt-4"><ErrorNote message={err} /></div>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Confirm({ title, text, confirmLabel = 'Yes, continue', danger, onConfirm, onClose }: { title: string; text: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-body">{text}</p>
      {err && <div className="mt-3"><ErrorNote message={err} /></div>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Go back</Button>
        <Button variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await onConfirm(); onClose(); } catch (x: any) { setErr(x.message); setBusy(false); }
        }}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

export const METHODS: Opt[] = [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank transfer' }];

export const paymentFields: Field[] = [
  { name: 'pay_amount', label: 'Amount received now (₹)', type: 'number', min: 0, help: 'Enter 0 to collect later. The balance shows as due.' },
  { name: 'pay_method', label: 'Paid by', type: 'select', options: METHODS, required: true },
  { name: 'pay_reference', label: 'UPI / card reference', placeholder: 'Optional', full: true, show: (v) => v.pay_method && v.pay_method !== 'cash' },
];

export const toPayment = (v: any) => Number(v.pay_amount) > 0 ? { amount: Number(v.pay_amount), method: v.pay_method || 'cash', reference: v.pay_reference || null } : null;
