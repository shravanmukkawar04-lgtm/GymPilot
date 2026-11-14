import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { insert, one, q, update, widenToGym } from '../db';
import { bad, notFound, parse, route } from './router';
import * as s from './schemas';

const branchSchema = z.object({ name: s.reqText, address: s.text, phone: s.text, active: s.bool });

/** The branches this login can see, with a few numbers for each. Owners always see every branch here. */
route('GET', '/branches', 'any', async ({ user }) => {
  if (user.role === 'owner') await widenToGym();
  return q(`
  SELECT b.*,
    (SELECT count(*) FROM member_overview o WHERE o.branch_id=b.id AND NOT o.archived AND o.status='active') active_members,
    (SELECT count(*) FROM staff st WHERE st.branch_id=b.id AND st.active) staff,
    (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'active', u.active) ORDER BY u.id)
       FROM users u WHERE u.role='manager' AND u.branch_id=b.id) managers
  FROM branches b ORDER BY b.active DESC, b.id`);
});

// Managing branches works across the whole gym, whichever branch is chosen on screen.
route('POST', '/branches', 'settings', async ({ body, user }) => {
  await widenToGym();
  return insert('branches', { ...parse(branchSchema, body), gym_id: user.gym_id });
});

route('PUT', '/branches/:id', 'settings', async ({ params, body, user }) => {
  await widenToGym();
  const v = parse(branchSchema, body);
  if (v.active === false) {
    const { c } = (await one<{ c: number }>('SELECT count(*) c FROM branches WHERE active AND id<>$1', [params.id]))!;
    if (c === 0) throw bad('A gym needs at least one active branch');
  }
  const b = await update('branches', params.id, v);
  if (!b) throw notFound('Branch not found');
  // A closed branch's manager can no longer log in.
  if (v.active === false) await q(`UPDATE users SET active=false WHERE role='manager' AND branch_id=$1 AND gym_id=$2`, [b.id, user.gym_id]);
  return b;
});

/** A manager runs one branch: members, billing, staff and messages, but not gym settings or salaries. */
route('POST', '/branches/:id/managers', 'settings', async ({ params, body }) => {
  await widenToGym();
  const v = parse(z.object({ name: s.reqText, email: s.loginEmail, password: s.password }), body);
  const b = await one<any>('SELECT * FROM branches WHERE id=$1 AND active', [params.id]);
  if (!b) throw notFound('Branch not found');
  return one(`INSERT INTO users (name, email, password_hash, role, branch_id) VALUES ($1,$2,$3,'manager',$4) RETURNING id, name, email, active`,
    [v.name, v.email, await bcrypt.hash(v.password, 10), b.id]);
});

route('PUT', '/managers/:id', 'settings', async ({ params, body }) => {
  await widenToGym();
  const v = parse(z.object({ active: s.bool, password: s.password.nullish() }), body);
  const u = await one<any>(`SELECT * FROM users WHERE id=$1 AND role='manager'`, [params.id]);
  if (!u) throw notFound('Login not found');
  await q('UPDATE users SET active=COALESCE($2, active), password_hash=COALESCE($3, password_hash) WHERE id=$1',
    [u.id, v.active ?? null, v.password ? await bcrypt.hash(v.password, 10) : null]);
});
