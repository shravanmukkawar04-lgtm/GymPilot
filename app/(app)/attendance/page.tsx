'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Fingerprint, Loader2, Plus, Search, Trash2, Users } from 'lucide-react';
import { api, fmtDate, fmtDateTime, fmtTime, monthIST, todayIST, toast, useApi } from '@/lib/client';
import { Avatar, Badge, Button, Card, Confirm, Empty, ErrorNote, FormModal, Loading, Modal, PageHeader, Stat, StatusBadge, Table, Tabs } from '@/components/ui';
import { slotLabel } from '@/components/sales';

function PersonSearch({ onPick }: { onPick: (p: any) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => setRows(await api(`/attendance/people?q=${encodeURIComponent(q)}`).catch(() => [])), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <div className="relative"><Search className="absolute left-3 top-3 size-4 text-faint" />
        <input autoFocus className="input !pl-9" placeholder="Type a name or phone number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" /></div>
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {rows.map((p) => (
          <li key={`${p.type}${p.id}`}>
            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-canvas text-left" onClick={() => onPick(p)}>
              <Avatar name={p.name} size={32} />
              <span className="flex-1 min-w-0"><span className="font-medium text-ink">{p.name}</span> <span className="text-muted">{p.phone}</span></span>
              {p.type === 'member' ? <StatusBadge status={p.detail} /> : <Badge>{p.detail}</Badge>}
            </button>
          </li>
        ))}
        {!rows.length && <li className="text-muted px-2 py-3">No one found</li>}
      </ul>
    </div>
  );
}

