import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asService, pool } from '@/lib/db';
import { runScoutPipeline } from '@/lib/workers/pipeline';
import { listFindings, getFinding } from '@/lib/repo/intel';
import type { Fetcher } from '@/lib/workers/sources';
import type { Extraction, ParseFn } from '@/lib/workers/extract';
import { resetDb, makeUser } from './helpers';

/* A simulated morning: Reddit + a guide feed, all fixtures (no network). */
const posts = [
  { name: 't3_1', author: 'alice', title: 'Found a free Pegassi Zentorno parked behind the Vice Beach lifeguard tower',
    selftext: 'It was parked behind the lifeguard tower at Vice Beach around noon. Respawned after I saved and reloaded.', spoiler: false },
  { name: 't3_2', author: 'bob', title: 'Zentorno spawn at Vice Beach lifeguard tower confirmed',
    selftext: 'Can confirm the Pegassi Zentorno behind the Vice Beach lifeguard tower, got it twice.', spoiler: false },
  { name: 't3_3', author: 'carol', title: 'Chapter 5 ending reveal about the twist', selftext: 'Huge spoiler inside.', spoiler: true },
  { name: 't3_4', author: 'dave', title: 'Cash stash: $25,000 in the safe at the Little Havana pawn shop back room',
    selftext: 'Back room of the pawn shop in Little Havana, safe has $25,000. One time only.', spoiler: false },
  { name: 't3_5', author: 'erin', title: 'Where can I find a sniper rifle?', selftext: '', spoiler: false },
  { name: 't3_6', author: 'frank', title: 'GTA Online weekly bonus: free car this week', selftext: 'GTA Online players get a free car.', spoiler: false },
];
const FEED = 'https://www.example-guides.com/feed/';
const ARTICLE = 'https://www.example-guides.com/gta-6-hidden-weapon-locations';
const rss = `<?xml version="1.0"?><rss><channel>
  <item><title>GTA 6: Every Hidden Weapon Location</title><link>${ARTICLE}</link><pubDate>Mon, 23 Nov 2026 10:00:00 GMT</pubDate><description>Weapons guide</description></item>
  <item><title>Best indie games of 2026</title><link>https://www.example-guides.com/indies</link><description>Not GTA</description></item>
</channel></rss>`;
const article = `<html><body><nav>menu</nav><article><h1>GTA 6: Every Hidden Weapon Location</h1>
  <p>The Micro SMG is on the roof of the Leonida Keys gas station. Climb the ladder at the back.</p>
  <p>A free Pump Shotgun sits in the Port Gellhorn boathouse.</p></article></body></html>`;

const fetcher: Fetcher = async (url, init) => {
  if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /private', { status: 200 });
  if (url.includes('access_token')) return Response.json({ access_token: 'tok' });
  if (url.includes('oauth.reddit.com/r/GTA6/')) return Response.json({ data: { children: posts.map((d) => ({ data: { ...d, permalink: `/r/GTA6/comments/${d.name}/`, created_utc: 1795000000 } })) } });
  if (url.includes('oauth.reddit.com')) return Response.json({ data: { children: [] } });
  if (url === FEED) return new Response(rss, { status: 200 });
  if (url === ARTICLE) return new Response(article, { status: 200 });
  void init;
  return new Response('unreachable', { status: 503 });
};

