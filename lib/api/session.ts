import { SignJWT, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { one } from '../db';

export type SessionUser = { id: number; name: string; email: string; role: string; staff_id: number | null };

/**
 * Who can open what. To add a role later (for example receptionist),
 * add one line here. '*' means everything.
 */
export const PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  trainer: ['dashboard', 'pt'],
};

export function can(role: string, permission: string) {
  const list = PERMISSIONS[role] ?? [];
  return list.includes('*') || list.includes(permission);
}

const COOKIE = 'gp_session';
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

function isHttps(req: NextRequest) {
  return (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')) === 'https';
}

export async function currentUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    // Read from the database so a deactivated account loses access at once.
    return await one<SessionUser>('SELECT id, name, email, role, staff_id FROM users WHERE id=$1 AND active', [Number(payload.sub)]);
  } catch (e: any) {
    if (e?.code?.startsWith?.('ERR_J')) return null;
    throw e;
  }
}
