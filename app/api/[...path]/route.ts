import { NextRequest } from 'next/server';
import { dispatch } from '@/lib/api/router';
import '@/lib/api/overview';
import '@/lib/api/members';
import '@/lib/api/staff';
import '@/lib/api/pt';
import '@/lib/api/inventory';
import '@/lib/api/attendance';
import '@/lib/api/payroll';
import '@/lib/api/finance';
import '@/lib/api/leads';
import '@/lib/api/comms';
import '@/lib/api/branches';
import '@/lib/api/super';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };
const handle = async (req: NextRequest, ctx: Ctx) => dispatch(req, (await ctx.params).path);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
