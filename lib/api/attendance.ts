import { z } from 'zod';
import { asTenant, insert, one, q, tx, update } from '../db';
import { ApiError, bad, parse, route } from './router';
import * as s from './schemas';
import { linkEnrollment, manualCheck, processPunch, startEnrollment, syncAllToDevice } from '../services/attendance';
import { networkInterfaces } from 'node:os';

const deviceSchema = z.object({ name: s.reqText, serial_number: s.reqText, location: s.text, active: s.bool });

route('GET', '/attendance/today', 'attendance', async () => {
  const [members, staff, summary] = await Promise.all([
    q(`SELECT a.*, m.name, m.member_code, m.phone, o.plan_name, o.status member_status, o.valid_until, o.dues
       FROM attendance a JOIN members m ON m.id=a.member_id JOIN member_overview o ON o.id=m.id
       WHERE a.day=gym_today() ORDER BY a.check_in DESC`),
    q(`SELECT a.*, st.name, st.role_title FROM attendance a JOIN staff st ON st.id=a.staff_id WHERE a.day=gym_today() ORDER BY a.check_in DESC`),
    one(`SELECT
        (SELECT count(*) FROM attendance WHERE day=gym_today() AND member_id IS NOT NULL) members_today,
        (SELECT count(*) FROM attendance WHERE day=gym_today() AND member_id IS NOT NULL AND check_out IS NULL) inside_now,
        (SELECT count(*) FROM attendance WHERE day=gym_today() AND staff_id IS NOT NULL) staff_today,
        (SELECT count(*) FROM staff WHERE active) staff_total,
        (SELECT count(*) FROM attendance WHERE day=gym_today() AND NOT membership_ok) flagged_today,
        (SELECT count(DISTINCT device_user_id) FROM biometric_punches WHERE result='unknown') unmatched`),
  ]);
  return { members, staff, summary };
});

route('GET', '/attendance/history', 'attendance', async ({ query }) => {
  const from = query.get('from'); const to = query.get('to');
  const type = query.get('type') === 'staff' ? 'staff' : 'member';
  return type === 'staff'
    ? q(`SELECT a.*, st.name, st.role_title detail FROM attendance a JOIN staff st ON st.id=a.staff_id WHERE a.day BETWEEN $1 AND $2 ORDER BY a.day DESC, a.check_in DESC LIMIT 500`, [from, to])
    : q(`SELECT a.*, m.name, m.member_code detail FROM attendance a JOIN members m ON m.id=a.member_id WHERE a.day BETWEEN $1 AND $2 ORDER BY a.day DESC, a.check_in DESC LIMIT 500`, [from, to]);
});

route('POST', '/attendance/manual', 'attendance', async ({ body }) => {
  const v = parse(z.object({ member_id: s.idOpt, staff_id: s.idOpt }), body);
  return tx((db) => manualCheck(db, { member_id: v.member_id ?? null, staff_id: v.staff_id ?? null }));
});

route('GET', '/attendance/devices', 'attendance', async () => q(`
  SELECT d.*, (SELECT count(*) FROM biometric_punches p WHERE p.device_id=d.id AND p.punched_at > now() - interval '1 day') punches_24h
  FROM biometric_devices d ORDER BY d.id`));
route('POST', '/attendance/devices', 'attendance', async ({ body }) => insert('biometric_devices', parse(deviceSchema, body)));
route('PUT', '/attendance/devices/:id', 'attendance', async ({ params, body }) => update('biometric_devices', params.id, parse(deviceSchema, body)));
route('DELETE', '/attendance/devices/:id', 'attendance', async ({ params }) => { await q('DELETE FROM biometric_devices WHERE id=$1', [params.id]); });

/** The address to type into the machine. 'localhost' would point the machine at itself. */
route('GET', '/attendance/server-info', 'attendance', async ({ req }) => {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  const [hostname, port] = host.split(':');
  const local = hostname === 'localhost' || hostname.startsWith('127.');
  const lan = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i!.address);
  return { addresses: local ? lan : [hostname], port: port || (req.headers.get('x-forwarded-proto') === 'https' ? '443' : '80') };
});

