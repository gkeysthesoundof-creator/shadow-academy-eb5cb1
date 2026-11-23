import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asUser, asAnon, asService, pool } from '@/lib/db';
import { resetDb, makeUser, makeFinding } from './helpers';

let A: string, B: string, OWNER: string;
let ch1: string, ch5: string;

beforeAll(async () => {
  await resetDb();
  A = await makeUser('alice', 'customer', 1);
  B = await makeUser('bob', 'customer', 5);
  OWNER = await makeUser('owner', 'owner', 1);
  ch1 = await makeFinding({ title: 'FIXTURE ch1 car', chapter_min: 1 });
  ch5 = await makeFinding({ title: 'FIXTURE ch5 story reveal', chapter_min: 5 });
  await asUser(B, async (c) => {
    await c.query(`update user_progress set notes = 'bob private note' where user_id = $1`, [B]);
    await c.query(`insert into user_tasks(user_id, game_id, text) values ($1,'gta6','bob secret task')`, [B]);
    await c.query(`insert into user_private_pins(user_id, game_id, x, y, label) values ($1,'gta6',0.5,0.5,'bob pin')`, [B]);
    await c.query(`insert into user_hunts(user_id, finding_id, status) values ($1,$2,'found')`, [B, ch5]);
    await c.query(`insert into user_screenshots(user_id, storage_key, mime, bytes, sha256) values ($1,'k/bob.png','image/png',10,'x')`, [B]);
    await c.query(`insert into user_cash_entries(user_id, game_id, amount, label) values ($1,'gta6',5000,'bob cash')`, [B]);
  });
});
afterAll(async () => { await pool().end(); });

describe('account isolation (RLS)', () => {
  it('A cannot read any of B private rows', async () => {
    await asUser(A, async (c) => {
      for (const t of ['user_tasks', 'user_private_pins', 'user_hunts', 'user_screenshots', 'user_cash_entries', 'subscriptions', 'entitlements']) {
        const r = await c.query(`select count(*)::int n from ${t} where user_id = $1`, [B]);
        expect(r.rows[0].n, t).toBe(0);
      }
      const notes = await c.query(`select notes from user_progress where user_id = $1`, [B]);
      expect(notes.rowCount).toBe(0);
      const users = await c.query(`select email from users`);
      expect(users.rows.map((r) => r.email)).toEqual(['alice@test.local']);
    });
  });
  it('A cannot write rows into B account', async () => {
    await expect(asUser(A, (c) => c.query(`insert into user_tasks(user_id, game_id, text) values ($1,'gta6','x')`, [B]))).rejects.toThrow(/row-level security/);
    const r = await asUser(A, (c) => c.query(`update user_progress set notes = 'hacked' where user_id = $1`, [B]));
    expect(r.rowCount).toBe(0);
    const del = await asUser(A, (c) => c.query(`delete from user_private_pins where user_id = $1`, [B]));
    expect(del.rowCount).toBe(0);
  });
  it('anon sees no private data and no users', async () => {
    await expect(asAnon((c) => c.query('select * from user_tasks'))).rejects.toThrow(/permission denied/);
    await expect(asAnon((c) => c.query('select * from users'))).rejects.toThrow(/permission denied/);
    await expect(asAnon((c) => c.query('select * from findings'))).rejects.toThrow(/permission denied/);
  });
});

describe('chapter spoiler gate enforced by the database', () => {
  it('Chapter 1 user never receives a Chapter 5 finding, its evidence, or its title', async () => {
    await asUser(A, async (c) => {
      const ids = (await c.query('select id, title from findings')).rows;
      expect(ids.map((r) => r.id)).toContain(ch1);
      expect(ids.map((r) => r.id)).not.toContain(ch5);
      expect(JSON.stringify(ids)).not.toContain('ch5 story reveal');
      const ev = await c.query('select * from evidence where finding_id = $1', [ch5]);
      expect(ev.rowCount).toBe(0);
      const links = await c.query('select * from scout_finding_links where finding_id = $1', [ch5]);
      expect(links.rowCount).toBe(0);
      const locked = await c.query(`select * from locked_future_counts('gta6')`);
      expect(locked.rows).toEqual([{ scout_id: 'vehicle_scout', locked: 1 }]);
    });
  });
  it('Chapter 5 user sees both', async () => {
    const r = await asUser(B, (c) => c.query('select id from findings where id = any($1)', [[ch1, ch5]]));
    expect(r.rowCount).toBe(2);
  });
  it('chapter-unknown story items are hidden; chapter-unknown non-story items are shown', async () => {
    const story = await makeFinding({ title: 'FIXTURE unknown story', chapter_min: null, spoiler: 'story' });
    const safe = await makeFinding({ title: 'FIXTURE unknown safe', chapter_min: null, spoiler: 'none' });
    const r = await asUser(A, (c) => c.query('select id from findings where id = any($1)', [[story, safe]]));
    expect(r.rows.map((x) => x.id)).toEqual([safe]);
  });
  it('drafts are invisible to customers', async () => {
    const d = await makeFinding({ title: 'FIXTURE draft', chapter_min: 1, status: 'in_review' });
    const r = await asUser(A, (c) => c.query('select id from findings where id = $1', [d]));
    expect(r.rowCount).toBe(0);
  });
});

