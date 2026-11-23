import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { asService, type Tx } from '../db';
import { PLAN_CATALOG, type PlanId } from '../domain/plans';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  if (pw.length < 12) throw new Error('Password must be at least 12 characters');
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Always do the work, even for unknown users, to avoid timing oracles.
  const parts = (stored ?? 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(88)).split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const key = await scrypt(pw, salt, expected.length, { ...PARAMS, N: Number(parts[1]) });
  return stored !== null && key.length === expected.length && timingSafeEqual(key, expected);
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const SESSION_TTL_DAYS = 30;

export async function createSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  await asService((c) => c.query(
    'insert into sessions(user_id, token_hash, expires_at) values ($1,$2,$3)', [userId, sha256(token), expires]));
  await asService((c) => c.query('update users set last_login_at = now() where id = $1', [userId]));
  return { token, expires };
}

export interface SessionUser {
  id: string; email: string; display_name: string; status: string;
  is_admin: boolean; is_moderator: boolean;
}

export async function userForToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await asService((c) => c.query(
    `select u.id, u.email, u.display_name, u.status,
       exists(select 1 from membership_roles m join workspaces w on w.id = m.workspace_id
              where w.slug = 'platform' and m.user_id = u.id and m.role in ('owner','admin')) as is_admin,
       exists(select 1 from membership_roles m join workspaces w on w.id = m.workspace_id
              where w.slug = 'platform' and m.user_id = u.id and m.role in ('owner','admin','moderator')) as is_moderator
     from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.status = 'active'`,
    [sha256(token)]));
  return r.rows[0] ?? null;
}

export async function revokeSession(token: string | undefined) {
  if (!token) return;
  await asService((c) => c.query('update sessions set revoked_at = now() where token_hash = $1', [sha256(token)]));
}

function windowStartFor(windowSec: number) {
  return new Date(Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000);
}

/** Read-only check: has this key already reached `limit` in the current window? */
export async function rateLimited(key: string, limit: number, windowSec: number): Promise<boolean> {
  const r = await asService((c) => c.query(`select count from rate_limits where key = $1 and window_start = $2`, [sha256(key), windowStartFor(windowSec)]));
  return (r.rows[0]?.count ?? 0) >= limit;
}

/** Fixed-window limiter: max `limit` hits per `windowSec` for a key. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const windowStart = windowStartFor(windowSec);
  const r = await asService((c) => c.query(
    `insert into rate_limits(key, window_start, count) values ($1,$2,1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1
     returning count`, [sha256(key), windowStart]));
  return r.rows[0].count <= limit;
}

export async function authenticate(email: string, password: string): Promise<{ id: string } | null> {
  const r = await asService((c) => c.query(
    `select id, password_hash from users where email = $1 and status = 'active'`, [email.trim().toLowerCase()]));
  const row = r.rows[0];
  const ok = await verifyPassword(password, row?.password_hash ?? null);
  return ok && row ? { id: row.id } : null;
}

/**
 * Provision a complete, isolated account: personal workspace, Chapter 1 PS5
 * profile (spoiler shield on), device prefs, email OFF, plan + entitlements.
 */
export async function provisionUser(c: Tx, opts: {
  email: string; password?: string; displayName: string; role: 'owner' | 'admin' | 'moderator' | 'customer'; plan: PlanId;
}): Promise<string> {
  const hash = opts.password ? await hashPassword(opts.password) : null;
  const u = await c.query(
    `insert into users(email, display_name, password_hash) values ($1,$2,$3)
     on conflict (email) do update set display_name = excluded.display_name,
       password_hash = coalesce(excluded.password_hash, users.password_hash)
     returning id`, [opts.email.trim().toLowerCase(), opts.displayName, hash]);
  const id: string = u.rows[0].id;
  const ws = await c.query(
    `insert into workspaces(slug, name, kind) values ($1,$2,'personal')
     on conflict (slug) do update set name = excluded.name returning id`, [`u-${id}`, `${opts.displayName}'s HQ`]);
  await c.query(`insert into membership_roles(workspace_id,user_id,role) values ($1,$2,'owner') on conflict do nothing`, [ws.rows[0].id, id]);
  if (opts.role !== 'customer') {
    await c.query(
      `insert into membership_roles(workspace_id,user_id,role)
       select id, $1, $2 from workspaces where slug = 'platform'
       on conflict (workspace_id,user_id) do update set role = excluded.role`, [id, opts.role]);
  }
  await c.query(`insert into user_game_profiles(user_id, game_id) values ($1,'gta6') on conflict do nothing`, [id]);
  await c.query(`insert into user_progress(user_id, game_id) values ($1,'gta6') on conflict do nothing`, [id]);
  await c.query(`insert into player_device_preferences(user_id, other_devices) values ($1, $2) on conflict do nothing`,
    [id, opts.role === 'owner' ? ['Desktop', 'ROG Xbox Ally (PS5 Remote Play)'] : []]);
  await c.query(`insert into alert_preferences(user_id) values ($1) on conflict do nothing`, [id]);
  await c.query(`insert into privacy_consents(user_id, consent, granted) values ($1,'terms',true) on conflict do nothing`, [id]);
  const existingTasks = await c.query('select 1 from user_tasks where user_id = $1 limit 1', [id]);
  if (!existingTasks.rowCount) {
    const starters = ['Confirm my current chapter in Settings', 'Write down where I got stuck last session', 'Import my own copy of the Leonida map (personal use)'];
    for (const [i, t] of starters.entries()) {
      await c.query('insert into user_tasks(user_id, game_id, text, sort) values ($1,$2,$3,$4)', [id, 'gta6', t, i]);
    }
  }
  await setPlan(c, id, opts.plan, opts.plan === 'founder' ? 'grandfathered' : 'active');
  return id;
}

export async function setPlan(c: Tx, userId: string, plan: PlanId, status: 'grandfathered' | 'active' | 'trialing') {
  await c.query(`update subscriptions set status = 'canceled', updated_at = now()
                 where user_id = $1 and status in ('trialing','active','past_due','grandfathered') and plan_id <> $2`, [userId, plan]);
  await c.query(`insert into subscriptions(user_id, plan_id, status, provider, test_mode)
                 select $1, $2, $3, 'none', true
                 where not exists (select 1 from subscriptions where user_id = $1 and plan_id = $2 and status in ('trialing','active','past_due','grandfathered'))`,
    [userId, plan, status]);
  await c.query('delete from entitlements where user_id = $1 and source <> $2', [userId, 'grant']);
  for (const [feature, limit] of Object.entries(PLAN_CATALOG[plan].features)) {
    if (limit === false) continue;
    await c.query(`insert into entitlements(user_id, feature, limit_value, source) values ($1,$2,$3,$4)
                   on conflict (user_id, feature) do update set limit_value = excluded.limit_value, source = excluded.source, updated_at = now()`,
      [userId, feature, limit === true ? null : limit, plan === 'founder' ? 'founder' : 'plan']);
  }
}
