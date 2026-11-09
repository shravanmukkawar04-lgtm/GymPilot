import { Db, one, q } from '../db';
import { bad } from '../api/router';

const MIN_GAP_MINUTES = 2; // A second scan within this window is an accidental double scan.

type Person = { member_id: number | null; staff_id: number | null };

/** Records one scan: the first of the day is check-in, later ones move check-out. */
async function applyPunch(db: Db, person: Person, at: Date, source: 'biometric' | 'manual') {
  const day = (await one<{ d: string }>(`SELECT ($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date d`, [at], db))!.d;
  const column = person.member_id ? 'member_id' : 'staff_id';
  const id = person.member_id ?? person.staff_id;
  const membershipOk = person.member_id ? (await one<{ ok: boolean }>('SELECT membership_valid($1,$2) ok', [person.member_id, day], db))!.ok : true;

  const existing = await one<any>(`SELECT * FROM attendance WHERE ${column}=$1 AND day=$2 FOR UPDATE`, [id, day], db);
  if (!existing) {
    await db.query(`INSERT INTO attendance (${column}, day, check_in, source, membership_ok) VALUES ($1,$2,$3,$4,$5)`, [id, day, at, source, membershipOk]);
    return { result: 'in' as const, membershipOk };
  }
  const checkIn = new Date(existing.check_in);
  if (at < checkIn) {
    // Device uploaded an older scan late.
    await db.query('UPDATE attendance SET check_in=$2, check_out=COALESCE(check_out,$3) WHERE id=$1', [existing.id, at, checkIn]);
    return { result: 'in' as const, membershipOk };
  }
  if (at.getTime() - checkIn.getTime() < MIN_GAP_MINUTES * 60_000) return { result: 'ignored' as const, membershipOk };
  await db.query('UPDATE attendance SET check_out=GREATEST(check_out,$2) WHERE id=$1', [existing.id, at]);
  return { result: 'out' as const, membershipOk };
}

/** localTime is 'YYYY-MM-DD HH:MM:SS' on the gym's clock, as devices report it. */
export async function processPunch(db: Db, p: { device_id: number; device_user_id: string; localTime: string; verify?: string | null }) {
  const row = await one<{ id: number; punched_at: Date }>(
    `INSERT INTO biometric_punches (device_id, device_user_id, punched_at, verify_type)
     VALUES ($1,$2,$3::timestamp AT TIME ZONE 'Asia/Kolkata',$4)
     ON CONFLICT (device_id, device_user_id, punched_at) DO NOTHING RETURNING id, punched_at`,
    [p.device_id, p.device_user_id, p.localTime, p.verify ?? null], db);
  if (!row) return { result: 'duplicate' as const, allowed: true, name: null as string | null }; // devices re-send on reconnect

  const person = await one<Person>('SELECT member_id, staff_id FROM biometric_enrollments WHERE device_user_id=$1', [p.device_user_id], db);
  if (!person) return { result: 'unknown' as const, allowed: false, name: null };
  const applied = await applyPunch(db, person, row.punched_at, 'biometric');
  await db.query('UPDATE biometric_punches SET result=$2 WHERE id=$1', [row.id, applied.result]);
  const who = person.member_id
    ? await one<{ name: string }>('SELECT name FROM members WHERE id=$1', [person.member_id], db)
    : await one<{ name: string }>('SELECT name FROM staff WHERE id=$1', [person.staff_id], db);
  return { result: applied.result, allowed: applied.membershipOk, name: who?.name ?? null };
}

export async function manualCheck(db: Db, person: Person) {
  if (!person.member_id === !person.staff_id) throw bad('Choose one person');
  const column = person.member_id ? 'member_id' : 'staff_id';
  const row = await one<any>(`SELECT check_out FROM attendance WHERE ${column}=$1 AND day=gym_today()`, [person.member_id ?? person.staff_id], db);
  if (row?.check_out) throw bad('Already checked in and out today');
  const applied = await applyPunch(db, person, new Date(), 'manual');
  if (applied.result === 'ignored') throw bad('Just checked in. Wait a couple of minutes before checking out.');
  return applied;
}

/** After an unknown fingerprint number is linked to someone, replay its stored scans. */
export async function linkEnrollment(db: Db, deviceUserId: string, person: Person) {
  await db.query('INSERT INTO biometric_enrollments (device_user_id, member_id, staff_id) VALUES ($1,$2,$3)', [deviceUserId, person.member_id, person.staff_id]);
  const pending = await q<{ id: number; punched_at: Date }>(`SELECT id, punched_at FROM biometric_punches WHERE device_user_id=$1 AND result='unknown' ORDER BY punched_at`, [deviceUserId], db);
  for (const p of pending) {
    const applied = await applyPunch(db, person, new Date(p.punched_at), 'biometric');
    await db.query('UPDATE biometric_punches SET result=$2 WHERE id=$1', [p.id, applied.result]);
  }
  return pending.length;
}

