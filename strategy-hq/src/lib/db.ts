import { Pool, type PoolClient } from 'pg';
import { config } from './config';

/**
 * Database access. The pool connects as the schema owner, but EVERY query runs
 * inside a transaction that first drops privileges to `authenticated` (with the
 * user's id as the JWT subject) or `service_role` (scheduled workers). Row-level
 * security therefore protects data even if application code has a bug.
 */
const globalForPool = globalThis as unknown as { __gsqPool?: Pool };

export function pool(): Pool {
  if (!globalForPool.__gsqPool) {
    globalForPool.__gsqPool = new Pool({ connectionString: config.databaseUrl, max: 8, idleTimeoutMillis: 10_000 });
  }
  return globalForPool.__gsqPool;
}

export type Tx = PoolClient;

async function inTx<T>(setup: (c: PoolClient) => Promise<void>, fn: (c: Tx) => Promise<T>, p: Pool = pool()): Promise<T> {
  const client = await p.connect();
  try {
    await client.query('begin');
    await setup(client);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Run as a signed-in user. RLS enforces isolation. */
export function asUser<T>(userId: string, fn: (c: Tx) => Promise<T>, p?: Pool): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('invalid user id');
  return inTx(async (c) => {
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  }, fn, p);
}

/** Run as the trusted backend (scheduled workers, auth bookkeeping, webhooks). */
export function asService<T>(fn: (c: Tx) => Promise<T>, p?: Pool): Promise<T> {
  return inTx(async (c) => { await c.query('set local role service_role'); }, fn, p);
}

/** Run with no identity at all (anon). */
export function asAnon<T>(fn: (c: Tx) => Promise<T>, p?: Pool): Promise<T> {
  return inTx(async (c) => { await c.query('set local role anon'); }, fn, p);
}

/**
 * Run thunks one after another on the same transaction client. A pg client can
 * only execute one query at a time; Promise.all on one client is deprecated.
 */
export async function inOrder<T extends readonly (() => Promise<unknown>)[]>(fns: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
