'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  BarChart3, CalendarCheck, Dumbbell, Fingerprint, LayoutDashboard, LogOut, Megaphone, Menu, MessageCircle, Package,
  Plus, ReceiptText, Search, Settings, UserCog, Users, Wallet, HandCoins,
} from 'lucide-react';
import { api } from '@/lib/client';
import { Loading, Toaster } from './ui';

const NAV = [
  { group: '', items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' }] },
  { group: 'People', items: [
    { href: '/members', label: 'Members', icon: Users, perm: 'members' },
    { href: '/leads', label: 'Enquiries', icon: Megaphone, perm: 'leads' },
    { href: '/trainers', label: 'Trainers & Staff', icon: UserCog, perm: 'trainers' },
  ] },
  { group: 'Daily work', items: [
    { href: '/attendance', label: 'Attendance', icon: Fingerprint, perm: 'attendance' },
    { href: '/pt', label: 'Personal Training', icon: Dumbbell, perm: 'pt' },
    { href: '/inventory', label: 'Shop & Stock', icon: Package, perm: 'inventory' },
    { href: '/messages', label: 'Messages', icon: MessageCircle, perm: 'comms' },
  ] },
  { group: 'Money', items: [
    { href: '/billing', label: 'Bills & Payments', icon: ReceiptText, perm: 'billing' },
    { href: '/expenses', label: 'Expenses', icon: Wallet, perm: 'expenses' },
    { href: '/payroll', label: 'Salaries', icon: HandCoins, perm: 'payroll' },
    { href: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports' },
  ] },
  { group: '', items: [{ href: '/settings', label: 'Settings', icon: Settings, perm: 'settings' }] },
];

const QUICK = [
  { href: '/members?new=1', label: 'New member' },
  { href: '/leads?new=1', label: 'New enquiry' },
  { href: '/attendance?checkin=1', label: 'Check someone in' },
  { href: '/billing?new=1', label: 'New bill' },
  { href: '/expenses?new=1', label: 'Add expense' },
];

const UserCtx = createContext<any>(null);
export const useUser = () => useContext(UserCtx);
export const canSee = (u: any, perm: string) => u?.permissions?.includes('*') || u?.permissions?.includes(perm);

function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [res, setRes] = useState<any>(null);
  const timer = useRef<any>(null);
  const router = useRouter();
  const change = (t: string) => {
    setTerm(t);
    clearTimeout(timer.current);
    if (!t.trim()) return setRes(null);
    timer.current = setTimeout(async () => setRes(await api(`/search?q=${encodeURIComponent(t)}`).catch(() => null)), 200);
  };
  const go = (href: string) => { setTerm(''); setRes(null); router.push(href); };
  const none = res && !res.members.length && !res.leads.length;
  return (
    <div className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-3 size-4 text-faint" />
      <input className="input !pl-9" aria-label="Search" placeholder="Search members or enquiries by name or phone" value={term} onChange={(e) => change(e.target.value)} onBlur={() => setTimeout(() => setRes(null), 150)} />
      {res && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-line rounded-lg shadow-lg py-1">
          {none && <div className="px-3 py-3 text-muted">No one found for “{term}”</div>}
          {res.members.map((m: any) => (
            <button key={m.id} className="block w-full text-left px-3 py-2 hover:bg-canvas" onMouseDown={() => go(`/members/${m.id}`)}>
              <span className="font-medium text-ink">{m.name}</span> <span className="text-muted">{m.phone} · Member</span>
            </button>
          ))}
          {res.leads.map((l: any) => (
            <button key={l.id} className="block w-full text-left px-3 py-2 hover:bg-canvas" onMouseDown={() => go(`/leads?open=${l.id}`)}>
              <span className="font-medium text-ink">{l.name}</span> <span className="text-muted">{l.phone} · Enquiry</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickAdd() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0 ml-auto">
      <button onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-3.5 font-medium text-white hover:bg-brand-dark">
        <Plus className="size-4" /> <span className="hidden sm:inline">Quick add</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-48 bg-white border border-line rounded-lg shadow-lg py-1">
          {QUICK.map((q) => <Link key={q.href} href={q.href} className="block px-3 py-2 hover:bg-canvas text-ink">{q.label}</Link>)}
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<any>(null);
  const [menu, setMenu] = useState(false);
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    api('/auth/state').then((s) => {
      if (!s.user) router.replace('/login');
      else setState(s);
    }).catch(() => router.replace('/login'));
  }, [router]);
  useEffect(() => setMenu(false), [path]);

  if (!state) return <Loading />;
  const user = state.user;
  const isOwner = canSee(user, 'members');

  const sidebar = (
    <nav className="flex flex-col h-full bg-ink text-white/75 w-60 no-print">
      <div className="flex items-center gap-2.5 px-4 h-16 shrink-0">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-white"><CalendarCheck className="size-[18px]" /></span>
        <span className="font-semibold text-white truncate">{state.gym_name}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {NAV.map((g, i) => {
          const items = g.items.filter((it) => canSee(user, it.perm));
          if (!items.length) return null;
          return (
            <div key={i} className="mb-3">
              {g.group && <div className="px-2.5 mb-1 text-[11px] font-medium uppercase tracking-wider text-white/40">{g.group}</div>}
              {items.map((it) => {
                const on = path === it.href || path.startsWith(it.href + '/');
                return (
                  <Link key={it.href} href={it.href} aria-current={on ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 h-9 font-medium ${on ? 'bg-white/12 text-white' : 'hover:bg-white/6 hover:text-white'}`}>
                    <it.icon className="size-[18px] shrink-0" /> {it.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 p-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-white font-medium truncate">{user.name}</div>
          <div className="text-xs text-white/50 capitalize">{user.role}</div>
        </div>
        <button aria-label="Log out" title="Log out" className="p-2 rounded-md hover:bg-white/10" onClick={async () => { await api('/auth/logout', { body: {} }); window.location.href = '/login'; }}>
          <LogOut className="size-4" />
        </button>
      </div>
    </nav>
  );

  return (
    <UserCtx.Provider value={user}>
      <div className="flex h-dvh">
        <div className="hidden lg:block shrink-0">{sidebar}</div>
        {menu && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            {sidebar}
            <button aria-label="Close menu" className="flex-1 bg-ink/50" onClick={() => setMenu(false)} />
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="flex items-center gap-2 sm:gap-3 h-16 px-4 sm:px-6 bg-surface border-b border-line shrink-0 no-print">
            <button aria-label="Open menu" className="lg:hidden p-2 -ml-2 text-ink" onClick={() => setMenu(true)}><Menu className="size-5" /></button>
            {isOwner ? <GlobalSearch /> : <div className="flex-1 font-semibold text-ink">Hello, {user.name.split(' ')[0]}</div>}
            {isOwner && <QuickAdd />}
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-[1240px] mx-auto p-4 sm:p-6">{children}</div>
          </main>
        </div>
      </div>
      <Toaster />
    </UserCtx.Provider>
  );
}
