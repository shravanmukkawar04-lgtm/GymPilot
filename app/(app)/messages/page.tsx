'use client';
import { useRef, useState } from 'react';
import { CheckCheck, CheckCircle2, Link2, MessageCircle, PartyPopper, Pencil, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { api, fmtDate, fmtDateTime, toast, useApi, waLink } from '@/lib/client';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, FormFields, FormModal, Loading, MemberPicker, Modal, PageHeader, StatusBadge, Table, Tabs } from '@/components/ui';

const AUDIENCES = [
  { key: 'active', label: 'All active members' }, { key: 'all', label: 'Everyone' }, { key: 'expiring', label: 'Ending in 7 days' },
  { key: 'dues', label: 'Owes money' }, { key: 'expired', label: 'Expired' }, { key: 'inactive', label: 'Stopped coming' },
  { key: 'birthdays', label: 'Birthday today' }, { key: 'leads', label: 'Open enquiries' },
];
const CHANNELS = [{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'sms', label: 'SMS' }, { value: 'email', label: 'Email' }];
const HOLIDAY_PRESETS = [{ key: 'holiday_closed', label: 'Gym closed' }, { key: 'holiday_timings', label: 'Changed timings' }, { key: 'holiday_wishes', label: 'Festival wishes' }];
const VAR = /\{\{\s*(\w+)\s*\}\}/g;
const SAMPLE: Record<string, string> = { name: 'Rohan Patil', plan: 'Quarterly', expiry_date: '25-12-2026', due_amount: '1500' };

const blanks = (body: string, auto: string[]) => [...new Set([...body.matchAll(VAR)].map((m) => m[1]))].filter((v) => !auto.includes(v));
const pretty = (v: string) => v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const fill = (body: string, values: Record<string, string>) => body.replace(VAR, (m, k) => values[k] || SAMPLE[k] || m);
const isReady = (t: any) => !!t?.wa_template_name && (!t.wa_status || t.wa_status === 'APPROVED');
const fmtClock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };

function WaStatus({ t }: { t: any }) {
  const map: Record<string, [string, string]> = { APPROVED: ['green', 'Approved'], PENDING: ['amber', 'Waiting for Meta'], REJECTED: ['red', 'Rejected'], PAUSED: ['red', 'Paused by Meta'], DISABLED: ['red', 'Disabled by Meta'] };
  if (!t.wa_status) return <Badge>Not submitted</Badge>;
  const [tone, label] = map[t.wa_status] ?? ['gray', t.wa_status];
  return <Badge tone={tone}>{label}</Badge>;
}

function Bubble({ header, body, footer }: { header?: string | null; body: string; footer?: string | null }) {
  return (
    <div className="rounded-xl bg-[#e7ded3] p-3">
      <div className="bg-white rounded-lg rounded-tl-none px-3 py-2 shadow-sm max-w-[340px]">
        {header && <div className="font-semibold text-ink mb-1">{header}</div>}
        <div className="whitespace-pre-wrap text-ink leading-snug">{body || 'Your message appears here'}</div>
        {footer && <div className="text-faint text-xs mt-1">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Ready to send ---------- */

function Queue({ d, reload }: { d: any; reload: () => void }) {
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); reload(); } catch (e: any) { toast(e.message, 'error'); } };
  return (
    <Card pad={false} title="Ready to send" subtitle="These need one click each: WhatsApp opens with the message typed in, then you press send.">
      <Table rows={d.queue} empty={<Empty icon={CheckCheck} title="Nothing to send right now" text="Expiry, payment and birthday reminders appear here each day." />}
        cols={[
          { key: 'to_name', label: 'To', render: (r) => <span><span className="block font-medium text-ink">{r.to_name}</span><span className="text-muted text-[13px]">{r.phone ?? r.email}</span></span> },
          { key: 'body', label: 'Message', render: (r) => <span className="block min-w-64 max-w-md whitespace-normal text-[13px] leading-snug">{r.body}{r.error && <span className="block text-rose mt-1">{r.error}</span>}</span> },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'a', label: '', align: 'right', render: (r) => (
            <span className="inline-flex gap-1.5">
              {r.channel === 'whatsapp'
                ? <Button size="sm" variant="primary" href={waLink(r.phone, r.body)} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => act(() => api(`/comms/messages/${r.id}/sent`, { body: {} })), 400)}><MessageCircle /> WhatsApp</Button>
                : <Button size="sm" onClick={() => act(() => api(`/comms/messages/${r.id}/retry`, { body: {} }))}>Send</Button>}
              <Button size="sm" variant="ghost" aria-label="Discard" onClick={() => act(() => api(`/comms/messages/${r.id}`, { method: 'DELETE' }))}><Trash2 /></Button>
            </span>) },
        ]} />
    </Card>
  );
}

