import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient, types } from 'pg';

// Dates stay as 'YYYY-MM-DD' strings so they never shift across time zones.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));

const g = globalThis as unknown as { __gymPool?: Pool };

export function pool(): Pool {
  if (!g.__gymPool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Add your Neon connection string to .env');
    g.__gymPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 20_000, // Neon can take a few seconds to wake from idle
    });
  }
  return g.__gymPool;
}

export type Db = Pick<PoolClient, 'query'>;

/* ---------- Tenant scope ----------
 * Inside asTenant(), every query in the same async call chain runs on one connection,
 * inside one transaction, as the gympilot_tenant role with the gym and branch set.
 * The database's row-level security then hides every other gym (and other branches).
 * Outside asTenant(), queries run as the table owner and see everything; only
 * login, the super admin and machine/webhook lookups do that.
 */
type Scope = { client: PoolClient; db: Db; gymId: number; branchId: number | null; savepoints: number };
const als = new AsyncLocalStorage<Scope>();

export const tenant = () => {
  const s = als.getStore();
  return s ? { gymId: s.gymId, branchId: s.branchId } : null;
};

const current = (): Db => als.getStore()?.db ?? pool();

/** One connection runs one query at a time, so queries started together (Promise.all) wait their turn. */
function serial(client: PoolClient): Db {
  let last: Promise<unknown> = Promise.resolve();
  const query = (...args: unknown[]) => {
    const run = last.then(() => (client.query as (...a: unknown[]) => Promise<unknown>)(...args));
    last = run.catch(() => {});
    return run;
  };
  return { query } as unknown as Db;
}

export async function asTenant<T>(gymId: number, branchId: number | null, fn: () => Promise<T>): Promise<T> {
  if (als.getStore()) throw new Error('asTenant cannot be nested');
  if (!Number.isInteger(gymId) || gymId <= 0 || (branchId !== null && (!Number.isInteger(branchId) || branchId <= 0))) throw new Error('Invalid tenant');
  const client = await pool().connect();
  try {
    // Values are checked integers above, so they are safe to place in the SQL text.
    await client.query(`BEGIN; SET LOCAL ROLE gympilot_tenant; SELECT set_config('app.gym_id','${gymId}',true), set_config('app.branch_id','${branchId ?? ''}',true)`);
    const result = await als.run({ client, db: serial(client), gymId, branchId, savepoints: 0 }, fn);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * For the rest of this request, see every branch of the gym (still never another gym).
 * Only for owner-level actions such as managing branches; callers check the role first.
 */
export async function widenToGym() {
  const s = als.getStore();
  if (!s) throw new Error('widenToGym needs a tenant scope');
  await s.db.query(`SELECT set_config('app.branch_id', '', true)`);
  s.branchId = null;
}

export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = current()): Promise<T[]> {
  return (await db.query(sql, params as any[])).rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = current()): Promise<T | null> {
  return (await q<T>(sql, params, db))[0] ?? null;
}

/** Columns come from validated schemas in code, never from raw user input. */
export async function insert<T = any>(table: string, data: Record<string, unknown>, db: Db = current()): Promise<T> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => k).join(',');
  const marks = entries.map((_, i) => `$${i + 1}`).join(',');
  return (await one<T>(`INSERT INTO ${table} (${cols}) VALUES (${marks}) RETURNING *`, entries.map(([, v]) => v), db))!;
}

export async function update<T = any>(table: string, id: number | string, data: Record<string, unknown>, db: Db = current()): Promise<T | null> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) return one<T>(`SELECT * FROM ${table} WHERE id=$1`, [id], db);
  const set = entries.map(([k], i) => `${k}=$${i + 2}`).join(',');
  return one<T>(`UPDATE ${table} SET ${set} WHERE id=$1 RETURNING *`, [id, ...entries.map(([, v]) => v)], db);
}

/**
 * All-or-nothing block. Inside a tenant scope it is a savepoint in the request's
 * transaction, so a failure undoes only this block. Do not run two at once with Promise.all.
 */
export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const s = als.getStore();
  if (s) {
    const name = `sp${++s.savepoints}`;
    await s.db.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn(s.db);
      await s.db.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (e) {
      await s.db.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
      throw e;
    }
  }
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
