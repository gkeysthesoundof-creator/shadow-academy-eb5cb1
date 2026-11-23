/* Applies db/migrations/*.up.sql in order (or rolls back with `down [n]`).
   Usage: DATABASE_URL=... tsx scripts/migrate.ts [up|down [steps]|reset]
   Local Postgres: set BOOTSTRAP_SUPERUSER_URL once to create the anon/authenticated/service_role roles.
   Supabase: those roles already exist — leave BOOTSTRAP_SUPERUSER_URL unset. */
import { Client } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(__dirname, '..', 'db', 'migrations');
const url = process.env.DATABASE_URL ?? 'postgres://gsq_owner:dev-only-owner@127.0.0.1:5432/gsq';

export async function bootstrapRoles(superUrl: string, owner: string) {
  const c = new Client({ connectionString: superUrl });
  await c.connect();
  const sql = readFileSync(path.join(__dirname, '..', 'db', 'bootstrap-local.sql'), 'utf8')
    .replace(':"owner"', `"${owner.replace(/"/g, '')}"`);
  await c.query(sql);
  await c.end();
}

export async function migrate(connectionString: string, direction: 'up' | 'down' | 'reset' = 'up', steps = 1) {
  const c = new Client({ connectionString });
  await c.connect();
  await c.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const ups = readdirSync(dir).filter((f) => f.endsWith('.up.sql')).sort();
  const applied = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name));
  const log: string[] = [];
  if (direction === 'up') {
    for (const f of ups) {
      const name = f.replace('.up.sql', '');
      if (applied.has(name)) continue;
      await c.query('begin');
      try {
        await c.query(readFileSync(path.join(dir, f), 'utf8'));
        await c.query('insert into schema_migrations(name) values ($1)', [name]);
        await c.query('commit');
        log.push(`applied ${name}`);
      } catch (e) {
        await c.query('rollback');
        throw new Error(`migration ${name} failed: ${(e as Error).message}`);
      }
    }
  } else {
    const order = [...ups].reverse().map((f) => f.replace('.up.sql', '')).filter((n) => applied.has(n));
    const target = direction === 'reset' ? order : order.slice(0, steps);
    for (const name of target) {
      await c.query('begin');
      await c.query(readFileSync(path.join(dir, `${name}.down.sql`), 'utf8'));
      await c.query('delete from schema_migrations where name = $1', [name]);
      await c.query('commit');
      log.push(`reverted ${name}`);
    }
  }
  await c.end();
  return log;
}

if (require.main === module) {
  (async () => {
    const [cmd = 'up', n] = process.argv.slice(2);
    if (process.env.BOOTSTRAP_SUPERUSER_URL) {
      await bootstrapRoles(process.env.BOOTSTRAP_SUPERUSER_URL, new URL(url).username);
      console.log('roles bootstrapped');
    }
    const log = await migrate(url, cmd as 'up' | 'down' | 'reset', Number(n ?? 1));
    console.log(log.length ? log.join('\n') : 'nothing to do');
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
