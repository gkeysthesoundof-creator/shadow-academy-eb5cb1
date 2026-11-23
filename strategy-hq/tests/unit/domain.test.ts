import { describe, it, expect } from 'vitest';
import { computeVerification, normalizeKey, originOf, isRecommendable } from '@/lib/domain/evidence';
import { displayLevel, mediaPublishable, ingestionAllowed } from '@/lib/domain/rights';
import { radarBucket, gta6Rewards, classifyRewardText, effectiveStatus, deadlineSoon } from '@/lib/domain/rewards';
import { cashPerHour, rankMoney, formatPayout, type MoneyItem } from '@/lib/domain/money';
import { decideStage, localParts, reachedLocalTime } from '@/lib/domain/schedule';
import { visibleAtChapter, assertAllVisible } from '@/lib/domain/spoilers';
import { routeText, looksLikeStorySpoiler } from '@/lib/domain/router';
import { effectivePlan, limitFor } from '@/lib/domain/plans';
import { SCOUTS, PRIORITY_SCOUTS, scoutBySlug } from '@/lib/domain/scouts';
import { robotsAllows } from '@/lib/workers/sources';
import { verifySignature, sign, normalize } from '@/lib/billing/adapter';

const ev = (o: Partial<Parameters<typeof computeVerification>[0]['evidence'][number]>) =>
  ({ evidence_type: 'community', independent_origin: 'a', contradicts: false, system_observed: false, ...o }) as const;

describe('scout roster', () => {
  it('has exactly ten scouts with the required ids and the three priorities', () => {
    expect(SCOUTS.map((s) => s.id)).toEqual(['vehicle_scout', 'weapons_scout', 'money_scout', 'secrets_scout', 'strategy_scout', 'map_scout', 'rewards_scout', 'community_scout', 'evidence_scout', 'briefing_scout']);
    expect(PRIORITY_SCOUTS).toEqual(['vehicle_scout', 'weapons_scout', 'money_scout']);
    for (const slug of ['vehicles', 'weapons', 'cash']) expect(scoutBySlug(slug)?.workbench).toBe(true);
  });
});

describe('evidence tiers', () => {
  it('a single community post is a single report, never verified', () => {
    expect(computeVerification({ evidence: [ev({})] })).toBe('single_report');
  });
  it('two posts from the same origin do not corroborate', () => {
    expect(computeVerification({ evidence: [ev({}), ev({})] })).toBe('single_report');
  });
  it('two independent origins corroborate', () => {
    expect(computeVerification({ evidence: [ev({}), ev({ independent_origin: 'b' })] })).toBe('corroborated');
  });
  it('official source only counts as verified when the system itself observed it', () => {
    expect(computeVerification({ evidence: [ev({ evidence_type: 'official' })] })).toBe('single_report');
    expect(computeVerification({ evidence: [ev({ evidence_type: 'official', system_observed: true })] })).toBe('verified');
  });
  it('founder in-game observation + one independent report verifies', () => {
    expect(computeVerification({ evidence: [ev({ evidence_type: 'founder_observation', independent_origin: 'founder' }), ev({ independent_origin: 'b' })] })).toBe('verified');
  });
  it('conflicting reports: contradictions that match support → debunked', () => {
    expect(computeVerification({ evidence: [ev({}), ev({ independent_origin: 'x', contradicts: true })] })).toBe('debunked');
    // 2 supporting origins vs 1 contradicting: not debunked, but no longer clean corroboration
    expect(computeVerification({ evidence: [ev({}), ev({ independent_origin: 'b' }), ev({ independent_origin: 'x', contradicts: true })] })).toBe('single_report');
  });
  it('patch invalidation expires a finding', () => {
    expect(computeVerification({ evidence: [ev({}), ev({ independent_origin: 'b' })], patched: true })).toBe('expired');
  });
  it('only verified/corroborated are recommendable', () => {
    expect(['verified', 'corroborated', 'single_report', 'unverified', 'debunked', 'expired'].filter((v) => isRecommendable(v as never))).toEqual(['verified', 'corroborated']);
  });
  it('dedupe keys normalize wording so one place is one record', () => {
    expect(normalizeKey('vehicle', 'The Garage near Ocean Drive')).toBe(normalizeKey('vehicle', 'garage  ocean-drive'));
  });
  it('reddit authors are separate origins; same site is one origin', () => {
    expect(originOf('https://www.reddit.com/r/GTA6/x', 'Alice')).toBe('reddit:u/alice');
    expect(originOf('https://old.reddit.com/r/GTA6/y', 'alice')).toBe('reddit:u/alice');
    expect(originOf('https://www.example.com/a')).toBe(originOf('https://example.com/b'));
  });
});

