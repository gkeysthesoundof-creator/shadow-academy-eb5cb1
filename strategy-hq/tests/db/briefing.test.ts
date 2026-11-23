import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { asService, pool } from '@/lib/db';
import { buildBriefForUser, runBriefStage } from '@/lib/workers/briefing';
import { deliverBrief } from '@/lib/email/deliver';
import { resetDb, makeUser, makeFinding } from './helpers';

let ch1: string, ch5: string, ownerId: string;
const DAY = '2026-12-02';
const SECRET = 'SECRET CH5 REVEAL';

beforeAll(async () => {
  await resetDb();
  ch1 = await makeUser('brief-ch1', 'customer', 1);
  ch5 = await makeUser('brief-ch5', 'customer', 5);
  ownerId = await makeUser('brief-owner', 'owner', 1);
  await makeFinding({ title: 'FIXTURE ch1 verified car', chapter_min: 1, scouts: ['vehicle_scout'], category: 'vehicle' });
  await makeFinding({ title: SECRET, chapter_min: 5, scouts: ['vehicle_scout'], category: 'vehicle' });
  await makeFinding({ title: 'FIXTURE GTA Online free gift', chapter_min: null, spoiler: 'none', category: 'reward', scouts: ['rewards_scout'], scope: 'GTA_ONLINE' });
});
afterAll(async () => { await pool().end(); });
afterEach(() => { for (const k of ['REPORT_ENABLED', 'RESEND_API_KEY', 'REPORT_FROM_EMAIL', 'REPORT_TO_EMAIL']) delete process.env[k]; });

describe('morning brief', () => {
  it('a Chapter 1 brief never contains Chapter 5 content (body, subject, preheader, alt text)', async () => {
    const b = await buildBriefForUser(ch1, DAY);
    expect(b.html).not.toContain(SECRET);
    expect(b.subject).not.toContain(SECRET);
    expect(b.preheader).not.toContain(SECRET);
    expect(JSON.stringify(b.model)).not.toContain(SECRET);
    expect(b.subject).toBe('🎮 GTA VI Strategy HQ | Chapter 1 Morning Brief — Wednesday, December 2, 2026');
  });
  it('the Chapter 5 player does get it', async () => {
    const b = await buildBriefForUser(ch5, DAY);
    expect(b.html).toContain(SECRET);
  });
  it('GTA Online gifts never appear in the GTA VI brief', async () => {
    const b = await buildBriefForUser(ch1, DAY);
    expect(b.html).not.toContain('GTA Online free gift');
  });
  it('items deep-link to the authenticated app with finding focus', async () => {
    const b = await buildBriefForUser(ch1, DAY);
    expect(b.html).toMatch(/\/intel\/[0-9a-f-]{36}\?focus=visual&amp;from=brief/);
    expect(b.html).toMatch(/\/map\?finding=[0-9a-f-]{36}&amp;from=brief/);
    expect(b.html).toContain(`/brief/${DAY}?from=brief`);
  });
  it('scout claims come only from logged runs (none here)', async () => {
    const b = await buildBriefForUser(ch1, DAY);
    expect(b.model.health.scoutsRan).toEqual([]);
    expect(b.model.health.scanStatus).toBe('no scan has run yet');
  });
  it('one brief per user per local day; delivery is a recorded dry run while email is off', async () => {
    const first = await runBriefStage(DAY);
    expect(first).toEqual(first.map((r) => ({ ...r, status: 'ready', delivery: 'dry_run' })));
    const second = await runBriefStage(DAY);
    expect(second.every((r) => r.status === 'already_built')).toBe(true);
    const att = await asService((c) => c.query(`select status from delivery_attempts`));
    expect(att.rows.every((r) => r.status === 'dry_run')).toBe(true);
  });
  it('no-new-data brief says so and lists saved to-dos as previously known', async () => {
    await asService((c) => c.query(`update findings set published_at = now() - interval '10 days', updated_at = now() - interval '10 days', first_seen_at = now() - interval '10 days'`));
    const b = await buildBriefForUser(ch1, '2026-12-03');
    expect(b.model.noNewVerified).toBe(true);
    expect(b.html).toContain('No new verified discoveries');
  });
});

describe('email delivery gates', () => {
  const digestFor = async (uid: string) => (await asService((c) => c.query(`select id from digest_runs where user_id = $1 and local_date = $2`, [uid, DAY]))).rows[0].id;

  it('founder-private mode refuses any recipient but REPORT_TO_EMAIL, even with everything else on', async () => {
    Object.assign(process.env, { REPORT_ENABLED: 'true', RESEND_API_KEY: 'test', REPORT_FROM_EMAIL: 'hq@example.com', REPORT_TO_EMAIL: 'brief-owner@test.local' });
    await asService(async (c) => {
      await c.query(`update feature_flags set enabled = true where key = 'email_delivery'`);
      await c.query(`update alert_preferences set email_enabled = true`);
      await c.query(`insert into entitlements(user_id, feature, limit_value, source) values ($1,'morning_email',null,'grant') on conflict do nothing`, [ch1]);
    });
    let sends = 0;
    const sendFn = async () => { sends++; return { ok: true, id: 'msg_1' }; };
    const r = await deliverBrief({ digestId: await digestFor(ch1), userId: ch1, userEmail: 'brief-ch1@test.local', localDate: DAY, subject: 's', html: 'h', sendFn });
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/founder-private/);
    expect(sends).toBe(0);
  });
  it('the owner address is accepted once, then idempotent (no second send)', async () => {
    Object.assign(process.env, { REPORT_ENABLED: 'true', RESEND_API_KEY: 'test', REPORT_FROM_EMAIL: 'hq@example.com', REPORT_TO_EMAIL: 'brief-owner@test.local' });
    let sends = 0;
    const sendFn = async () => { sends++; return { ok: true, id: 'msg_2' }; };
    const d = await digestFor(ownerId);
    const r1 = await deliverBrief({ digestId: d, userId: ownerId, userEmail: 'brief-owner@test.local', localDate: DAY, subject: 's', html: 'h', sendFn });
    const r2 = await deliverBrief({ digestId: d, userId: ownerId, userEmail: 'brief-owner@test.local', localDate: DAY, subject: 's', html: 'h', sendFn });
    expect(r1.status).toBe('provider_accepted');
    expect(r1.reason).toMatch(/not proof of inbox delivery/);
    expect(r2.status).toBe('provider_accepted');
    expect(sends).toBe(1);
  });
  it('transient failures retry, permanent failures stop', async () => {
    Object.assign(process.env, { REPORT_ENABLED: 'true', RESEND_API_KEY: 'test', REPORT_FROM_EMAIL: 'hq@example.com', REPORT_TO_EMAIL: 'brief-ch5@test.local' });
    await asService((c) => c.query(`insert into entitlements(user_id, feature, limit_value, source) values ($1,'morning_email',null,'grant') on conflict do nothing`, [ch5]));
    let calls = 0;
    const r = await deliverBrief({ digestId: await digestFor(ch5), userId: ch5, userEmail: 'brief-ch5@test.local', localDate: DAY, subject: 's', html: 'h',
      sendFn: async () => { calls++; return { ok: false, error: 'HTTP 422', transient: false }; } });
    expect(r.status).toBe('failed');
    expect(calls).toBe(1);
    await asService((c) => c.query(`update feature_flags set enabled = false where key = 'email_delivery'`));
  });
});
