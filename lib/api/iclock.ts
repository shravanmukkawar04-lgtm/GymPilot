import { NextRequest } from 'next/server';
import { asTenant, one, q, tx } from '../db';
import { processPunch } from '../services/attendance';

/** ZKTeco "ADMS / PUSH" protocol: the device calls these URLs on its own. */

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

/**
 * Finds the machine by serial number across all gyms (serial numbers are unique site-wide),
 * then does the work inside that machine's gym and branch only.
 */
async function withDevice(req: NextRequest, fn: (d: any) => Promise<Response>) {
  const sn = req.nextUrl.searchParams.get('SN');
  if (!sn) return text('Unknown device', 403);
  const d = await one<any>(
    `UPDATE biometric_devices d SET last_seen_at=now() FROM gyms g
     WHERE d.serial_number=$1 AND d.active AND g.id=d.gym_id AND g.active RETURNING d.*`, [sn]);
  if (!d) return text('Unknown device', 403);
  return asTenant(d.gym_id, d.branch_id, () => fn(d));
}

/** Device start-up handshake. */
export const handshake = (req: NextRequest) => withDevice(req, async (d) => text([
  `GET OPTION FROM: ${d.serial_number}`, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=9999',
  'ErrorDelay=30', 'Delay=10', 'TransTimes=', 'TransInterval=1', 'TransFlag=TransData AttLog', 'Realtime=1', 'Encrypt=None',
].join('\r\n') + '\r\n'));

/** Scan upload. Each line: PIN <tab> YYYY-MM-DD HH:MM:SS <tab> status <tab> verify ... */
export const upload = (req: NextRequest) => withDevice(req, async (d) => {
  const raw = await req.text();
  if (req.nextUrl.searchParams.get('table') !== 'ATTLOG') return text('OK');
  let count = 0;
  for (const line of raw.split(/\r?\n/)) {
    const [pin, time, , verify] = line.split('\t');
    if (!pin?.trim() || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time?.trim() ?? '')) continue;
    await tx((db) => processPunch(db, { device_id: d.id, device_user_id: pin.trim(), localTime: time.trim(), verify: verify?.trim() }));
    count++;
  }
  return text(`OK: ${count}`);
});

/** Device polling for work. Each line is C:<id>:<command>. */
export const poll = (req: NextRequest) => withDevice(req, async (d) => {
  const rows = await q<{ id: number; command: string }>(
    `UPDATE device_commands SET status='sent', sent_at=now() WHERE id IN (
       SELECT id FROM device_commands WHERE device_id=$1 AND status='pending' ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED
     ) RETURNING id, command`, [d.id]);
  if (!rows.length) return text('OK');
  return text(rows.sort((a, b) => a.id - b.id).map((r) => `C:${r.id}:${r.command}`).join('\n') + '\n');
});

/** Device reports the result of commands. Each line: ID=<id>&Return=<code>&CMD=<name> */
export const commandResult = (req: NextRequest) => withDevice(req, async (d) => {
  for (const line of (await req.text()).split(/\r?\n/)) {
    const p = new URLSearchParams(line.trim());
    const id = p.get('ID');
    const code = p.get('Return');
    if (!id || !/^\d+$/.test(id) || code === null) continue;
    await q(`UPDATE device_commands SET status=$3, return_code=$4, done_at=now() WHERE id=$1 AND device_id=$2`, [id, d.id, code === '0' ? 'done' : 'failed', code]);
  }
  return text('OK');
});
