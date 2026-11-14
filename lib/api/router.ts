import { timingSafeEqual } from 'node:crypto';
import { z, ZodError, ZodTypeAny } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { asTenant } from '../db';
import { currentUser, SessionUser, can } from './session';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const bad = (m: string) => new ApiError(400, m);
export const notFound = (m = 'Not found') => new ApiError(404, m);

export type Ctx = {
  user: SessionUser;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  req: NextRequest;
  setCookie: (value: string) => void;
};
type Handler = (c: Ctx) => Promise<unknown>;
/**
 * 'public' = no login and no gym scope (the handler picks a gym itself if it needs one),
 * 'super'  = the hidden super admin, checked against SUPERADMIN_KEY,
 * 'any'    = any logged-in user, otherwise a permission key from session.ts.
 * Every logged-in route runs inside its gym and branch; see asTenant in lib/db.ts.
 */
type Access = 'public' | 'super' | 'any' | string;
type Route = { method: string; parts: string[]; access: Access; handler: Handler };

const routes: Route[] = [];

export function route(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, access: Access, handler: Handler) {
  routes.push({ method, parts: path.split('/').filter(Boolean), access, handler });
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data);
}

function match(r: Route, method: string, path: string[]) {
  if (r.method !== method || r.parts.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < path.length; i++) {
    if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(path[i]);
    else if (r.parts[i] !== path[i]) return null;
  }
  return params;
}

/** Form inputs send '' for blank fields; the database should see NULL. */
function blankToNull(v: any): any {
  if (v === '') return null;
  if (Array.isArray(v)) return v.map(blankToNull);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankToNull(x)]));
  return v;
}

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try { return new URL(origin).host === host; } catch { return false; }
}

/* ---------- Super admin key ---------- */

const superFails = new Map<string, { count: number; until: number }>();

function superAllowed(req: NextRequest) {
  const expected = process.env.SUPERADMIN_KEY ?? '';
  const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  const f = superFails.get(ip);
  if (f && f.until > Date.now() && f.count >= 10) return false;
  const given = req.headers.get('x-super-key') ?? '';
  const ok = expected.length >= 24 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    if (!f || f.until < Date.now()) superFails.set(ip, { count: 1, until: Date.now() + 15 * 60_000 });
    else f.count++;
  }
  return ok;
}

export async function dispatch(req: NextRequest, path: string[]) {
  const method = req.method;
  let params: Record<string, string> | null = null;
  // Static routes take priority over ':id' routes of the same shape.
  const candidates = routes.filter((r) => match(r, method, path));
  const r = candidates.find((x) => !x.parts.some((p) => p.startsWith(':'))) ?? candidates[0];
  if (r) params = match(r, method, path);
  if (!r || !params) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let cookie: string | null = null;
  try {
    if (method !== 'GET' && !sameOrigin(req)) throw new ApiError(403, 'Request blocked');
    // A wrong key looks exactly like a page that does not exist.
    if (r.access === 'super' && !superAllowed(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const user = r.access === 'super' ? null : await currentUser(req);
    const scoped = r.access !== 'public' && r.access !== 'super';
    if (scoped) {
      if (!user) throw new ApiError(401, 'Please log in');
      if (!user.gym_active) throw new ApiError(403, 'This gym account is paused. Please contact GymPilot support.');
      if (r.access !== 'any' && !can(user.role, r.access)) throw new ApiError(403, 'You do not have access to this section');
      if (user.branch_id === -1) throw new ApiError(403, 'Your login is not linked to an active branch. Ask the gym owner to check it.');
    }
    let body: any = undefined;
    if (method !== 'GET' && (req.headers.get('content-type') || '').includes('application/json')) {
      body = blankToNull(await req.json().catch(() => ({})));
    }
    const run = () => r.handler({
      user: user as SessionUser, params: params!, query: req.nextUrl.searchParams, body: body ?? {}, req,
      setCookie: (v) => { cookie = v; },
    });
    const data = scoped ? await asTenant(user!.gym_id, user!.branch_id, run) : await run();
    if (data instanceof Response) return data;
    const res = NextResponse.json(data ?? { ok: true });
    if (cookie) res.headers.append('Set-Cookie', cookie);
    return res;
  } catch (e: any) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ZodError) {
      const i = e.issues[0];
      const field = String(i.path[i.path.length - 1] ?? 'value').replace(/_/g, ' ');
      const msg = i.message === 'Required' || i.code === 'invalid_type' ? `Please fill in: ${field}` : `${field}: ${i.message}`;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (e?.code === 'P0001') return NextResponse.json({ error: e.message }, { status: 400 }); // raised by the database with a readable message
    if (e?.code === '23505') return NextResponse.json({ error: 'That value is already in use. Please use a different one.' }, { status: 409 });
    if (e?.code === '23503') return NextResponse.json({ error: 'This record is linked to other records and cannot be changed that way.' }, { status: 409 });
    if (e?.code === '42501') return NextResponse.json({ error: 'That record belongs to another branch or gym.' }, { status: 403 });
    console.error(`[api] ${method} /${path.join('/')}`, e);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