/** Pick a batch (time slot), tick the members who came, and mark them all present in one go. A plan can narrow the list. */
function BatchCheckin({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const opts = useApi<any>('/attendance/batch-options');
  const [slot, setSlot] = useState('');
  const [plan, setPlan] = useState('');
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = useApi<any[]>(slot ? `/attendance/by-batch?slot_id=${slot}&plan_id=${plan}&include_all=${all ? 1 : 0}` : null);
  const rows: any[] = slot ? list.data ?? [] : [];
  const open = rows.filter((r) => !r.check_in); // not marked yet today
  // Whenever the list changes, tick everyone who is not marked yet and has a valid plan.
  useEffect(() => { setPicked((list.data ?? []).filter((r) => !r.check_in && r.status === 'active').map((r) => r.id)); }, [list.data]);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const everyone = open.length > 0 && open.every((r) => picked.includes(r.id));
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/attendance/manual-batch', { body: { member_ids: picked } });
      toast(`${r.marked} member${r.marked === 1 ? '' : 's'} marked present${r.notValid ? ` (${r.notValid} without a valid plan)` : ''}${r.already ? `, ${r.already} already marked` : ''}`);
      onDone(); onClose();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  if (!opts.data) return <Modal title="Mark attendance by batch" onClose={onClose}><Loading /></Modal>;
  const { slots, plans, no_batch } = opts.data;
  return (
    <Modal wide title="Mark attendance by batch" subtitle="Choose a batch, tick the members who came today, then mark them present." onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="bb" className="block text-[13px] font-medium text-ink mb-1">Batch</label>
          <select id="bb" className="input" value={slot} onChange={(e) => { setSlot(e.target.value); setErr(null); }}>
            <option value="">Choose a batch…</option>
            {slots.map((s: any) => <option key={s.id} value={s.id}>{slotLabel(s)} · {s.members} member{s.members === 1 ? '' : 's'}</option>)}
            {no_batch > 0 && <option value="none">No batch · {no_batch} member{no_batch === 1 ? '' : 's'}</option>}
          </select>
        </div>
        <div>
          <label htmlFor="bp" className="block text-[13px] font-medium text-ink mb-1">Plan (optional)</label>
          <select id="bp" className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">All plans</option>
            {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {!slots.length && !no_batch && <p className="text-muted mt-3">No batches yet. Add time slots under Members → Plans &amp; time slots.</p>}
      {slot && (
        <>
          <label className="flex items-center gap-2 mt-3 text-[13px] text-muted cursor-pointer">
            <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Also show members whose plan has ended or is on hold
          </label>
          <div className="mt-3 border border-line rounded-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-canvas border-b border-line">
              <label className="flex items-center gap-2.5 cursor-pointer font-medium text-ink">
                <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={everyone} disabled={!open.length}
                  onChange={(e) => setPicked(e.target.checked ? open.map((r) => r.id) : [])} aria-label="Select everyone" />
                Select all
              </label>
              <span className="text-muted text-[13px]">{picked.length} of {rows.length} ticked</span>
            </div>
            {!list.data ? <Loading /> : !rows.length ? <Empty icon={Users} title="No members found" text="No one in this batch matches. Try another batch or plan." /> : (
              <ul className="max-h-80 overflow-y-auto divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.id}>
                    <label className={`flex items-center gap-3 px-3 py-2.5 ${r.check_in ? 'opacity-60' : 'cursor-pointer hover:bg-canvas'}`}>
                      <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={!r.check_in && picked.includes(r.id)} disabled={!!r.check_in} onChange={() => toggle(r.id)} />
                      <Avatar name={r.name} size={32} />
                      <span className="flex-1 min-w-0"><span className="block font-medium text-ink truncate">{r.name}</span><span className="text-muted text-[13px]">{r.member_code}{r.plan_name ? ` · ${r.plan_name}` : ''}</span></span>
                      {r.check_in ? <Badge tone="green">In at {fmtTime(r.check_in)}</Badge> : <StatusBadge status={r.status} />}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {err && <div className="mt-3"><ErrorNote message={err} /></div>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !picked.length} onClick={submit}>{busy && <Loader2 className="animate-spin" />}Mark {picked.length || ''} present</Button>
      </div>
    </Modal>
  );
}

function Live({ data, reload }: { data: any; reload: () => void }) {
  const s = data.summary;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Members today" value={s.members_today} />
        <Stat label="Inside right now" value={s.inside_now} />
        <Stat label="Staff present" value={`${s.staff_today} of ${s.staff_total}`} />
        <Stat label="Entered without valid plan" value={s.flagged_today} tone={s.flagged_today > 0 ? 'red' : undefined} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Members today" className="lg:col-span-2" pad={false} action={<Button size="sm" variant="ghost" onClick={reload}>Refresh</Button>}>
          <Table rows={data.members} empty={<Empty icon={Fingerprint} title="No check-ins yet today" text="Scans from your fingerprint machine appear here automatically." />}
            cols={[
              { key: 'name', label: 'Member', render: (r) => <span><span className="block font-medium text-ink">{r.name}</span><span className="text-muted text-[13px]">{r.plan_name ?? 'No plan'}</span></span> },
              { key: 'in', label: 'In', render: (r) => fmtTime(r.check_in) },
              { key: 'out', label: 'Out', render: (r) => r.check_out ? fmtTime(r.check_out) : <Badge tone="green">Inside</Badge> },
              { key: 's', label: 'Membership', render: (r) => r.membership_ok ? <StatusBadge status={r.member_status} /> : <Badge tone="red">Not valid</Badge> },
              { key: 'dues', label: 'How', render: (r) => r.source === 'manual' ? 'Front desk' : 'Fingerprint' },
            ]} />
        </Card>
        <Card title="Staff today" pad={false}>
          <Table rows={data.staff} empty={<Empty title="No staff check-ins yet" />}
            cols={[
              { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
              { key: 'in', label: 'In', render: (r) => fmtTime(r.check_in) },
              { key: 'out', label: 'Out', render: (r) => fmtTime(r.check_out) },
            ]} />
        </Card>
      </div>
    </>
  );
}

function History() {
  const [type, setType] = useState('member');
  const [from, setFrom] = useState(`${monthIST()}-01`);
  const [to, setTo] = useState(todayIST());
  const { data, error, reload } = useApi<any[]>(`/attendance/history?type=${type}&from=${from}&to=${to}`);
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-end gap-2 p-3 border-b border-line">
        <select className="input !w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Who"><option value="member">Members</option><option value="staff">Staff</option></select>
        <input className="input !w-auto" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input className="input !w-auto" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
      </div>
      {error ? <div className="p-4"><ErrorNote message={error} retry={reload} /></div> : !data ? <Loading /> : (
        <Table rows={data} empty={<Empty title="No attendance in these dates" />}
          cols={[
            { key: 'day', label: 'Date', render: (r) => fmtDate(r.day) },
            { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
            { key: 'detail', label: type === 'staff' ? 'Job' : 'Member ID' },
            { key: 'in', label: 'In', render: (r) => fmtTime(r.check_in) },
            { key: 'out', label: 'Out', render: (r) => fmtTime(r.check_out) },
            { key: 'source', label: 'How', render: (r) => r.source === 'manual' ? 'Front desk' : 'Fingerprint' },
          ]} />
      )}
    </Card>
  );
}

function Devices() {
  const { data, reload } = useApi<any[]>('/attendance/devices');
  const [edit, setEdit] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const server = useApi('/attendance/server-info');
  const activity = useApi('/attendance/machine-activity');
  const [register, setRegister] = useState(false);
  const [started, setStarted] = useState<any>(null);
  useEffect(() => { const t = setInterval(() => { activity.reload(); reload(); }, 15_000); return () => clearInterval(t); }, [activity.reload, reload]);
  if (!data) return <Loading />;
  const sync = async (d: any) => {
    try {
      const r = await api(`/attendance/devices/${d.id}/sync`, { body: {} });
      toast(r.queued ? `${r.queued} people will be sent to ${d.name} at its next check-in` : 'No one has a fingerprint number yet');
      activity.reload();
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const RESULT: Record<string, [string, string]> = { in: ['green', 'Checked in'], out: ['blue', 'Checked out'], ignored: ['gray', 'Double scan'], unknown: ['amber', 'Not linked'] };
  const CMD: Record<string, [string, string]> = { pending: ['amber', 'Waiting for machine'], sent: ['blue', 'Sent to machine'], done: ['green', 'Done'], failed: ['red', 'Machine refused'] };
  const online = (d: any) => d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 5 * 60_000;
  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-3" pad={false} title="Fingerprint machines" action={<span className="flex flex-wrap justify-end gap-2">{data.length > 0 && <Button onClick={() => setRegister(true)}><Fingerprint /> Register a finger</Button>}<Button variant="primary" onClick={() => setEdit({ active: true })}><Plus /> Add machine</Button></span>}>
        <Table rows={data} onRow={setEdit} empty={<Empty icon={Fingerprint} title="No machine connected yet" text="Add your machine using its serial number. You can still check people in from the front desk." action={<Button variant="primary" onClick={() => setEdit({ active: true })}>Add machine</Button>} />}
          cols={[
            { key: 'name', label: 'Machine', render: (r) => <span><span className="block font-medium text-ink">{r.name}</span><span className="text-muted text-[13px]">SN {r.serial_number}</span></span> },
            { key: 'c', label: 'Connection', render: (r) => online(r) ? <Badge tone="green">Online</Badge> : r.last_seen_at ? <Badge tone="amber">Last seen {fmtDateTime(r.last_seen_at)}</Badge> : <Badge>Waiting for machine</Badge> },
            { key: 'punches_24h', label: 'Scans in 24h', align: 'right' },
            { key: 'a', label: '', align: 'right', render: (r) => <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}><Button size="sm" onClick={() => sync(r)}>Send people</Button><Button size="sm" variant="ghost" aria-label="Delete machine" onClick={() => setDel(r)}><Trash2 /></Button></span> },
          ]} />
      </Card>
      <Card className="lg:col-span-2" title="How to connect" subtitle="For ZKTeco and other machines with ADMS / Cloud Server">
        <ol className="list-decimal pl-4 space-y-2">
          <li>Add the machine here using the serial number from its info screen.</li>
          <li>On the machine, open <b>Comm → Cloud Server (ADMS)</b>.</li>
          <li>Set server address to <code className="bg-canvas rounded px-1 break-all">{server.data?.addresses?.join(' or ') || 'this computer’s IP address'}</code> and port to <code className="bg-canvas rounded px-1">{server.data?.port ?? '3000'}</code>. Turn HTTPS and proxy off.</li>
          <li>Restart the machine. It shows Online here within a minute.</li>
          <li>For a new person, click <b>Register a finger</b>. For people already on the machine, enter their machine number as their <b>Fingerprint number</b>.</li>
        </ol>
        {data.length > 0 && <p className="text-muted text-[13px] mt-3">Other brands can post scans to <code className="bg-canvas rounded px-1">/api/biometric/punch</code> using the device key: <code className="bg-canvas rounded px-1 break-all">{data[0].api_key}</code></p>}
      </Card>
      <Card className="lg:col-span-3" pad={false} title="Latest scans" subtitle="Straight from the machine. Use this to confirm it is working.">
        <Table rows={activity.data?.scans ?? []} empty={<Empty icon={Fingerprint} title="No scans received yet" />}
          cols={[
            { key: 'punched_at', label: 'When', render: (r) => fmtDateTime(r.punched_at) },
            { key: 'person', label: 'Person', render: (r) => r.person ? <span className="font-medium text-ink">{r.person}</span> : `Number ${r.device_user_id}` },
            { key: 'result', label: 'Result', render: (r) => <Badge tone={(RESULT[r.result] ?? ['gray'])[0]}>{(RESULT[r.result] ?? ['', r.result])[1]}</Badge> },
          ]} />
      </Card>
      <Card className="lg:col-span-2" pad={false} title="Sent to machine" subtitle="Machines collect these every few seconds">
        <Table rows={activity.data?.commands ?? []} empty={<Empty title="Nothing sent yet" />}
          cols={[
            { key: 'label', label: 'Action', render: (r) => <span className="block min-w-40 whitespace-normal">{r.label}</span> },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={CMD[r.status][0]}>{CMD[r.status][1]}</Badge> },
          ]} />
      </Card>
      {register && (
        <Modal title="Register a fingerprint" subtitle="Pick the person, then ask them to go to the machine." onClose={() => setRegister(false)}>
          <PersonSearch onPick={async (p) => {
            try {
              const r = await api('/attendance/enroll', { body: { [p.type === 'member' ? 'member_id' : 'staff_id']: p.id } });
              setRegister(false); setStarted(r); activity.reload();
            } catch (e: any) { toast(e.message, 'error'); }
          }} />
        </Modal>
      )}
      {started && (
        <Modal title={`${started.name} is number ${started.pin}`} onClose={() => setStarted(null)}>
          <p>The machine will ask for a finger within a few seconds. Ask {started.name} to place the same finger three times.</p>
          <p className="text-muted mt-2">If the machine does not prompt, its model cannot start this remotely. On the machine, open <b>User Mgt → New User</b>, enter number <b>{started.pin}</b> and register the finger there.</p>
          <div className="flex justify-end mt-4"><Button variant="primary" onClick={() => setStarted(null)}>Done</Button></div>
        </Modal>
      )}
      {edit && <FormModal title={edit.id ? 'Edit machine' : 'Add machine'} initial={edit} onClose={() => setEdit(null)}
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'Main entrance', full: true },
          { name: 'serial_number', label: 'Serial number', required: true, full: true, help: 'Must match the machine exactly. Find it under System Info.' },
          { name: 'location', label: 'Location', full: true },
          { name: 'active', label: 'Accept scans from this machine', type: 'checkbox' },
        ]}
        onSubmit={async (v) => { await api(edit.id ? `/attendance/devices/${edit.id}` : '/attendance/devices', { method: edit.id ? 'PUT' : 'POST', body: v }); toast('Machine saved'); reload(); }} />}
      {del && <Confirm danger title={`Delete ${del.name}?`} text="Scans from this machine will stop being accepted. Attendance already recorded stays." confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api(`/attendance/devices/${del.id}`, { method: 'DELETE' }); reload(); }} />}
    </div>
  );
}

