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
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 20_000, // Neon can take a few seconds to wake from idle
    });
  }
  return g.__gymPool;
}

export type Db = Pick<PoolClient, 'query'>;

export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = pool()): Promise<T[]> {
  return (await db.query(sql, params as any[])).rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = pool()): Promise<T | null> {
  return (await q<T>(sql, params, db))[0] ?? null;
}

/** Columns come from validated schemas in code, never from raw user input. */
export async function insert<T = any>(table: string, data: Record<string, unknown>, db: Db = pool()): Promise<T> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => k).join(',');
  const marks = entries.map((_, i) => `$${i + 1}`).join(',');
  return (await one<T>(`INSERT INTO ${table} (${cols}) VALUES (${marks}) RETURNING *`, entries.map(([, v]) => v), db))!;
}

export async function update<T = any>(table: string, id: number | string, data: Record<string, unknown>, db: Db = pool()): Promise<T | null> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) return one<T>(`SELECT * FROM ${table} WHERE id=$1`, [id], db);
  const set = entries.map(([k], i) => `${k}=$${i + 2}`).join(',');
  return one<T>(`UPDATE ${table} SET ${set} WHERE id=$1 RETURNING *`, [id, ...entries.map(([, v]) => v)], db);
}

export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
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