let A: string;
async function setup() {
  await resetDb();
  A = await makeUser('auto-a', 'customer', 1);
  Object.assign(process.env, { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret', REDDIT_USER_AGENT: 'test/1.0' });
  await asService(async (c) => {
    await c.query(`update feature_flags set enabled = true where key = 'reddit_ingestion'`);
    await c.query(`update sources set enabled = false where kind = 'guide'`);
    await c.query(`insert into sources(game_id, kind, name, canonical_url, access_method, enabled) values ('gta6','guide','Example Guides',$1,'rss',true)`, [FEED]);
  });
}
afterAll(async () => {
  for (const k of ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT']) delete process.env[k];
  await pool().end();
});

describe('auto-population without an AI key (rules reader)', () => {
  beforeAll(async () => { await setup(); await runScoutPipeline({ kind: 'manual_refresh', idempotencyKey: 'auto:rules', fetcher, parse: null }); });

  it('fills Vehicles, Cash and Weapons with no manual work', async () => {
    const v = await listFindings(A, { scout: 'vehicle_scout', scope: 'GTA_VI' });
    const m = await listFindings(A, { scout: 'money_scout', scope: 'GTA_VI' });
    const w = await listFindings(A, { scout: 'weapons_scout', scope: 'GTA_VI' });
    expect(v.some((f) => /Zentorno/.test(f.title))).toBe(true);
    expect(m.some((f) => /Little Havana/.test(f.title))).toBe(true);
    expect(w.some((f) => /Weapon Location/.test(f.title))).toBe(true);
  });
  it('badges are honest: community finds are single reports, never "verified"', async () => {
    const v = await listFindings(A, { scout: 'vehicle_scout', scope: 'GTA_VI' });
    expect(v.every((f) => f.verification === 'single_report' || f.verification === 'corroborated')).toBe(true);
  });
  it('spoiler-flagged posts, questions and GTA Online posts stay out of GTA VI sections', async () => {
    const all = await listFindings(A, { scope: 'GTA_VI' });
    const titles = all.map((f) => f.title).join(' | ');
    expect(titles).not.toMatch(/ending|twist/i);
    expect(titles).not.toMatch(/sniper rifle\?/i);
    expect(titles).not.toMatch(/GTA Online/i);
  });
  it('stores only a short excerpt of each post, never the full text', async () => {
    const r = await asService((c) => c.query(`select max(length(coalesce(excerpt,'')))::int n from raw_posts`));
    expect(r.rows[0].n).toBeLessThanOrEqual(280);
  });
});

describe('auto-population with Claude Haiku (fake model, grounded)', () => {
  let calls = 0;
  const parse: ParseFn = async (params) => {
    calls++;
    const content = String((params.messages as { content: string }[])[0].content);
    const base = { region: null, how_to: [], price: null, is_free: null, chapter: null, availability: null, make_model: null,
      vehicle_class: null, weapon_type: null, unlock_condition: null, respawns: null, confidence: 'high' as const, spoiler: 'none' as const };
    let out: Extraction = { relevant: false, game: 'GTA_VI', cards: [] };
    if (/Zentorno/.test(content)) {
      out = { relevant: true, game: 'GTA_VI', cards: [{ ...base, category: 'vehicle', subject: 'Pegassi Zentorno', title: 'Pegassi Zentorno at Vice Beach',
        summary: 'A Zentorno supercar can be found parked by the lifeguard tower.', landmark: 'behind the Vice Beach lifeguard tower', make_model: 'Pegassi Zentorno',
        payout_min: 99999, payout_max: null }] };          // 99999 is NOT in the post → must be removed
    } else if (/Weapon Location/.test(content)) {
      out = { relevant: true, game: 'GTA_VI', cards: [
        { ...base, category: 'weapon', subject: 'Micro SMG', title: 'Micro SMG on a gas station roof', summary: 'Climb the back ladder to grab a Micro SMG.',
          landmark: 'roof of the Leonida Keys gas station', how_to: ['Climb the ladder at the back'], payout_min: null, payout_max: null, weapon_type: 'SMG' },
        { ...base, category: 'weapon', subject: 'Railgun', title: 'Railgun in the sewer', summary: 'Invented by the model.',
          landmark: 'Vice City sewers', payout_min: null, payout_max: null },   // not in the article → card dropped
      ] };
    } else if (/pawn shop/.test(content)) {
      out = { relevant: true, game: 'GTA_VI', cards: [{ ...base, category: 'cash_pickup', subject: 'pawn shop safe', title: 'Pawn shop safe in Little Havana',
        summary: 'A one-time safe in the back room.', landmark: 'back room of the Little Havana pawn shop', payout_min: 25000, payout_max: 25000, availability: 'one-time' }] };
    }
    return { parsed_output: out, stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 300 } };
  };
  beforeAll(async () => { await setup(); await runScoutPipeline({ kind: 'manual_refresh', idempotencyKey: 'auto:llm', fetcher, parse }); });

  it('two independent posts about the same car at the same spot become ONE corroborated card', async () => {
    const v = (await listFindings(A, { scout: 'vehicle_scout', scope: 'GTA_VI' })).filter((f) => /Zentorno/.test(f.title));
    expect(v).toHaveLength(1);
    expect(v[0].verification).toBe('corroborated');
    expect(v[0].evidence_count).toBe(2);
    expect(v[0].landmark).toBe('behind the Vice Beach lifeguard tower');
  });
  it('facts the source never stated are stripped (invented payout) or dropped (invented item)', async () => {
    const v = (await listFindings(A, { scout: 'vehicle_scout', scope: 'GTA_VI' })).find((f) => /Zentorno/.test(f.title))!;
    expect(v.payout_min).toBeNull();
    const w = await listFindings(A, { scout: 'weapons_scout', scope: 'GTA_VI' });
    expect(w.map((f) => f.title)).toContain('Micro SMG on a gas station roof');
    expect(w.map((f) => f.title).join(' ')).not.toMatch(/Railgun/);
  });
  it('stated payouts are kept and money cards land in Cash Trail with a type', async () => {
    const m = (await listFindings(A, { scout: 'money_scout', scope: 'GTA_VI' })).find((f) => /pawn shop/i.test(f.title))!;
    expect(m.payout_min).toBe(25000);
    const d = await getFinding(A, m.id);
    expect(d?.money?.money_kind).toBe('world_pickup');
  });
  it('model spend is metered against the daily ceiling', async () => {
    expect(calls).toBeGreaterThan(0);
    const b = await asService((c) => c.query(`select sum(cost_micros)::int c, sum(calls)::int n from platform_budget where meter = 'llm_extract'`));
    expect(b.rows[0].n).toBe(calls);
    expect(b.rows[0].c).toBe(calls * 300);   // Haiku: 1500 in × $0.10/M + 300 out × $0.50/M = 300 micros
  });
});
