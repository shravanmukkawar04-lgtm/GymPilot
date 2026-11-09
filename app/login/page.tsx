'use client';
import { useEffect, useState } from 'react';
import { BellRing, CalendarCheck, Fingerprint, Loader2, ReceiptText } from 'lucide-react';
import { api } from '@/lib/client';
import { Button, ErrorNote, Loading } from '@/components/ui';

const HIGHLIGHTS = [
  { icon: Fingerprint, text: 'Fingerprint attendance' },
  { icon: BellRing, text: 'WhatsApp reminders' },
  { icon: ReceiptText, text: 'GST bills and UPI' },
];

function Photos() {
  return (
    <div className="absolute inset-0 bg-ink" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="login-slide" src="/login/barbell.jpg" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="login-slide" src="/login/dumbbells.jpg" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="login-slide" src="/login/floor.jpg" alt="" />
    </div>
  );
}

export default function LoginPage() {
  const [state, setState] = useState<any>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [v, setV] = useState<any>({ gym_name: '', name: '', email: '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/state').then((s) => {
      if (s.user) window.location.href = '/dashboard'; else setState(s);
    }).catch((e) => setLoadErr(e.message));
  }, []);

  if (loadErr) return <div className="max-w-md mx-auto p-6 mt-20"><ErrorNote message={`${loadErr} Check that DATABASE_URL in .env is correct and that you ran "npm run db:setup".`} /></div>;
  if (!state) return <Loading />;
  const setup = state.needsSetup;
  const brand = setup ? 'GymPilot' : state.gym_name;
  const input = (name: string, label: string, type = 'text', help?: string) => (
    <div>
      <label htmlFor={name} className="block text-[13px] font-medium text-ink mb-1">{label}</label>
      <input id={name} className="input !h-11" type={type} required minLength={type === 'password' && setup ? 8 : undefined} value={v[name]} onChange={(e) => setV({ ...v, [name]: e.target.value })} />
      {help && <p className="text-muted text-xs mt-1">{help}</p>}
    </div>
  );

  return (
    <div className="min-h-dvh flex flex-col lg:flex-row bg-surface">
      <aside className="relative h-52 sm:h-64 lg:h-auto lg:flex-[1.25] overflow-hidden text-white">
        <Photos />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/55 to-ink/25" />
        <div className="relative h-full flex flex-col justify-between p-5 sm:p-8 lg:p-12">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand"><CalendarCheck className="size-5" /></span>
            <span className="text-lg font-semibold">{brand}</span>
          </div>
          <div>
            <h2 className="!text-white text-2xl sm:text-3xl lg:text-5xl font-semibold leading-tight max-w-xl">Run your whole gym from one screen.</h2>
            <ul className="hidden lg:flex flex-wrap gap-2.5 mt-6">
              {HIGHLIGHTS.map((h) => (
                <li key={h.text} className="flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3.5 py-2 font-medium">
                  <h.icon className="size-4" /> {h.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <form className="w-full max-w-sm space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr(null);
          try {
            await api(setup ? '/auth/setup' : '/auth/login', { body: setup ? v : { email: v.email, password: v.password } });
            window.location.href = '/dashboard';
          } catch (x: any) { setErr(x.message); setBusy(false); }
        }}>
          <div className="mb-2">
            <h1 className="text-2xl font-semibold">{setup ? 'Set up your gym' : 'Welcome back'}</h1>
            <p className="text-muted mt-1">{setup ? 'Create the owner account. It takes less than a minute.' : 'Log in to see what is happening at your gym today.'}</p>
          </div>
          {setup && input('gym_name', 'Gym name')}
          {setup && input('name', 'Your name')}
          {input('email', 'Email', 'email')}
          {input('password', 'Password', 'password', setup ? 'At least 8 characters' : undefined)}
          {err && <ErrorNote message={err} />}
          <Button variant="primary" type="submit" disabled={busy} className="w-full !h-11">
            {busy && <Loader2 className="animate-spin" />}{setup ? 'Create my account' : 'Log in'}
          </Button>
        </form>
      </main>
    </div>
  );
}