route('POST', '/attendance/devices/:id/sync', 'attendance', async ({ params }) =>
  tx(async (db) => ({ queued: await syncAllToDevice(db, Number(params.id)) })));

route('POST', '/attendance/enroll', 'attendance', async ({ body }) => {
  const v = parse(z.object({ member_id: s.idOpt, staff_id: s.idOpt, device_id: s.idOpt }), body);
  if (!v.member_id === !v.staff_id) throw bad('Choose one person');
  return tx((db) => startEnrollment(db, { member_id: v.member_id ?? null, staff_id: v.staff_id ?? null }, v.device_id ?? undefined));
});

route('GET', '/attendance/machine-activity', 'attendance', async () => {
  const [scans, commands] = await Promise.all([
    q(`SELECT p.id, p.device_user_id, p.punched_at, p.result, COALESCE(m.name, st.name) AS person, d.name device
       FROM biometric_punches p LEFT JOIN biometric_enrollments e ON e.device_user_id=p.device_user_id
       LEFT JOIN members m ON m.id=e.member_id LEFT JOIN staff st ON st.id=e.staff_id LEFT JOIN biometric_devices d ON d.id=p.device_id
       ORDER BY p.punched_at DESC LIMIT 15`),
    q(`SELECT c.id, c.label, c.status, c.return_code, c.created_at, d.name device FROM device_commands c JOIN biometric_devices d ON d.id=c.device_id ORDER BY c.id DESC LIMIT 15`),
  ]);
  return { scans, commands };
});

route('GET', '/attendance/unmatched', 'attendance', async () => q(`
  SELECT device_user_id, count(*) scans, max(punched_at) last_scan FROM biometric_punches WHERE result='unknown' GROUP BY device_user_id ORDER BY max(punched_at) DESC`));

route('POST', '/attendance/link', 'attendance', async ({ body }) => {
  const v = parse(z.object({ device_user_id: s.reqText, member_id: s.idOpt, staff_id: s.idOpt }), body);
  if (!v.member_id === !v.staff_id) throw bad('Choose one person');
  return tx(async (db) => ({ replayed: await linkEnrollment(db, v.device_user_id, { member_id: v.member_id ?? null, staff_id: v.staff_id ?? null }) }));
});

route('GET', '/attendance/people', 'attendance', async ({ query }) => {
  const term = `%${query.get('q')?.trim() ?? ''}%`;
  return q(`(SELECT id, name, phone, 'member' AS type, status AS detail FROM member_overview WHERE NOT archived AND (name ILIKE $1 OR phone ILIKE $1 OR member_code ILIKE $1) ORDER BY name LIMIT 8)
            UNION ALL
            (SELECT id, name, phone, 'staff' AS type, role_title AS detail FROM staff WHERE active AND (name ILIKE $1 OR phone ILIKE $1) ORDER BY name LIMIT 4)`, [term]);
});

/**
 * For biometric devices or middleware other than ZKTeco ADMS.
 * POST /api/biometric/punch  header x-device-key  body { user_id, time?: 'YYYY-MM-DD HH:MM:SS' }
 * The response tells a gate or turnstile whether to allow entry.
 */
route('POST', '/biometric/punch', 'public', async ({ req, body }) => {
  const key = req.headers.get('x-device-key');
  // The key identifies the machine, and the machine identifies its gym and branch.
  const device = key ? await one<any>(
    `UPDATE biometric_devices d SET last_seen_at=now() FROM gyms g WHERE d.api_key=$1 AND d.active AND g.id=d.gym_id AND g.active RETURNING d.*`, [key]) : null;
  if (!device) throw new ApiError(401, 'Unknown device key');
  const v = parse(z.object({ user_id: z.union([z.string().trim().min(1), z.number().transform(String)]), time: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/, 'must be YYYY-MM-DD HH:MM:SS').nullish(), verify: s.text }), body);
  const localTime = v.time ?? (await one<{ t: string }>(`SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') t`))!.t;
  return asTenant(device.gym_id, device.branch_id, () =>
    tx((db) => processPunch(db, { device_id: device.id, device_user_id: v.user_id, localTime: localTime.replace('T', ' '), verify: v.verify })));
});