/* ---------- Bulk progress ---------- */

function Progress({ campaign, total, onClose }: { campaign: number; total: number; onClose: () => void }) {
  const [state, setState] = useState({ sent: 0, failed: 0, remaining: total, done: false, error: null as string | null });
  const started = useRef(false);
  const stop = useRef(false);
  if (!started.current) {
    started.current = true;
    (async () => {
      let sent = 0, failed = 0;
      while (!stop.current) {
        try {
          const r = await api(`/comms/campaigns/${campaign}/process`, { body: {} });
          sent += r.sent; failed += r.failed;
          setState((s) => ({ ...s, sent, failed, remaining: r.remaining }));
          if (r.stalled) { setState((s) => ({ ...s, done: true, error: 'This template is no longer approved, so sending stopped.' })); return; }
          if (r.remaining === 0) break;
        } catch (e: any) { setState((s) => ({ ...s, done: true, error: e.message })); return; }
      }
      setState((s) => ({ ...s, done: true }));
    })();
  }
  const finished = state.sent + state.failed;
  const pct = total ? Math.round((finished / total) * 100) : 100;
  return (
    <Modal title={state.done ? 'Sending finished' : 'Sending messages…'} subtitle={state.done ? undefined : 'Keep this page open until it finishes.'} onClose={() => { stop.current = true; onClose(); }}>
      <div className="h-2.5 rounded-full bg-slate-soft overflow-hidden"><div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="flex justify-between mt-2 tabular-nums"><span><b className="text-ink">{state.sent}</b> sent</span>{state.failed > 0 && <span className="text-rose">{state.failed} failed</span>}<span className="text-muted">{state.remaining} left</span></div>
      {state.error && <div className="mt-3"><ErrorNote message={state.error} /></div>}
      <div className="flex justify-end mt-4"><Button variant={state.done ? 'primary' : 'secondary'} onClick={() => { stop.current = true; onClose(); }}>{state.done ? 'Done' : 'Pause'}</Button></div>
    </Modal>
  );
}

/* ---------- New message ---------- */