describe('rights gate', () => {
  it('no record or unreviewed → link only; denied → hidden; personal use → private mode only', () => {
    expect(displayLevel(null, 'founder_private')).toBe('link_only');
    expect(displayLevel({ rights_status: 'denied', allowed_uses: [], expires_at: null }, 'founder_private')).toBe('hidden');
    const personal = { rights_status: 'personal_use' as const, allowed_uses: ['private'], expires_at: null };
    expect(displayLevel(personal, 'founder_private')).toBe('full_media');
    expect(displayLevel(personal, 'commercial')).toBe('summary_and_link');
  });
  it('no unlicensed image in commercial mode; illustrative art is never evidence', () => {
    expect(mediaPublishable({ kind: 'real_gameplay', license: null }, 'commercial')).toBe(false);
    expect(mediaPublishable({ kind: 'real_gameplay', license: { rights_status: 'licensed', allowed_uses: ['private'], expires_at: null } }, 'commercial')).toBe(false);
    expect(mediaPublishable({ kind: 'real_gameplay', license: { rights_status: 'licensed', allowed_uses: ['commercial'], expires_at: null } }, 'commercial')).toBe(true);
    expect(mediaPublishable({ kind: 'illustrative', license: { rights_status: 'owned', allowed_uses: ['commercial'], expires_at: null } }, 'commercial')).toBe(false);
  });
  it('expired licence hides content', () => {
    expect(displayLevel({ rights_status: 'licensed', allowed_uses: ['private'], expires_at: '2020-01-01' }, 'founder_private')).toBe('hidden');
  });
  it('Reddit ingestion in commercial mode needs a commercial agreement', () => {
    expect(ingestionAllowed({ kind: 'reddit', rights: null }, 'commercial').ok).toBe(false);
    expect(ingestionAllowed({ kind: 'reddit', rights: { rights_status: 'licensed', allowed_uses: ['commercial'], expires_at: null } }, 'commercial').ok).toBe(true);
    expect(ingestionAllowed({ kind: 'reddit', rights: null }, 'founder_private').ok).toBe(true);
  });
});

describe('rewards radar', () => {
  const now = new Date('2026-11-23T15:00:00Z');
  it("GTA Online's free gift is never shown as a GTA VI reward", () => {
    const rows = [{ game_scope: 'GTA_ONLINE' as const, cost_type: 'free' as const, status: 'active' as const, platforms: ['PS5'], ends_at: null }];
    expect(gta6Rewards(rows)).toEqual([]);
    expect(classifyRewardText('Free bonus in GTA Online this week').game_scope).toBe('GTA_ONLINE');
    expect(classifyRewardText('GTA Online and GTA VI news').game_scope).toBe('GTA_ONLINE');
  });
  it('GTA+ perks are never "free today"', () => {
    expect(classifyRewardText('Free for GTA+ members').cost_type).toBe('subscription');
    expect(radarBucket({ game_scope: 'GTA_VI', cost_type: 'subscription', status: 'active', platforms: [], ends_at: null }, now)).toBe('gta_plus');
  });
  it('purchase-bundled perks are "included with purchase", not free', () => {
    expect(classifyRewardText('Get the pack free with any qualifying purchase').cost_type).toBe('included_with_purchase');
  });
  it('a stale "active" label cannot outlive its deadline', () => {
    const r = { game_scope: 'GTA_VI' as const, cost_type: 'free' as const, status: 'active' as const, platforms: [], ends_at: '2026-11-19T23:59:00Z' };
    expect(effectiveStatus(r, now)).toBe('expired');
    expect(radarBucket(r, now)).toBe('expired');
  });
  it('deadline-soon alert only for active rewards within 72h', () => {
    expect(deadlineSoon({ game_scope: 'GTA_VI', cost_type: 'free', status: 'active', platforms: [], ends_at: '2026-11-25T00:00:00Z' }, now)).toBe(true);
    expect(deadlineSoon({ game_scope: 'GTA_VI', cost_type: 'free', status: 'active', platforms: [], ends_at: '2026-12-25T00:00:00Z' }, now)).toBe(false);
  });
});

describe('cash trail', () => {
  const base: MoneyItem = { id: 'a', money_kind: 'repeatable_activity', payout_min: null, payout_max: null, time_minutes_min: null, time_minutes_max: null, verification: 'verified', risk: 'low', patched: false };
  it('cash/hour is UNKNOWN unless payout AND time are evidenced', () => {
    expect(cashPerHour(base)).toBe('UNKNOWN');
    expect(cashPerHour({ ...base, payout_min: 1000, payout_max: 2000 })).toBe('UNKNOWN');
    expect(cashPerHour({ ...base, payout_min: 1000, payout_max: 2000, time_minutes_min: 10, time_minutes_max: 20 })).toEqual({ low: 3000, high: 12000 });
    expect(formatPayout(null, null)).toBe('UNKNOWN');
  });
  it('patched items rank last; stronger evidence ranks first', () => {
    const r = rankMoney([{ ...base, id: 'p', patched: true }, { ...base, id: 's', verification: 'single_report' }, { ...base, id: 'v' }]);
    expect(r.map((x) => x.id)).toEqual(['v', 's', 'p']);
  });
});

