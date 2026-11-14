'use client';
import { useCallback, useEffect, useState } from 'react';
import { Building2, KeyRound, LogOut, Plus, UserPlus } from 'lucide-react';
import { fmtDate, toast } from '@/lib/client';
import { Avatar, Badge, Button, Card, Confirm, Empty, ErrorNote, FormModal, Loading, Toaster } from '@/components/ui';

const KEY = 'gp_super_key';

/** Calls the super admin API with the key kept in this browser tab only. */
async function sapi<T = any>(path: string, body?: unknown): Promise<T> {
  const key = sessionStorage.getItem(KEY) ?? '';
  const res = await fetch(`/api/super${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-super-key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 && path === '/gyms') throw new Error('KEY');
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function GymPhoto({ gym }: { gym: any }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!gym.photo_v) return;
    let url: string | null = null;
    fetch(`/api/super/gyms/${gym.id}/photo`, { headers: { 'x-super-key': sessionStorage.getItem(KEY) ?? '' } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [gym.id, gym.photo_v]);
  return <Avatar name={gym.gym_name ?? 'Gym'} size={44} src={src} />;
}

function KeyForm({ onDone, failed }: { onDone: () => void; failed: boolean }) {
  const [key, setKey] = useState('');
  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-canvas">
      <form className="w-full max-w-sm bg-surface border border-line rounded-2xl p-6 space-y-4" onSubmit={(e) => { e.preventDefault(); sessionStorage.setItem(KEY, key.trim()); onDone(); }}>
        <div className="flex items-center gap-2"><KeyRound className="size-5 text-brand" /><h1 className="text-xl font-semibold">GymPilot admin</h1></div>
        <p className="text-muted">Enter the super admin key (SUPERADMIN_KEY on the server).</p>
        <input className="input !h-11" type="password" autoFocus required value={key} onChange={(e) => setKey(e.target.value)} aria-label="Super admin key" autoComplete="off" />
        {failed && <ErrorNote message="That key is not right, or SUPERADMIN_KEY is not set on the server (it must be at least 24 characters)." />}
        <Button variant="primary" type="submit" className="w-full !h-11">Open</Button>
      </form>
    </div>
  );
}

export default function SuperAdminPage() {
  const [gyms, setGyms] = useState<any[] | null>(null);
  const [needKey, setNeedKey] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pause, setPause] = useState<any>(null);
  const [reset, setReset] = useState<any>(null);
  const [owner, setOwner] = useState<any>(null);

  const load = useCallback(async () => {
    if (!sessionStorage.getItem(KEY)) { setNeedKey(true); return; }
    try { setGyms(await sapi('/gyms')); setNeedKey(false); setError(null); }
    catch (e: any) {
      if (e.message === 'KEY') { sessionStorage.removeItem(KEY); setFailed(true); setNeedKey(true); }
      else setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (needKey) return <KeyForm failed={failed} onDone={() => { setFailed(false); load(); }} />;
  if (error) return <div className="max-w-xl mx-auto p-6"><ErrorNote message={error} retry={load} /></div>;
  if (!gyms) return <Loading />;

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-[22px] font-semibold">Gyms on GymPilot</h1>
            <p className="text-muted mt-0.5">Create a gym account for each customer. Each gym only ever sees its own data.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { sessionStorage.removeItem(KEY); window.location.reload(); }}><LogOut /> Lock</Button>
            <Button variant="primary" onClick={() => setCreating(true)}><Plus /> New gym</Button>
          </div>
        </div>

        <Card pad={false}>
          {!gyms.length ? (
            <Empty icon={Building2} title="No gyms yet" text="Create the first gym and its owner login." action={<Button variant="primary" onClick={() => setCreating(true)}>New gym</Button>} />
          ) : (
            <div className="divide-y divide-line">
              {gyms.map((g) => (
                <div key={g.id} className="p-4 flex flex-wrap items-start gap-3">
                  <GymPhoto gym={g} />
                  <div className="flex-1 min-w-56">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{g.gym_name ?? `Gym ${g.id}`}</span>
                      {g.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Paused</Badge>}
                      <span className="text-faint text-xs">#{g.id}</span>
                    </div>
                    <div className="text-muted text-[13px] mt-0.5">
                      {g.branches} branch{g.branches === 1 ? '' : 'es'} · {g.members} members · since {fmtDate(String(g.created_at).slice(0, 10))}
                      {g.last_bill && ` · last bill ${fmtDate(String(g.last_bill).slice(0, 10))}`}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(g.owners ?? []).map((o: any) => (
                        <span key={o.id} className="inline-flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-1 text-[13px]">
                          <span className="text-ink font-medium">{o.name}</span><span className="text-muted">{o.email}</span>
                          <button className="text-brand-dark underline" onClick={() => setReset(o)}>Reset password</button>
                        </span>
                      ))}
                    </div>
                    {g.notes && <p className="text-muted text-[13px] mt-2">{g.notes}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setOwner(g)}><UserPlus /> Add owner</Button>
                    <Button size="sm" variant={g.active ? 'danger' : 'secondary'} onClick={() => setPause(g)}>{g.active ? 'Pause' : 'Resume'}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {creating && <FormModal wide title="New gym" subtitle="Creates the gym, its first branch and the owner's login. Share the email and password with the owner."
        submitLabel="Create gym" onClose={() => setCreating(false)} initial={{ branch_name: 'Main branch' }}
        fields={[
          { name: 's1', label: 'Gym', type: 'section' },
          { name: 'gym_photo', label: 'Gym photo or logo', type: 'photo' },
          { name: 'gym_name', label: 'Gym name', required: true },
          { name: 'branch_name', label: 'First branch name', help: 'They can add more branches later in Settings.' },
          { name: 'phone', label: 'Gym phone' },
          { name: 'address', label: 'Address' },
          { name: 's2', label: 'Owner login', type: 'section' },
          { name: 'owner_photo', label: 'Owner photo', type: 'photo' },
          { name: 'owner_name', label: 'Owner name', required: true },
          { name: 'email', label: 'Login email', type: 'email', required: true },
          { name: 'password', label: 'Password', type: 'password', required: true, help: 'At least 8 characters' },
          { name: 'notes', label: 'Private notes', type: 'textarea', placeholder: 'Plan, price, renewal date… only you see this' },
        ]}
        onSubmit={async (v) => { await sapi('/gyms', v); toast(`${v.gym_name} is ready. The owner can log in now.`); load(); }} />}

      {pause && <Confirm danger={pause.active} title={pause.active ? `Pause ${pause.gym_name}?` : `Resume ${pause.gym_name}?`}
        text={pause.active ? 'Everyone at this gym is logged out and cannot log in, and its fingerprint machines and reminders stop. No data is deleted.' : 'The gym can log in and use GymPilot again.'}
        confirmLabel={pause.active ? 'Pause gym' : 'Resume gym'} onClose={() => setPause(null)}
        onConfirm={async () => { await sapi(`/gyms/${pause.id}/active`, { active: !pause.active }); toast(pause.active ? 'Gym paused' : 'Gym resumed'); load(); }} />}

      {reset && <FormModal title={`New password for ${reset.name}`} submitLabel="Set password" onClose={() => setReset(null)}
        fields={[{ name: 'password', label: 'New password', type: 'password', required: true, full: true, help: 'At least 8 characters' }]}
        onSubmit={async (v) => { await sapi(`/users/${reset.id}/password`, v); toast('Password changed'); }} />}

      {owner && <FormModal title={`Another owner for ${owner.gym_name}`} submitLabel="Add owner" onClose={() => setOwner(null)}
        fields={[
          { name: 'name', label: 'Name', required: true, full: true },
          { name: 'email', label: 'Login email', type: 'email', required: true, full: true },
          { name: 'password', label: 'Password', type: 'password', required: true, full: true, help: 'At least 8 characters' },
        ]}
        onSubmit={async (v) => { await sapi(`/gyms/${owner.id}/owners`, v); toast('Owner added'); load(); }} />}
      <Toaster />
    </div>
  );
}