/** Sets a person's fingerprint number. A blank value removes the link. */
export async function setBiometricId(db: Db, person: Person, deviceUserId: string | null | undefined) {
  if (deviceUserId === undefined) return;
  const column = person.member_id ? 'member_id' : 'staff_id';
  const id = person.member_id ?? person.staff_id;
  const current = await one<{ device_user_id: string }>(`SELECT device_user_id FROM biometric_enrollments WHERE ${column}=$1`, [id], db);
  const next = deviceUserId === null ? null : String(deviceUserId).trim();
  if ((current?.device_user_id ?? null) === next) return;
  if (current) await db.query('DELETE FROM biometric_enrollments WHERE device_user_id=$1', [current.device_user_id]);
  if (next) {
    await linkEnrollment(db, next, person);
    const who = await one<{ name: string }>(`SELECT name FROM ${person.member_id ? 'members' : 'staff'} WHERE id=$1`, [id], db);
    await pushUser(db, next, who?.name ?? '');
  }
}

/* ---------- Commands the machine collects on its next check-in ---------- */

const cleanName = (s: string) => s.replace(/[\t\r\n]/g, ' ').trim().slice(0, 24);

/** A repeat click replaces the waiting command instead of queueing it twice. */
async function queueCommand(db: Db, deviceId: number, command: string, label: string) {
  await db.query(`DELETE FROM device_commands WHERE device_id=$1 AND command=$2 AND status='pending'`, [deviceId, command]);
  await db.query(`INSERT INTO device_commands (device_id, command, label) VALUES ($1,$2,$3)`, [deviceId, command, label]);
}

async function activeDevices(db: Db, deviceId?: number) {
  return q<{ id: number }>(`SELECT id FROM biometric_devices WHERE active ${deviceId ? 'AND id=$1' : ''} ORDER BY id`, deviceId ? [deviceId] : [], db);
}

/** Only number and name are sent, so a card or admin setting already on the machine is left alone. */
export async function pushUser(db: Db, pin: string, name: string, deviceId?: number) {
  const clean = cleanName(name);
  for (const d of await activeDevices(db, deviceId)) {
    await queueCommand(db, d.id, `DATA UPDATE USERINFO PIN=${pin}\tName=${clean}`, `Add ${clean} (${pin})`);
  }
}

export async function syncAllToDevice(db: Db, deviceId: number) {
  const people = await q<{ pin: string; name: string }>(
    `SELECT e.device_user_id pin, COALESCE(m.name, s.name) AS name FROM biometric_enrollments e
     LEFT JOIN members m ON m.id=e.member_id LEFT JOIN staff s ON s.id=e.staff_id
     WHERE (m.id IS NOT NULL AND NOT m.archived) OR (s.id IS NOT NULL AND s.active)`, [], db);
  for (const p of people) await pushUser(db, p.pin, p.name, deviceId);
  return people.length;
}

/** Gives the person a number if needed, adds them to the machine and starts fingerprint capture. */
export async function startEnrollment(db: Db, person: Person, deviceId?: number) {
  const devices = await activeDevices(db, deviceId);
  if (!devices.length) throw bad('Add your fingerprint machine first (Attendance, Machines tab)');
  const column = person.member_id ? 'member_id' : 'staff_id';
  const id = person.member_id ?? person.staff_id;
  const who = await one<{ name: string }>(`SELECT name FROM ${person.member_id ? 'members' : 'staff'} WHERE id=$1`, [id], db);
  if (!who) throw bad('Person not found');

  let pin = (await one<{ device_user_id: string }>(`SELECT device_user_id FROM biometric_enrollments WHERE ${column}=$1`, [id], db))?.device_user_id;
  if (!pin) {
    // Starts above 1000 and above every number seen so far, to avoid clashing with users already on the machine.
    const { n } = (await one<{ n: number }>(
      `SELECT GREATEST(1000, COALESCE(max(x.v), 0)) + 1 AS n FROM (
         SELECT CASE WHEN device_user_id ~ '^\\d{1,9}$' THEN device_user_id::bigint END v FROM biometric_enrollments
         UNION ALL SELECT CASE WHEN device_user_id ~ '^\\d{1,9}$' THEN device_user_id::bigint END FROM biometric_punches
       ) x`, [], db))!;
    pin = String(n);
    await linkEnrollment(db, pin, person);
  }
  const target = devices[0].id;
  await pushUser(db, pin, who.name, target);
  await queueCommand(db, target, `ENROLL_FP PIN=${pin}\tFID=0\tRETRY=3\tOVERWRITE=1`, `Register finger: ${cleanName(who.name)} (${pin})`);
  return { pin, name: who.name };
}
