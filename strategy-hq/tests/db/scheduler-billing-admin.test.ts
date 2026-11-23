import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asService, asUser, pool } from '@/lib/db';
import { tick } from '@/lib/workers/scheduler';
import { applyEvent, normalize } from '@/lib/billing/adapter';
import { createDraft, publish, markPatchedOrDebunked, addEvidence, type IntakeInput } from '@/lib/repo/admin';
import { listFindings } from '@/lib/repo/intel';
import type { Fetcher } from '@/lib/workers/sources';
import { resetDb, makeUser } from './helpers';

const fetcher: Fetcher = async () => new Response('down', { status: 503 });
let owner: string, cust: string;

beforeAll(async () => {
  await resetDb();
  owner = await makeUser('sba-owner', 'owner', 1);
  cust = await makeUser('sba-cust', 'customer', 1);
});
afterAll(async () => { await pool().end(); });

describe('scheduler tick (America/New_York, DST-safe, idempotent)', () => {
  it('idle before 7:15, scans after, briefs after 8:30 exactly once even with parallel ticks', async () => {
    expect((await tick({ now: new Date('2026-12-07T11:59:00Z'), fetcher })).stage).toBe('idle');    // 6:59 ET
    expect((await tick({ now: new Date('2026-12-07T12:16:00Z'), fetcher })).stage).toBe('scan');    // 7:16 ET
    expect((await tick({ now: new Date('2026-12-07T12:31:00Z'), fetcher })).stage).toBe('idle');    // scanned, before brief
    const parallel = await Promise.all([0, 1, 2].map(() => tick({ now: new Date('2026-12-07T13:31:00Z'), fetcher })));
    expect(parallel.filter((p) => p.stage === 'brief').length).toBe(1);
    const digests = await asService((c) => c.query(`select user_id, count(*)::int n from digest_runs where local_date = '2026-12-07' group by user_id`));
    expect(digests.rows.every((r) => r.n === 1)).toBe(true);
    expect(digests.rowCount).toBe(2);
  });
  it('summer: 7:16 EDT is 11:16Z', async () => {
    expect((await tick({ now: new Date('2026-07-07T11:16:00Z'), fetcher })).stage).toBe('scan');
  });
});

describe('billing webhook (staging)', () => {
  const ev = (id: string, extra: object = {}) => normalize({ id, type: 'subscription.activated', data: { user_id: cust, plan: 'plus', interval: 'month' }, ...extra })!;
  it('test events are ignored until the owner enables billing test mode', async () => {
    expect(await applyEvent('test', ev('e1'), '{}')).toBe('ignored');
  });
  it('applies test-mode events once (idempotent) and never accepts live events', async () => {
    await asService((c) => c.query(`update feature_flags set enabled = true where key = 'billing_test_mode'`));
    expect(await applyEvent('test', ev('e2'), '{}')).toBe('processed');
    expect(await applyEvent('test', ev('e2'), '{}')).toBe('duplicate');
    expect(await applyEvent('test', ev('e3', { livemode: true }), '{}')).toBe('rejected_live');
    const plan = await asUser(cust, (c) => c.query(`select plan_id from subscriptions where status = 'active'`));
    expect(plan.rows[0].plan_id).toBe('plus');
    const ent = await asUser(cust, (c) => c.query(`select limit_value from entitlements where feature = 'assistant_queries_daily'`));
    expect(ent.rows[0].limit_value).toBe(30);
  });
  it('the grandfathered founder is never downgraded by a webhook', async () => {
    const r = await applyEvent('test', normalize({ id: 'e4', type: 'subscription.canceled', data: { user_id: owner } })!, '{}');
    expect(r).toBe('ignored');
    const plan = await asUser(owner, (c) => c.query(`select plan_id from subscriptions where status = 'grandfathered'`));
    expect(plan.rows[0].plan_id).toBe('founder');
    await asService((c) => c.query(`update feature_flags set enabled = false where key = 'billing_test_mode'`));
  });
});

describe('moderation & intake', () => {
  const base: IntakeInput = {
    category: 'vehicle', game_scope: 'GTA_VI', title: 'FIXTURE parked sports car', summary: 'A fixture paraphrase for tests only.', how_to: ['step'],
    risk: 'low', chapter_min: null, spoiler_level: 'story', landmark: 'FIXTURE car park behind the diner', is_free: true,
    payout_min: null, payout_max: null, price: null, attributes: {},
    evidence: [{ url: 'https://example.com/post/1', title: 'Fixture post', paraphrase: 'Says a car is parked there.', evidence_type: 'community', author: 'alice' }],
  };
  let id = '';
  it('customers cannot create intel', async () => {
    await expect(createDraft(cust, base)).rejects.toThrow();
  });
  it('evidence is mandatory and must be https', async () => {
    await expect(createDraft(owner, { ...base, evidence: [] })).rejects.toThrow(/evidence/);
    await expect(createDraft(owner, { ...base, evidence: [{ ...base.evidence[0], url: 'http://x.test' }] })).rejects.toThrow(/https/);
  });
  it('creates one draft per place+category; the second report of the same spot is rejected as a duplicate', async () => {
    id = await createDraft(owner, base);
    await expect(createDraft(owner, { ...base, title: 'Same car, different words' })).rejects.toThrow(/Duplicate/);
  });
  it('publication gate: chapter decision required for story content', async () => {
    await expect(publish(owner, id)).rejects.toThrow(/chapter/);
    await asUser(owner, (c) => c.query(`update findings set chapter_min = 1 where id = $1`, [id]));
    await publish(owner, id);
    const rows = await listFindings(cust, { scout: 'vehicle_scout' });
    expect(rows.map((r) => r.id)).toContain(id);
    expect(rows.find((r) => r.id === id)?.verification).toBe('single_report');
  });
  it('a second independent source corroborates; a patch note expires it and it moves to the patched filter', async () => {
    await addEvidence(owner, id, { url: 'https://another.example.org/guide', title: 'Guide', paraphrase: 'Same spot confirmed.', evidence_type: 'guide' });
    let row = (await listFindings(cust, { scout: 'vehicle_scout' })).find((r) => r.id === id);
    expect(row?.verification).toBe('corroborated');
    await markPatchedOrDebunked(owner, id, 'patched', 'Removed in title update');
    row = (await listFindings(cust, { scout: 'vehicle_scout', filters: ['patched'] })).find((r) => r.id === id);
    expect(row?.verification).toBe('expired');
  });
});