describe('customers cannot change verification, publication or billing', () => {
  it('customer cannot update a finding', async () => {
    const r = await asUser(A, (c) => c.query(`update findings set verification = 'verified' where id = $1`, [ch1]));
    expect(r.rowCount).toBe(0);
    await expect(asUser(A, (c) => c.query(
      `insert into findings(game_id, game_scope, category, title, summary, dedupe_key) values ('gta6','GTA_VI','vehicle','x','x','x')`))).rejects.toThrow();
  });
  it('customer cannot write subscriptions or entitlements', async () => {
    await expect(asUser(A, (c) => c.query(`update entitlements set limit_value = null where user_id = $1`, [A]))).rejects.toThrow(/permission denied/);
    await expect(asUser(A, (c) => c.query(`insert into subscriptions(user_id, plan_id, status) values ($1,'pro','active')`, [A]))).rejects.toThrow(/permission denied/);
  });
  it('customer cannot flip flags; owner cannot flip LOCKED flags from the app', async () => {
    const r1 = await asUser(A, (c) => c.query(`update feature_flags set enabled = true where key = 'llm_assistant'`));
    expect(r1.rowCount).toBe(0);
    const r2 = await asUser(OWNER, (c) => c.query(`update feature_flags set enabled = true where key in ('public_registration','billing_live')`));
    expect(r2.rowCount).toBe(0);
    const r3 = await asUser(OWNER, (c) => c.query(`update feature_flags set enabled = true where key = 'llm_assistant' returning key`));
    expect(r3.rowCount).toBe(1);
    await asService((c) => c.query(`update feature_flags set enabled = false where key = 'llm_assistant'`));
  });
  it('corrections can be filed but not self-approved', async () => {
    await asUser(A, (c) => c.query(`insert into corrections(finding_id, reported_by, kind, details) values ($1,$2,'patched','no longer spawns')`, [ch1, A]));
    await expect(asUser(A, (c) => c.query(
      `insert into corrections(finding_id, reported_by, kind, details, status) values ($1,$2,'patched','x x x','accepted')`, [ch1, A]))).rejects.toThrow(/row-level security/);
    const upd = await asUser(A, (c) => c.query(`update corrections set status = 'accepted'`));
    expect(upd.rowCount).toBe(0);
  });
  it('raw source posts are moderator-only', async () => {
    const r = await asUser(A, (c) => c.query('select * from raw_posts'));
    expect(r.rowCount).toBe(0);
  });
});

describe('usage limits', () => {
  it('consume_usage stops at the cap and is per-user', async () => {
    const day = '2026-11-23';
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push((await asUser(A, (c) => c.query(`select consume_usage('assistant', 3, $1) ok`, [day]))).rows[0].ok);
    expect(results).toEqual([true, true, true, false]);
    const b = (await asUser(B, (c) => c.query(`select consume_usage('assistant', 3, $1) ok`, [day]))).rows[0].ok;
    expect(b).toBe(true);
    const zero = (await asUser(A, (c) => c.query(`select consume_usage('refresh', 0, $1) ok`, [day]))).rows[0].ok;
    expect(zero).toBe(false);
  });
});

describe('private uploads', () => {
  it('a user-uploaded map is visible only to its owner and cannot claim calibration', async () => {
    await asUser(B, (c) => c.query(`insert into map_assets(game_id, owner_user_id, kind, storage_key, mime, provenance)
      values ('gta6',$1,'user_uploaded','u/bob/map.png','image/png','my own copy')`, [B]));
    const a = await asUser(A, (c) => c.query('select * from map_assets'));
    expect(a.rowCount).toBe(0);
    await expect(asUser(B, (c) => c.query(`insert into map_assets(game_id, owner_user_id, kind, storage_key, mime, provenance, calibrated)
      values ('gta6',$1,'user_uploaded','u/bob/m2.png','image/png','x', true)`, [B]))).rejects.toThrow(/row-level security/);
  });
});

describe('briefings', () => {
  it('one digest per user per local day', async () => {
    const ins = (uid: string) => asService((c) => c.query(
      `insert into digest_runs(user_id, game_id, local_date, chapter, status) values ($1,'gta6','2026-11-23',1,'ready')`, [uid]));
    await ins(A);
    await expect(ins(A)).rejects.toThrow(/duplicate key/);
    await ins(B);
    const seen = await asUser(A, (c) => c.query('select user_id from digest_runs'));
    expect(seen.rows.every((r) => r.user_id === A)).toBe(true);
  });
});

describe('moderator/owner personal views still honour their own spoiler shield', () => {
  it('an owner at Chapter 1 never sees a Chapter 5 finding in lists, detail, rewards or hunts', async () => {
    const { listFindings, getFinding, rewardsList, setHunt } = await import('@/lib/repo/intel');
    const rows = await listFindings(OWNER, {});
    expect(rows.map((r) => r.id)).not.toContain(ch5);
    expect(await getFinding(OWNER, ch5)).toBeNull();
    expect(JSON.stringify(await rewardsList(OWNER))).not.toContain('ch5 story reveal');
    await expect(setHunt(OWNER, ch5, 'saved')).rejects.toThrow(/not available/);
  });
});

describe('login lockout', () => {
  it('locks only after 8 failures in the window; checking does not consume attempts', async () => {
    const { rateLimit, rateLimited } = await import('@/lib/auth/core');
    const key = `login-fail:email:test-${Math.random()}`;
    for (let i = 0; i < 20; i++) expect(await rateLimited(key, 8, 900)).toBe(false);   // successful logins only check
    for (let i = 0; i < 8; i++) await rateLimit(key, 8, 900);                        // 8 failures
    expect(await rateLimited(key, 8, 900)).toBe(true);
  });
});