describe('DST-safe schedule (America/New_York)', () => {
  const tz = 'America/New_York';
  it('7:15 local is 12:15Z in winter and 11:15Z in summer', () => {
    expect(reachedLocalTime(new Date('2026-01-15T12:14:00Z'), tz, '07:15')).toBe(false);
    expect(reachedLocalTime(new Date('2026-01-15T12:15:00Z'), tz, '07:15')).toBe(true);
    expect(reachedLocalTime(new Date('2026-07-15T11:15:00Z'), tz, '07:15')).toBe(true);
    expect(reachedLocalTime(new Date('2026-07-15T11:14:00Z'), tz, '07:15')).toBe(false);
  });
  it('handles the spring-forward and fall-back days', () => {
    expect(localParts(new Date('2026-03-08T12:30:00Z'), tz)).toEqual({ date: '2026-03-08', hour: 8, minute: 30 });
    expect(localParts(new Date('2026-11-01T13:30:00Z'), tz)).toEqual({ date: '2026-11-01', hour: 8, minute: 30 });
  });
  it('local date rolls at local midnight, not UTC midnight', () => {
    expect(localParts(new Date('2026-11-24T03:00:00Z'), tz).date).toBe('2026-11-23');
  });
  it('stages: scan, then brief only after scan (or after 90-min grace)', () => {
    const o = { timeZone: tz, scanTime: '07:15', briefTime: '08:30' };
    expect(decideStage({ ...o, now: new Date('2026-11-23T11:00:00Z'), scanDoneToday: false, briefDoneToday: false })).toBe('idle');
    expect(decideStage({ ...o, now: new Date('2026-11-23T12:20:00Z'), scanDoneToday: false, briefDoneToday: false })).toBe('scan');
    expect(decideStage({ ...o, now: new Date('2026-11-23T13:31:00Z'), scanDoneToday: true, briefDoneToday: false })).toBe('brief');
    expect(decideStage({ ...o, now: new Date('2026-11-23T13:31:00Z'), scanDoneToday: true, briefDoneToday: true })).toBe('idle');
  });
});

describe('spoiler gate mirror', () => {
  it('blocks above-chapter and unknown-chapter story items', () => {
    expect(visibleAtChapter({ publication_status: 'published', chapter_min: 5, spoiler_level: 'story' }, 1)).toBe(false);
    expect(visibleAtChapter({ publication_status: 'published', chapter_min: null, spoiler_level: 'story' }, 9)).toBe(false);
    expect(visibleAtChapter({ publication_status: 'published', chapter_min: null, spoiler_level: 'none' }, 1)).toBe(true);
    expect(() => assertAllVisible([{ id: 'x', publication_status: 'published', chapter_min: 5, spoiler_level: 'story' }], 1)).toThrow(/spoiler gate/);
  });
});

describe('deterministic router', () => {
  it('routes by keyword with word boundaries', () => {
    expect(routeText('Found a rare supercar in a hidden garage')).toEqual(expect.arrayContaining(['vehicle_scout']));
    expect(routeText('Free ammo cache behind the gas station')).toEqual(expect.arrayContaining(['weapons_scout', 'rewards_scout']));
    expect(routeText('Cartoon')).not.toContain('vehicle_scout');
    expect(looksLikeStorySpoiler('chapter 5 twist ending')).toBe(true);
  });
});

describe('plans & entitlements', () => {
  it('founder is grandfathered; default is FREE', () => {
    expect(effectivePlan([])).toBe('free');
    expect(effectivePlan([{ plan_id: 'founder', status: 'grandfathered' }])).toBe('founder');
    expect(effectivePlan([{ plan_id: 'pro', status: 'canceled' }])).toBe('free');
    expect(limitFor('free', 'morning_email')).toBe(false);
    expect(limitFor('founder', 'admin_console')).toBe(true);
  });
});

describe('robots.txt', () => {
  const txt = 'User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: badbot\nDisallow: /';
  it('respects disallow, allow precedence and agent groups', () => {
    expect(robotsAllows(txt, '/newswire')).toBe(true);
    expect(robotsAllows(txt, '/private/x')).toBe(false);
    expect(robotsAllows(txt, '/private/ok')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /', '/VI')).toBe(false);
  });
});

describe('billing webhook signature', () => {
  it('accepts a fresh valid signature and rejects tampering/replays', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'subscription.activated', data: { plan: 'plus' } });
    const t = 1_800_000_000;
    const h = `t=${t},v1=${sign('whsec', t, body)}`;
    expect(verifySignature('whsec', h, body, t + 10)).toBe(true);
    expect(verifySignature('whsec', h, body + ' ', t + 10)).toBe(false);
    expect(verifySignature('whsec', h, body, t + 1000)).toBe(false);
    expect(verifySignature('other', h, body, t)).toBe(false);
    expect(normalize(JSON.parse(body))?.plan).toBe('plus');
    expect(normalize({ id: 'e', type: 'x', data: { plan: 'founder' } })?.plan).toBeUndefined();
  });
});