function Unmatched({ onDone }: { onDone: () => void }) {
  const { data, reload } = useApi<any[]>('/attendance/unmatched');
  const [link, setLink] = useState<any>(null);
  if (!data) return <Loading />;
  return (
    <Card pad={false} title="Unlinked fingerprints" subtitle="The machine sent these numbers, but no one in the app has them yet">
      <Table rows={data} empty={<Empty icon={Fingerprint} title="Every fingerprint is linked" />}
        cols={[
          { key: 'device_user_id', label: 'Machine user number', render: (r) => <span className="font-medium text-ink">{r.device_user_id}</span> },
          { key: 'scans', label: 'Scans', align: 'right' },
          { key: 'last_scan', label: 'Last scan', render: (r) => fmtDateTime(r.last_scan) },
          { key: 'a', label: '', align: 'right', render: (r) => <Button size="sm" variant="primary" onClick={() => setLink(r)}>Link to a person</Button> },
        ]} />
      {link && (
        <Modal title={`Who is number ${link.device_user_id}?`} subtitle="Past scans will be added to their attendance." onClose={() => setLink(null)}>
          <PersonSearch onPick={async (p) => {
            try {
              const r = await api('/attendance/link', { body: { device_user_id: link.device_user_id, [p.type === 'member' ? 'member_id' : 'staff_id']: p.id } });
              toast(`Linked to ${p.name}. ${r.replayed} scans added.`); setLink(null); reload(); onDone();
            } catch (e: any) { toast(e.message, 'error'); }
          }} />
        </Modal>
      )}
    </Card>
  );
}