function Compose({ d, onDone, openSetup }: { d: any; onDone: (toCampaigns: boolean) => void; openSetup: () => void }) {
  const [to, setTo] = useState('active');
  const [member, setMember] = useState<any>(null);
  const [channel, setChannel] = useState('whatsapp');
  const [templateId, setTemplateId] = useState('');
  const [text, setText] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState<{ id: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const template = d.templates.find((t: any) => String(t.id) === templateId) ?? null;
  const body = template?.body ?? text;
  const fields = blanks(body, d.auto_vars);
  const count = to === 'one' ? (member ? 1 : 0) : d.audiences[to] ?? 0;
  const missing = fields.some((f) => !values[f]?.trim());
  const automatic = channel === 'whatsapp' ? d.channels.whatsapp_api && isReady(template) : !!d.channels[channel];
  const shown = fill(body, { gym_name: d.gym_name, ...Object.fromEntries(fields.map((f) => [f, displayValue(f, values[f])])) });

  function displayValue(f: string, v?: string) {
    if (!v) return '';
    if (f.endsWith('_date')) return fmtDate(v);
    if (f.endsWith('_time')) return fmtClock(v);
    return v;
  }

  const send = async () => {
    setErr(null);
    const vars = Object.fromEntries(fields.map((f) => [f, displayValue(f, values[f])]));
    const r = await api('/comms/send', { body: { channel, template_id: template?.id ?? null, body: template ? null : text, vars, ...(to === 'one' ? { member_id: member } : { audience: to }) } });
    if (r.campaign_id && r.automatic && r.queued) { setRunning({ id: r.campaign_id, total: r.queued }); return; }
    toast(r.sent ? 'Message sent' : `${r.queued} message${r.queued === 1 ? '' : 's'} added to Ready to send`);
    onDone(false);
  };

  const quick = (key: string) => {
    const t = d.templates.find((x: any) => x.key === key);
    if (t) { setTemplateId(String(t.id)); setTo('active'); setChannel('whatsapp'); }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-4 items-start">
      <Card className="lg:col-span-3" title="Send a message">
        <div className="flex flex-wrap items-center gap-2 bg-amber-soft rounded-lg p-3 mb-4">
          <PartyPopper className="size-4 text-amber" /><span className="font-medium text-ink mr-1">Holiday message</span>
          {HOLIDAY_PRESETS.map((p) => <Button key={p.key} size="sm" onClick={() => quick(p.key)}>{p.label}</Button>)}
        </div>

        <label className="block text-[13px] font-medium text-ink mb-1.5">1. Who should get this?</label>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {[...AUDIENCES, { key: 'one', label: 'One person' }].map((a) => (
            <button type="button" key={a.key} onClick={() => setTo(a.key)} className={`h-8 px-3 rounded-full text-[13px] font-medium ${to === a.key ? 'bg-ink text-white' : 'bg-canvas text-muted hover:text-ink'}`}>
              {a.label}{a.key !== 'one' && <span className="ml-1 opacity-70 tabular-nums">{d.audiences[a.key]}</span>}
            </button>
          ))}
        </div>
        {to === 'one' && <div className="mb-4"><MemberPicker value={member} onChange={setMember} required /></div>}

        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <div className="sm:col-span-2">
            <label htmlFor="tpl" className="block text-[13px] font-medium text-ink mb-1">2. Choose a template</label>
            <select id="tpl" className="input" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setValues({}); }}>
              <option value="">Write my own message</option>
              {d.templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.wa_status === 'APPROVED' ? ' ✓' : ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="chn" className="block text-[13px] font-medium text-ink mb-1">Send by</label>
            <select id="chn" className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
          </div>
        </div>

        {!template && (
          <div className="mb-4">
            <label htmlFor="msg" className="block text-[13px] font-medium text-ink mb-1">Message</label>
            <textarea id="msg" rows={4} className="input" value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-muted text-xs mt-1">You can use {'{{name}} {{plan}} {{expiry_date}} {{due_amount}} {{gym_name}}'}</p>
          </div>
        )}

        {fields.length > 0 && (
          <div className="mb-4">
            <div className="text-[13px] font-medium text-ink mb-1.5">3. Fill in the details</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {fields.map((f) => (
                <div key={f}>
                  <label htmlFor={`v-${f}`} className="block text-[13px] text-muted mb-1">{pretty(f)}</label>
                  <input id={`v-${f}`} className="input" type={f.endsWith('_date') ? 'date' : f.endsWith('_time') ? 'time' : 'text'} value={values[f] ?? ''} onChange={(e) => setValues({ ...values, [f]: e.target.value })} />
                </div>
              ))}
            </div>
          </div>
        )}

        {channel === 'whatsapp' && (
          automatic
            ? <p className="flex items-center gap-2 text-brand-dark mb-3"><CheckCircle2 className="size-4 shrink-0" /> Sends automatically from your WhatsApp Business number. Meta bills your account per message.</p>
            : d.channels.whatsapp_api
              ? <p className="text-amber mb-3">{template ? 'This template is not approved yet.' : 'Your own wording cannot be sent in bulk through WhatsApp Business.'} Messages will wait in Ready to send for one-click sending. Use an approved template to send automatically.</p>
              : <p className="text-muted mb-3">WhatsApp Business is not connected, so these will wait in Ready to send for one-click sending. <button type="button" className="text-brand underline" onClick={openSetup}>Connect it</button></p>
        )}
        {channel !== 'whatsapp' && !d.channels[channel] && <p className="text-amber mb-3">{channel === 'sms' ? 'SMS' : 'Email'} is not set up yet, so these will stay in Ready to send. See the README to connect it.</p>}
        {err && <div className="mb-3"><ErrorNote message={err} /></div>}

        <div className="flex items-center justify-between gap-3">
          <span className="text-muted tabular-nums">{count} {count === 1 ? 'person' : 'people'} selected</span>
          <Button variant="primary" disabled={count === 0 || !body.trim() || missing} onClick={() => setConfirm(true)}><Send /> {automatic ? `Send to ${count}` : 'Prepare messages'}</Button>
        </div>
      </Card>

      <Card className="lg:col-span-2 lg:sticky lg:top-0" title="Preview" subtitle="How it looks on a member’s phone">
        <Bubble header={template?.header} body={shown} footer={template?.footer} />
      </Card>

      {confirm && <Confirm title={automatic ? `Send to ${count} ${count === 1 ? 'person' : 'people'}?` : 'Prepare these messages?'} text={automatic ? 'Messages go out immediately and cannot be recalled.' : 'They will be added to Ready to send.'} confirmLabel={automatic ? 'Send now' : 'Prepare'}
        onClose={() => setConfirm(false)} onConfirm={async () => { try { await send(); } catch (e: any) { setErr(e.message); } }} />}
      {running && <Progress campaign={running.id} total={running.total} onClose={() => { setRunning(null); onDone(true); }} />}
    </div>
  );
}

