import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, q } from '../db';
import { notFound, parse, route } from './router';
import * as s from './schemas';
import { createGym } from '../services/gyms';

/**
 * The hidden super admin, for whoever runs GymPilot as a service.
 * Every route needs the x-super-key header to match SUPERADMIN_KEY (24+ characters);
 * otherwise it answers 404, as if it did not exist. These queries see every gym.
 */

route('GET', '/super/gyms', 'super', async () => q(`
  SELECT g.id, g.active, g.notes, g.created_at, s.gym_name, s.phone, s.email,
    (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'active', u.active) ORDER BY u.id)
       FROM users u WHERE u.gym_id=g.id AND u.role='owner') owners,
    (SELECT count(*) FROM branches b WHERE b.gym_id=g.id AND b.active) branches,
    (SELECT count(*) FROM members m WHERE m.gym_id=g.id AND NOT m.archived) members,
    (SELECT max(created_at) FROM invoices i WHERE i.gym_id=g.id) last_bill,
    (SELECT extract(epoch FROM updated_at)::bigint FROM photos p WHERE p.gym_id=g.id AND p.kind='gym' AND p.ref_id=g.id) photo_v
  FROM gyms g LEFT JOIN settings s ON s.gym_id=g.id
  ORDER BY g.id DESC`));

route('POST', '/super/gyms', 'super', async ({ body }) => {
  const v = parse(z.object({
    gym_name: s.reqText, branch_name: s.text, address: s.text, phone: s.text, notes: s.text,
    owner_name: s.reqText, email: s.loginEmail, password: s.password,
    gym_photo: s.photo, owner_photo: s.photo,
  }), body);
  return createGym({ ...v, branch_name: v.branch_name || 'Main branch' });
});

/** Pausing a gym logs its people out at once and stops its machines and reminders. Nothing is deleted. */
route('POST', '/super/gyms/:id/active', 'super', async ({ params, body }) => {
  const g = await one('UPDATE gyms SET active=$2 WHERE id=$1 RETURNING id, active', [params.id, body.active !== false]);
  if (!g) throw notFound('Gym not found');
  return g;
});

route('POST', '/super/users/:id/password', 'super', async ({ params, body }) => {
  const v = parse(z.object({ password: s.password }), body);
  const u = await one(`UPDATE users SET password_hash=$2, active=true WHERE id=$1 AND role='owner' RETURNING id`, [params.id, await bcrypt.hash(v.password, 10)]);
  if (!u) throw notFound('Owner not found');
});

route('POST', '/super/gyms/:id/owners', 'super', async ({ params, body }) => {
  const v = parse(z.object({ name: s.reqText, email: s.loginEmail, password: s.password }), body);
  const g = await one('SELECT id FROM gyms WHERE id=$1', [params.id]);
  if (!g) throw notFound('Gym not found');
  return one(`INSERT INTO users (gym_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'owner') RETURNING id`, [g.id, v.name, v.email, await bcrypt.hash(v.password, 10)]);
});

route('GET', '/super/gyms/:id/photo', 'super', async ({ params }) => {
  // Outside a gym scope the owner connection sees every photo, so look up this gym's directly.
  const row = await one<{ mime: string; data: Buffer }>(`SELECT mime, data FROM photos WHERE kind='gym' AND ref_id=$1 AND gym_id=$1`, [params.id]);
  if (!row) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(row.data), { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600' } });
});
