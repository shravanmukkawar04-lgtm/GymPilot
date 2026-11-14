import { SignJWT, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { one } from '../db';

export type SessionUser = {
  id: number; name: string; email: string; role: string; staff_id: number | null;
  gym_id: number; gym_active: boolean;
  /** The user's own branch. Null for owners, who can see every branch. */
  home_branch_id: number | null;
  /** Active branches of the gym, in order. */
  branch_ids: number[];
  /** The branch this request works in. Null means all branches (owners only). */
  branch_id: number | null;
};

/**
 * Who can open what. To add a role later (for example receptionist),
 * add one line here. '*' means everything.
 */
export const PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  manager: ['dashboard', 'members', 'leads', 'trainers', 'attendance', 'pt', 'pt_manage', 'inventory', 'comms', 'billing', 'expenses', 'reports'],
  trainer: ['dashboard', 'pt'],
};

export function can(role: string, permission: string) {
  const list = PERMISSIONS[role] ?? [];
  return list.includes('*') || list.includes(permission);
}

const COOKIE = 'gp_session';
const BRANCH_COOKIE = 'gp_branch';
const MAX_AGE = 60 * 60 * 24 * 7;

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET must be set in .env (at least 16 characters)');
  return new TextEncoder().encode(s);
}

export async function sessionCookie(userId: number, req: NextRequest) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(String(userId))
    .setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${isHttps(req) ? '; Secure' : ''}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Remembers which branch an owner is looking at. 'all' = every branch. */
export function branchCookie(value: number | 'all', req: NextRequest) {
  return `${BRANCH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${isHttps(req) ? '; Secure' : ''}`;
}

function isHttps(req: NextRequest) {
  return (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')) === 'https';
}

export async function currentUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  let userId: number;
  try {
    const { payload } = await jwtVerify(token, secret());
    userId = Number(payload.sub);
  } catch (e: any) {
    if (e?.code?.startsWith?.('ERR_J')) return null;
    throw e;
  }
  // Read from the database so a deactivated account (or gym) loses access at once.
  const u = await one<any>(
    `SELECT u.id, u.name, u.email, u.role, u.staff_id, u.gym_id, g.active AS gym_active,
       COALESCE(u.branch_id, s.branch_id) AS home_branch_id,
       ARRAY(SELECT b.id FROM branches b WHERE b.gym_id = u.gym_id AND b.active ORDER BY b.id) AS branch_ids
     FROM users u JOIN gyms g ON g.id = u.gym_id LEFT JOIN staff s ON s.id = u.staff_id
     WHERE u.id = $1 AND u.active`, [userId]);
  if (!u) return null;
  return { ...u, branch_id: activeBranch(u, req.cookies.get(BRANCH_COOKIE)?.value) };
}

function activeBranch(u: Omit<SessionUser, 'branch_id'>, cookie: string | undefined): number | null {
  if (u.role !== 'owner') return u.home_branch_id ?? -1; // -1 matches nothing, so a misconfigured login sees no data
  if (cookie === 'all' && u.branch_ids.length > 1) return null;
  const chosen = Number(cookie);
  if (u.branch_ids.includes(chosen)) return chosen;
  return u.branch_ids[0] ?? -1;
}
