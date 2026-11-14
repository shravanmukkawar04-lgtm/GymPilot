import bcrypt from 'bcryptjs';
import { one, tx } from '../db';
import { savePhoto } from './photos';

export type NewGym = {
  gym_name: string; branch_name: string; address?: string | null; phone?: string | null;
  owner_name: string; email: string; password: string;
  gym_photo?: string | null; owner_photo?: string | null; notes?: string | null;
};

/** Creates a gym with its first branch, its settings and templates, and the owner's login. Runs as the table owner. */
export async function createGym(v: NewGym) {
  const hash = await bcrypt.hash(v.password, 10);
  return tx(async (db) => {
    const gym = (await one<{ id: number }>('INSERT INTO gyms (notes) VALUES ($1) RETURNING id', [v.notes ?? null], db))!;
    await db.query(`SELECT set_config('app.gym_id', $1, true)`, [String(gym.id)]); // column defaults read this
    await db.query('SELECT gym_defaults($1)', [gym.id]);
    await db.query('UPDATE settings SET gym_name=$2, address=$3, phone=$4, email=$5 WHERE id=$1', [gym.id, v.gym_name, v.address ?? null, v.phone ?? null, v.email]);
    const branch = (await one<{ id: number }>('INSERT INTO branches (gym_id, name, address, phone) VALUES ($1,$2,$3,$4) RETURNING id',
      [gym.id, v.branch_name, v.address ?? null, v.phone ?? null], db))!;
    const owner = (await one<{ id: number }>(`INSERT INTO users (gym_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'owner') RETURNING id`,
      [gym.id, v.owner_name, v.email, hash], db))!;
    await savePhoto(db, 'gym', gym.id, v.gym_photo || undefined, gym.id);
    await savePhoto(db, 'user', owner.id, v.owner_photo || undefined, gym.id);
    return { gym_id: gym.id, branch_id: branch.id, owner_id: owner.id };
  });
}
