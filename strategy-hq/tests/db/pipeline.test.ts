import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asService, asUser, pool } from '@/lib/db';
import { runScoutPipeline } from '@/lib/workers/pipeline';
import type { Fetcher } from '@/lib/workers/sources';
import { resetDb, makeUser } from './helpers';

const LAUNCH = 'https://www.rockstargames.com/newswire/article/39akk424a9oo53/grand-theft-auto-vi-now-available';
const ARTICLE = 'https://www.rockstargames.com/newswire/article/test-bonus/gta-online-weekly-bonus';
const html = (title: string, body = 'x'.repeat(600)) => `<html><head><title>${title}</title><meta property="og:description" content="${title} description"></head><body>${body}</body></html>`;

let pageVersion = 1;
const fetcher: Fetcher = async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /private', { status: 200 });
  if (url === LAUNCH) return new Response(html('Grand Theft Auto VI Now Available'), { status: 200 });
  if (url === ARTICLE) return new Response(html('Free bonus this week in GTA Online'), { status: 200 });
  if (url.includes('support.rockstargames.com')) return new Response('nope', { status: 500 });
  return new Response(html(`Rockstar page v${pageVersion}`, `content ${pageVersion} `.repeat(80)), { status: 200 });
};

let A: string;
beforeAll(async () => {
  await resetDb();
  A = await makeUser('pipe-a', 'customer', 1);
  await asService(async (c) => {
    await c.query(`insert into sources(game_id, kind, name, canonical_url, access_method, enabled, status)
                   values ('gta6','rockstar','Test article', $1, 'html_change_watch', true, 'not_configured')`, [ARTICLE]);
    // A reward whose deadline has passed but is still labelled active.
    const f = await c.query(`insert into findings(game_id, game_scope, category, title, summary, spoiler_level, publication_status, verification, dedupe_key, published_at)
      values ('gta6','GTA_VI','reward','FIXTURE stale reward','x','none','published','single_report','fixture-stale-reward', now()) returning id`);
    await c.query(`insert into rewards(finding_id, game_scope, cost_type, status, ends_at, source_url) values ($1,'GTA_VI','free','active','2026-01-01T00:00:00Z','https://example.com')`, [f.rows[0].id]);
    await c.query(`insert into evidence(finding_id, url, title, paraphrase, evidence_type, independent_origin) values ($1,'https://example.com/r','r','fixture evidence','official','example.com')`, [f.rows[0].id]);
  });
});
afterAll(async () => { await pool().end(); });

describe('shared scout pipeline', () => {
  it('runs once per idempotency key', async () => {
    const r1 = await runScoutPipeline({ kind: 'daily_scan', idempotencyKey: 'daily_scan:2026-12-01', fetcher });
    expect(r1.status).toBe('partial');               // support page fails → partial, honestly
    const r2 = await runScoutPipeline({ kind: 'daily_scan', idempotencyKey: 'daily_scan:2026-12-01', fetcher });
    expect(r2.status).toBe('skipped');
  });

  it('logs exactly one run per scout, community NOT CONFIGURED, priority scouts PARTIAL without a community feed', async () => {
    const runs = await asService((c) => c.query(`select sr.scout_id, sr.status from scout_runs sr join ingestion_jobs j on j.id = sr.ingestion_job_id where j.idempotency_key = 'daily_scan:2026-12-01'`));
    expect(runs.rowCount).toBe(10);
    const st = Object.fromEntries(runs.rows.map((r) => [r.scout_id, r.status]));
    expect(st.community_scout).toBe('not_configured');
    expect(st.vehicle_scout).toBe('partial');
    expect(st.weapons_scout).toBe('partial');
    expect(st.money_scout).toBe('partial');
  });

  it('Reddit is never fetched without the flag/credentials', async () => {
    const r = await asService((c) => c.query(`select distinct sr.outcome from source_runs sr join sources s on s.id = sr.source_id where s.kind = 'reddit'`));
    expect(r.rows.map((x) => x.outcome)).toEqual(['not_configured']);
  });

  it('an official page the system itself fetched upgrades matching evidence to VERIFIED', async () => {
    const f = await asService((c) => c.query(`select verification, last_confirmed_at from findings where dedupe_key = 'official-gta6-launch'`));
    expect(f.rows[0].verification).toBe('verified');
    expect(f.rows[0].last_confirmed_at).not.toBeNull();
  });

  it('a new official article becomes an IN-REVIEW draft scoped to GTA Online — never auto-published, never shown to customers', async () => {
    const d = await asService((c) => c.query(`select f.publication_status, f.game_scope, f.verification from findings f join evidence e on e.finding_id = f.id where e.url = $1`, [ARTICLE]));
    expect(d.rows[0]).toMatchObject({ publication_status: 'in_review', game_scope: 'GTA_ONLINE', verification: 'verified' }); // official + system-observed, still needs review
    const visible = await asUser(A, (c) => c.query(`select 1 from findings f join evidence e on e.finding_id = f.id where e.url = $1`, [ARTICLE]));
    expect(visible.rowCount).toBe(0);
  });

  it('an index page change is logged for review, not turned into intel', async () => {
    const l = await asService((c) => c.query(`select count(*)::int n from admin_review_log where action = 'source_page_changed'`));
    expect(l.rows[0].n).toBeGreaterThan(0);
    const drafts = await asService((c) => c.query(`select count(*)::int n from findings where title like 'Rockstar page v%'`));
    expect(drafts.rows[0].n).toBe(0);
  });

  it('unchanged content is deduplicated; changed content is a new raw item', async () => {
    const before = (await asService((c) => c.query('select count(*)::int n from raw_posts'))).rows[0].n;
    await runScoutPipeline({ kind: 'manual_refresh', idempotencyKey: 'manual:t1', fetcher });
    const same = (await asService((c) => c.query('select count(*)::int n from raw_posts'))).rows[0].n;
    expect(same).toBe(before);
    pageVersion = 2;
    await runScoutPipeline({ kind: 'manual_refresh', idempotencyKey: 'manual:t2', fetcher });
    const after = (await asService((c) => c.query('select count(*)::int n from raw_posts'))).rows[0].n;
    expect(after).toBeGreaterThan(same);
    const dupFindings = await asService((c) => c.query(`select dedupe_key, count(*) from findings group by dedupe_key having count(*) > 1`));
    expect(dupFindings.rowCount).toBe(0);
  });

  it('expires a reward whose deadline passed and records the correction', async () => {
    const r = await asService((c) => c.query(`select r.status, f.verification from rewards r join findings f on f.id = r.finding_id where f.dedupe_key = 'fixture-stale-reward'`));
    expect(r.rows[0]).toEqual({ status: 'expired', verification: 'expired' });
  });

  it('robots.txt disallow blocks a fetch', async () => {
    await asService((c) => c.query(`insert into sources(game_id, kind, name, canonical_url, access_method, enabled) values ('gta6','rockstar','Blocked','https://www.rockstargames.com/private/x','html_change_watch',true)`));
    const r = await runScoutPipeline({ kind: 'manual_refresh', idempotencyKey: 'manual:t3', fetcher });
    expect(r.sources.find((s) => s.name === 'Blocked')?.outcome).toBe('blocked');
  });
});