/* ---------- Templates ---------- */

function TemplateEditor({ t, d, onClose, onDone }: { t: any; d: any; onClose: () => void; onDone: () => void }) {
  const submitted = !!t.wa_template_id;
  const [v, setV] = useState<any>({ category: 'UTILITY', language: 'en', ...t });
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const insert = (name: string) => {
    const el = box.current;
    const at = el?.selectionStart ?? (v.body ?? '').length;
    const body = v.body ?? '';
    setV({ ...v, body: `${body.slice(0, at)}{{${name}}}${body.slice(at)}` });
    el?.focus();
  };
  const save = async (submit: boolean) => {
    setBusy(true); setErr(null);
    try {
      const saved = await api(t.id ? `/comms/templates/${t.id}` : '/comms/templates', { method: t.id ? 'PUT' : 'POST', body: v });
      if (submit) await api(`/comms/templates/${saved.id}/submit`, { body: {} });
      toast(submit ? 'Sent to Meta for approval' : 'Template saved');
      onDone(); onClose();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const preview = fill(v.body ?? '', { gym_name: d.gym_name, holiday_name: 'Diwali', holiday_date: '8 Nov', reopen_date: '10 Nov', open_time: '7 AM', close_time: '12 PM' });
  const canSubmit = d.channels.whatsapp_api && (!submitted || t.wa_status === 'REJECTED');

  return (
    <Modal wide title={t.id ? 'Edit template' : 'Create a template'} subtitle="Write once, reuse whenever you send." onClose={onClose}>
      <div className="grid md:grid-cols-5 gap-5">
        <div className="md:col-span-3">
          <FormFields values={v} set={(n, x) => setV({ ...v, [n]: x })} fields={[
            { name: 'name', label: 'Template name', required: true, full: true, placeholder: 'Republic Day closure' },
            { name: 'category', label: 'Type', type: 'select', required: true, options: [{ value: 'UTILITY', label: 'Information' }, { value: 'MARKETING', label: 'Greeting or offer' }], help: 'Closures and timings are information. Wishes and offers cost more on WhatsApp.' },
            { name: 'language', label: 'Language', type: 'select', required: true, options: [{ value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' }, { value: 'mr', label: 'Marathi' }] },
            { name: 'header', label: 'Heading (optional)', full: true },
          ]} />
          <label htmlFor="tbody" className="block text-[13px] font-medium text-ink mt-3.5 mb-1">Message<span className="text-rose"> *</span></label>
          <textarea id="tbody" ref={box} rows={5} className="input" value={v.body ?? ''} onChange={(e) => setV({ ...v, body: e.target.value })} />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[...d.auto_vars, 'holiday_name', 'holiday_date', 'reopen_date'].map((x: string) => <button type="button" key={x} onClick={() => insert(x)} className="h-7 px-2.5 rounded-md bg-canvas text-[12px] font-medium text-muted hover:text-ink">+ {pretty(x)}</button>)}
          </div>
          <div className="flex gap-2 mt-2">
            <input className="input !h-8 text-[13px]" aria-label="New blank name" placeholder="Add your own blank, like offer_price" value={custom} onChange={(e) => setCustom(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_'))} />
            <Button size="sm" disabled={!custom} onClick={() => { insert(custom.replace(/^_+|_+$/g, '')); setCustom(''); }}>Add</Button>
          </div>
          <div className="mt-3.5"><FormFields values={v} set={(n, x) => setV({ ...v, [n]: x })} fields={[{ name: 'footer', label: 'Footer (optional)', full: true, placeholder: 'Reply STOP to opt out' }]} /></div>
        </div>
        <div className="md:col-span-2">
          <div className="text-[13px] font-medium text-ink mb-1.5">Preview</div>
          <Bubble header={v.header} body={preview} footer={v.footer} />
          <p className="text-muted text-xs mt-2">WhatsApp needs a word before the first blank and after the last one, and no two blanks side by side.</p>
        </div>
      </div>
      {err && <div className="mt-4"><ErrorNote message={err} /></div>}
      <div className="flex flex-wrap justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !v.name || !v.body} onClick={() => save(false)}>{submitted && t.wa_status !== 'REJECTED' ? 'Save and send for re-approval' : 'Save'}</Button>
        {canSubmit && <Button variant="primary" disabled={busy || !v.name || !v.body} onClick={() => save(true)}>Save and send for approval</Button>}
      </div>
    </Modal>
  );
}

function Templates({ d, reload, openSetup }: { d: any; reload: () => void; openSetup: () => void }) {
  const [edit, setEdit] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>, ok: string | ((r: any) => string)) => {
    setBusy(true);
    try { const r = await fn(); toast(typeof ok === 'string' ? ok : ok(r)); reload(); } catch (e: any) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Card pad={false} title="Message templates" subtitle="WhatsApp only allows bulk sending with templates Meta has approved, usually within a day"
      action={<span className="flex flex-wrap justify-end gap-2">
        {d.channels.whatsapp_api && <Button disabled={busy} onClick={() => run(() => api('/comms/templates/sync', { body: {} }), (r) => `Checked ${r.checked} templates with Meta${r.imported ? `, ${r.imported} imported` : ''}`)}><RefreshCw /> Check approval</Button>}
        <Button variant="primary" onClick={() => setEdit({})}><Plus /> Create template</Button>
      </span>}>
      {!d.channels.whatsapp_api && <p className="mx-4 mb-3 bg-canvas rounded-lg p-3">Connect WhatsApp Business to send templates for approval. <button className="text-brand underline" onClick={openSetup}>Connect now</button></p>}
      <Table rows={d.templates} onRow={setEdit}
        cols={[
          { key: 'name', label: 'Name', render: (r) => <span><span className="block font-medium text-ink">{r.name}</span><span className="text-muted text-[13px]">{r.category === 'MARKETING' ? 'Greeting or offer' : 'Information'}</span></span> },
          { key: 'body', label: 'Message', render: (r) => <span className="block min-w-64 max-w-lg whitespace-normal text-[13px] leading-snug">{r.body}{r.wa_rejected_reason && <span className="block text-rose mt-1">Rejected: {r.wa_rejected_reason}</span>}</span> },
          { key: 'wa', label: 'WhatsApp', render: (r) => <WaStatus t={r} /> },
          { key: 'a', label: '', align: 'right', render: (r) => (
            <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
              {d.channels.whatsapp_api && (!r.wa_template_id || r.wa_status === 'REJECTED') && <Button size="sm" disabled={busy} onClick={() => run(() => api(`/comms/templates/${r.id}/submit`, { body: {} }), 'Sent to Meta for approval')}>Send for approval</Button>}
              <Button size="sm" variant="ghost" aria-label="Edit template" onClick={() => setEdit(r)}><Pencil /></Button>
              {!r.key && <Button size="sm" variant="ghost" aria-label="Delete template" onClick={() => setDel(r)}><Trash2 /></Button>}
            </span>) },
        ]} />
      {edit && <TemplateEditor t={edit} d={d} onClose={() => setEdit(null)} onDone={reload} />}
      {del && <Confirm danger title={`Delete "${del.name}"?`} text={del.wa_template_name ? 'It will also be deleted from your WhatsApp Business account.' : 'This cannot be undone.'} confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api(`/comms/templates/${del.id}`, { method: 'DELETE' }); toast('Template deleted'); reload(); }} />}
    </Card>
  );
}

/* ---------- Bulk sends ---------- */

function Campaigns() {
  const { data, reload } = useApi<any[]>('/comms/campaigns');
  const [running, setRunning] = useState<{ id: number; total: number } | null>(null);
  if (!data) return <Loading />;
  const auto = data.filter((c) => c.total > 0);
  return (
    <Card pad={false} title="Bulk sends" subtitle="Delivered and Read need the webhook from WhatsApp setup">
      <Table rows={auto} empty={<Empty icon={Send} title="No bulk messages sent yet" />}
        cols={[
          { key: 'name', label: 'Message', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
          { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
          { key: 'total', label: 'People', align: 'right' },
          { key: 'sent', label: 'Sent', align: 'right' },
          { key: 'delivered', label: 'Delivered', align: 'right' },
          { key: 'read_count', label: 'Read', align: 'right' },
          { key: 'failed', label: 'Failed', align: 'right', render: (r) => r.failed ? <span className="text-rose font-medium">{r.failed}</span> : 0 },
          { key: 'a', label: '', align: 'right', render: (r) => (
            <span className="inline-flex gap-1.5">
              {r.mode === 'automatic' && r.queued > 0 && <Button size="sm" variant="primary" onClick={() => setRunning({ id: r.id, total: r.queued })}>Continue</Button>}
              {r.mode === 'automatic' && r.failed > 0 && <Button size="sm" onClick={async () => { const x = await api(`/comms/campaigns/${r.id}/retry`, { body: {} }); setRunning({ id: r.id, total: x.queued }); }}>Retry failed</Button>}
            </span>) },
        ]} />
      {running && <Progress campaign={running.id} total={running.total} onClose={() => { setRunning(null); reload(); }} />}
    </Card>
  );
}

function History() {
  const { data } = useApi<any[]>('/comms/history');
  if (!data) return <Loading />;
  const LABEL: Record<string, string> = { sent: 'Sent', delivered: 'Delivered', read: 'Read' };
  return (
    <Card pad={false}>
      <Table rows={data} empty={<Empty title="No messages sent yet" />}
        cols={[
          { key: 'sent_at', label: 'Sent', render: (r) => fmtDateTime(r.sent_at) },
          { key: 'to_name', label: 'To', render: (r) => <span className="font-medium text-ink">{r.to_name}</span> },
          { key: 'channel', label: 'By', render: (r) => <span className="capitalize">{r.channel}</span> },
          { key: 'delivery_status', label: 'Status', render: (r) => r.delivery_status ? <Badge tone={r.delivery_status === 'read' ? 'green' : 'blue'}>{LABEL[r.delivery_status] ?? r.delivery_status}</Badge> : <Badge>Opened by you</Badge> },
          { key: 'body', label: 'Message', render: (r) => <span className="block min-w-64 max-w-xl whitespace-normal text-[13px] leading-snug">{r.body}</span> },
        ]} />
    </Card>
  );
}

/* ---------- WhatsApp setup ---------- */

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[13px] text-muted mb-1">{label}</div>
      <div className="flex gap-2">
        <code className="flex-1 min-w-0 bg-canvas rounded-lg px-3 py-2 text-[13px] break-all">{value}</code>
        <Button size="sm" onClick={() => { navigator.clipboard.writeText(value); toast('Copied'); }}>Copy</Button>
      </div>
    </div>
  );
}

function Setup({ onChange }: { onChange: () => void }) {
  const { data, error, reload } = useApi('/comms/whatsapp');
  const [form, setForm] = useState(false);
  const [off, setOff] = useState(false);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const done = () => { reload(); onChange(); };
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="WhatsApp Business account" action={data.connected ? <Badge tone="green">Connected</Badge> : <Badge>Not connected</Badge>}>
        {data.connected ? (
          <>
            <dl className="grid grid-cols-2 gap-3 mb-4">
              <div><dt className="text-muted text-[13px]">Business name</dt><dd className="text-ink font-medium">{data.verified_name ?? '—'}</dd></div>
              <div><dt className="text-muted text-[13px]">WhatsApp number</dt><dd className="text-ink font-medium">{data.display_phone ?? '—'}</dd></div>
              <div><dt className="text-muted text-[13px]">Number quality</dt><dd className="text-ink font-medium">{data.quality_rating ?? '—'}</dd></div>
              <div><dt className="text-muted text-[13px]">Connected</dt><dd className="text-ink font-medium">{fmtDateTime(data.connected_at)}</dd></div>
            </dl>
            <div className="flex gap-2"><Button onClick={() => setForm(true)}>Update details</Button><Button variant="danger" onClick={() => setOff(true)}>Disconnect</Button></div>
          </>
        ) : (
          <>
            <p className="mb-4">Connect once to send approved templates to everyone automatically from your business number.</p>
            <Button variant="primary" onClick={() => setForm(true)}><Link2 /> Connect WhatsApp Business</Button>
          </>
        )}
      </Card>

      <Card title="What you need from Meta" subtitle="From business.facebook.com and developers.facebook.com">
        <ol className="list-decimal pl-4 space-y-2">
          <li>Create a Meta app of type <b>Business</b> and add the <b>WhatsApp</b> product.</li>
          <li>Add and verify your business phone number. It cannot stay on the normal WhatsApp app.</li>
          <li>Copy the <b>Phone number ID</b> and <b>WhatsApp Business Account ID</b> from WhatsApp → API Setup.</li>
          <li>In Business Settings, create a <b>System User</b> and a permanent token with <code className="bg-canvas rounded px-1">whatsapp_business_messaging</code> and <code className="bg-canvas rounded px-1">whatsapp_business_management</code>.</li>
          <li>Add a payment method in WhatsApp Manager, because Meta bills per message.</li>
        </ol>
      </Card>

      <Card className="lg:col-span-2" title="Delivery reports (optional)" subtitle="Shows Delivered and Read, and honours STOP replies. Needs the app on a public HTTPS address.">
        <div className="grid md:grid-cols-2 gap-3 mb-2">
          <Copyable label="Callback URL" value={data.webhook_url} />
          <Copyable label="Verify token" value={data.verify_token} />
        </div>
        <p className="text-muted text-[13px]">In your Meta app, open WhatsApp → Configuration, paste these, and subscribe to <b>messages</b>. Add your App Secret under Update details. {data.has_app_secret ? 'App Secret is saved.' : 'No App Secret saved yet.'}</p>
      </Card>

      {form && <FormModal title="Connect WhatsApp Business" subtitle="We check these with Meta before saving. Your token is stored encrypted." submitLabel="Check and connect" initial={{ phone_number_id: data.phone_number_id ?? '', waba_id: data.waba_id ?? '' }} onClose={() => setForm(false)}
        fields={[
          { name: 'phone_number_id', label: 'Phone number ID', required: true, full: true },
          { name: 'waba_id', label: 'WhatsApp Business Account ID', required: true, full: true },
          { name: 'access_token', label: 'Permanent access token', type: 'password', required: !data.connected, full: true, help: data.connected ? 'Leave blank to keep the saved token.' : undefined },
          { name: 'app_secret', label: 'App Secret (for delivery reports)', type: 'password', full: true, help: 'Optional. Meta app → App settings → Basic.' },
        ]}
        onSubmit={async (v) => { await api('/comms/whatsapp', { method: 'PUT', body: v }); toast('WhatsApp Business connected'); done(); }} />}
      {off && <Confirm danger title="Disconnect WhatsApp Business?" text="Automatic sending stops. Your templates stay here." confirmLabel="Disconnect" onClose={() => setOff(false)} onConfirm={async () => { await api('/comms/whatsapp', { method: 'DELETE' }); toast('Disconnected'); done(); }} />}
    </div>
  );
}

export default function MessagesPage() {
  const { data, error, reload } = useApi('/comms/overview');
  const auth = useApi('/auth/state');
  const [tab, setTab] = useState('queue');
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data || !auth.data) return <Loading />;
  const d = { ...data, gym_name: auth.data.gym_name };
  const setup = () => setTab('setup');
  return (
    <>
      <PageHeader title="Messages" help="Send holiday notices and offers in bulk, and clear the reminders prepared for you each day.">
        <Button variant="primary" onClick={() => setTab('compose')}><Send /> New message</Button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'queue', label: 'Ready to send', count: data.queue.length }, { key: 'compose', label: 'New message' }, { key: 'templates', label: 'Templates', count: data.templates.length }, { key: 'campaigns', label: 'Bulk sends' }, { key: 'history', label: 'Sent' }, { key: 'setup', label: 'WhatsApp setup' }]} />
      {tab === 'queue' && <Queue d={d} reload={reload} />}
      {tab === 'compose' && <Compose d={d} openSetup={setup} onDone={(c) => { reload(); setTab(c ? 'campaigns' : 'queue'); }} />}
      {tab === 'templates' && <Templates d={d} reload={reload} openSetup={setup} />}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'history' && <History />}
      {tab === 'setup' && <Setup onChange={reload} />}
    </>
  );
}