function Inner() {
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') ?? 'today');
  const [checkin, setCheckin] = useState(sp.get('checkin') === '1');
  const [batch, setBatch] = useState(false);
  const { data, error, reload } = useApi('/attendance/today');
  useEffect(() => { const t = setInterval(reload, 20_000); return () => clearInterval(t); }, [reload]);
  useEffect(() => { if (sp.get('checkin') === '1') setCheckin(true); }, [sp]);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader title="Attendance" help="Fingerprint scans appear here automatically. Use front desk check-in if a scan fails.">
        <Button onClick={() => setBatch(true)}><Users /> Mark by batch</Button>
        <Button variant="primary" onClick={() => setCheckin(true)}><Fingerprint /> Front desk check-in</Button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'today', label: 'Today' }, { key: 'history', label: 'History' }, { key: 'devices', label: 'Machines' }, { key: 'unmatched', label: 'Unlinked', count: data.summary.unmatched }]} />
      {tab === 'today' && <Live data={data} reload={reload} />}
      {tab === 'history' && <History />}
      {tab === 'devices' && <Devices />}
      {tab === 'unmatched' && <Unmatched onDone={reload} />}
      {batch && <BatchCheckin onClose={() => setBatch(false)} onDone={reload} />}
      {checkin && (
        <Modal title="Front desk check-in" subtitle="Pick a person. Pick them again later to check them out." onClose={() => setCheckin(false)}>
          <PersonSearch onPick={async (p) => {
            try {
              const r = await api('/attendance/manual', { body: { [p.type === 'member' ? 'member_id' : 'staff_id']: p.id } });
              if (!r.membershipOk) toast(`${p.name}: recorded, but membership is not valid today`, 'error');
              else toast(`${p.name} checked ${r.result === 'in' ? 'in' : 'out'}`);
              setCheckin(false); reload();
            } catch (e: any) { toast(e.message, 'error'); }
          }} />
        </Modal>
      )}
    </>
  );
}

export default function AttendancePage() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
