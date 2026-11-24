import type { Tx } from './db';
import { SCOUTS } from './domain/scouts';
import { PLAN_CATALOG } from './domain/plans';

/**
 * Reference data only. NO gameplay facts are invented here. The only findings
 * seeded are the official Rockstar items the founder supplied in the build kit,
 * and they are seeded as SINGLE REPORT (official source, not yet re-fetched by
 * this system) until the Rockstar watcher observes the page itself.
 */
export const FLAGS: { key: string; enabled: boolean; locked: boolean; description: string }[] = [
  { key: 'public_registration', enabled: false, locked: true, description: 'Open sign-up to the public. Locked: requires owner approval + legal/rights review (Phase 3).' },
  { key: 'closed_beta_invites', enabled: false, locked: true, description: 'Allow invite-only accounts (Phase 1, 5–20 testers).' },
  { key: 'billing_live', enabled: false, locked: true, description: 'Charge real money. Locked: billing is staging-only until approved.' },
  { key: 'billing_test_mode', enabled: false, locked: false, description: 'Allow provider test-mode webhooks to update subscriptions.' },
  { key: 'email_delivery', enabled: false, locked: false, description: 'Actually send the morning email (also needs REPORT_ENABLED=true + verified sender).' },
  { key: 'llm_assistant', enabled: false, locked: false, description: 'Use the Anthropic API for assistant answers (needs ANTHROPIC_API_KEY; budget-capped).' },
  { key: 'reddit_ingestion', enabled: false, locked: false, description: 'Use the Reddit Data API (needs approved credentials; commercial use needs an agreement).' },
  { key: 'official_watch', enabled: true, locked: false, description: 'Watch official Rockstar pages for changes (robots.txt respected, link-out only).' },
  { key: 'auto_publish_community', enabled: true, locked: false, description: 'Show scout finds immediately with honest evidence badges (single report / corroborated). Story spoilers of unknown chapter and low-confidence finds still wait in review.' },
  { key: 'llm_extraction', enabled: true, locked: false, description: 'Let Claude Haiku read posts and guide articles into scout cards (needs ANTHROPIC_API_KEY; capped by EXTRACT_DAILY_BUDGET_USD). Without it, cards are built from post titles only.' },
];

const ROCKSTAR_ARTICLE = 'https://www.rockstargames.com/newswire/article/39akk424a9oo53/grand-theft-auto-vi-now-available';

export async function seedReferenceData(c: Tx) {
  await c.query(`insert into workspaces(slug, name, kind) values ('platform','GameScout HQ Platform','platform') on conflict (slug) do nothing`);
  await c.query(`insert into games(id, name, adapter, max_chapter) values ('gta6','Grand Theft Auto VI','gta6',1)
                 on conflict (id) do nothing`);
  await c.query(`insert into game_versions(game_id, label, released_at, notes, source_url)
                 values ('gta6','launch','2026-11-19','Launch build per official announcement', $1)
                 on conflict (game_id, label) do nothing`, [ROCKSTAR_ARTICLE]);

  for (const s of SCOUTS) {
    await c.query(
      `insert into scout_categories(scout_id, name, short_name, description, icon, color, sort, finding_categories)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (scout_id) do update set name=excluded.name, short_name=excluded.short_name, description=excluded.description,
         icon=excluded.icon, color=excluded.color, sort=excluded.sort, finding_categories=excluded.finding_categories`,
      [s.id, s.name, s.shortName, s.description, s.icon, s.color, s.sort, s.categories]);
  }
  for (const f of FLAGS) {
    await c.query(`insert into feature_flags(key, enabled, locked, description) values ($1,$2,$3,$4)
                   on conflict (key) do update set description = excluded.description, locked = excluded.locked`,
      [f.key, f.enabled, f.locked, f.description]);
  }
  for (const [id, p] of Object.entries(PLAN_CATALOG)) {
    await c.query(`insert into plan_catalog(id, label, description, features, public) values ($1,$2,$3,$4,$5)
                   on conflict (id) do update set label=excluded.label, description=excluded.description, features=excluded.features, public=excluded.public`,
      [id, p.label, p.description, JSON.stringify(p.features), p.public]);
  }

  // Rights records
  const rights = async (label: string, status: string, uses: string[], notes: string) => {
    const r = await c.query(`select id from content_rights where label = $1`, [label]);
    if (r.rowCount) return r.rows[0].id as string;
    const ins = await c.query(`insert into content_rights(label, rights_status, allowed_uses, notes) values ($1,$2,$3,$4) returning id`,
      [label, status, uses, notes]);
    return ins.rows[0].id as string;
  };
  const officialRights = await rights('Rockstar official pages', 'link_out_only', ['private', 'closed_beta', 'commercial'],
    'Factual paraphrase + link-out only. No copying of art, screenshots, logos or full text. Fan-content policy is non-commercial; commercial reuse of protected material is NOT granted.');
  const mapRights = await rights('Official Leonida map download', 'personal_use', ['private'],
    'Personal download for your own reference. Redistribution/embedding in a commercial product NOT presumed.');
  const feedRights = await rights('Gaming news & guide feeds', 'link_out_only', ['private'],
    'Published feeds read for personal use: short paraphrased facts + link to the article. No copying of articles or images. Re-review before any commercial use.');
  const redditRights = await rights('Reddit content', 'unreviewed', [],
    'Reddit Data API terms apply. Commercial use requires a separate agreement with Reddit. Link-out only until approved.');

  const src = async (kind: string, name: string, url: string, method: string, enabled: boolean, status: string, rightsId: string, notes: string, terms?: string) => {
    await c.query(
      `insert into sources(game_id, kind, name, canonical_url, access_method, enabled, status, rights_id, access_notes, terms_url)
       values ('gta6',$1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (game_id, canonical_url) do update set name=excluded.name, access_notes=excluded.access_notes, rights_id=excluded.rights_id`,
      [kind, name, url, method, enabled, status, rightsId, notes, terms ?? null]);
  };
  await src('rockstar', 'Rockstar Newswire — GTA VI', 'https://www.rockstargames.com/newswire?tag=vi', 'html_change_watch', true, 'not_configured', officialRights,
    'Change watch only; robots.txt respected; link-out. Page is script-rendered, so article discovery may be partial.', 'https://www.rockstargames.com/legal');
  await src('rockstar', 'Rockstar — GTA VI official page', 'https://www.rockstargames.com/VI', 'html_change_watch', true, 'not_configured', officialRights,
    'Change watch only; link-out.', 'https://www.rockstargames.com/legal');
  await src('rockstar', 'Rockstar Support', 'https://support.rockstargames.com/', 'html_change_watch', true, 'not_configured', officialRights,
    'Change watch only; link-out.', 'https://www.rockstargames.com/legal');
  await src('rockstar', 'Rockstar GTA VI launch article (Nov 19, 2026)', ROCKSTAR_ARTICLE, 'html_change_watch', true, 'not_configured', officialRights,
    'Official launch announcement. Seed evidence for launch/map/expired promo items.', 'https://www.rockstargames.com/legal');
  await src('official_map', 'Official Leonida map (personal download)', 'https://www.rockstargames.com/VI#leonida-map', 'manual', false, 'needs_rights', mapRights,
    'Download it yourself and import privately in the Map Room. Not redistributed by this app.');
  const FEEDS: [string, string][] = [
    ['Rockstar Intel', 'https://www.rockstarintel.com/feed/'],
    ['PC Gamer', 'https://www.pcgamer.com/rss/'],
    ['Polygon', 'https://www.polygon.com/rss/index.xml'],
    ['GameSpot', 'https://www.gamespot.com/feeds/mashup/'],
    ['Game Rant', 'https://gamerant.com/feed/'],
    ['IGN', 'https://feeds.feedburner.com/ign/all'],
  ];
  for (const [name, url] of FEEDS) {
    await src('guide', `${name} (news & guides feed)`, url, 'rss', true, 'not_configured', feedRights,
      'Only GTA VI items are kept; practical guide articles are read (robots.txt respected) and paraphrased with a link back. Feed address not yet confirmed from a live server.');
  }
  for (const sub of ['GTA6', 'GTAVI', 'GrandTheftAutoVI', 'GTA6unmoderated', 'gtaglitches', 'grandtheftauto', 'rockstar']) {
    await src('reddit', `r/${sub}`, `https://www.reddit.com/r/${sub}/`, 'reddit_api', false, 'needs_credentials', redditRights,
      'Requires approved Reddit Data API credentials. Community existence/activity not yet verified by this system. Never scraped.',
      'https://redditinc.com/policies/data-api-terms');
  }

  await seedOfficialFindings(c);
}

async function upsertFinding(c: Tx, f: {
  dedupe_key: string; category: string; scope: 'GTA_VI' | 'GTA_ONLINE'; title: string; summary: string; why?: string;
  how?: string[]; spoiler: 'none' | 'mild' | 'story'; chapter_min: number | null; verification: string; lifecycle?: string;
  is_free: boolean | null; availability?: string; attributes?: object; scouts: string[];
  evidence: { url: string; title: string; paraphrase: string; published_at: string; type: string; origin: string }[];
}) {
  const r = await c.query(
    `insert into findings(game_id, game_scope, category, title, summary, why_it_matters, how_to, spoiler_level, chapter_min,
       verification, lifecycle, publication_status, is_free, availability, attributes, dedupe_key, published_at, first_seen_at, risk)
     values ('gta6',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published',$11,$12,$13,$14, $15, $15, 'low')
     on conflict (game_id, dedupe_key) do update set title=excluded.title, summary=excluded.summary, published_at=excluded.published_at, first_seen_at=excluded.first_seen_at
     returning id`,
    [f.scope, f.category, f.title, f.summary, f.why ?? null, f.how ?? [], f.spoiler, f.chapter_min, f.verification, f.lifecycle ?? 'stable',
     f.is_free, f.availability ?? null, JSON.stringify(f.attributes ?? {}), f.dedupe_key, f.evidence[0]?.published_at ?? null]);
  const id = r.rows[0].id as string;
  for (const s of f.scouts) await c.query('insert into scout_finding_links values ($1,$2) on conflict do nothing', [s, id]);
  const srcRow = await c.query(`select id from sources where canonical_url = $1`, [f.evidence[0]?.url]);
  for (const e of f.evidence) {
    await c.query(`insert into evidence(finding_id, source_id, url, title, published_at, paraphrase, evidence_type, independent_origin)
                   values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (finding_id, url) do nothing`,
      [id, srcRow.rows[0]?.id ?? null, e.url, e.title, e.published_at, e.paraphrase, e.type, e.origin]);
  }
  return id;
}

async function seedOfficialFindings(c: Tx) {
  const ev = (paraphrase: string) => ({
    url: ROCKSTAR_ARTICLE, title: 'Grand Theft Auto VI Now Available (Rockstar Newswire)', published_at: '2026-11-19T00:00:00Z',
    paraphrase, type: 'official', origin: 'rockstargames.com',
  });
  await upsertFinding(c, {
    dedupe_key: 'official-gta6-launch', category: 'update', scope: 'GTA_VI', spoiler: 'none', chapter_min: null,
    verification: 'single_report', is_free: null,
    title: 'GTA VI launch announcement',
    summary: 'Rockstar announced GTA VI is available as of November 19, 2026. This is a release fact, not a gameplay location or reward.',
    why: 'Baseline date for every patch and spawn report the scouts track.',
    scouts: ['rewards_scout'],
    attributes: { seed_note: 'Seeded from the founder build kit; HQ has not yet re-fetched this page itself.' },
    evidence: [ev('Official launch announcement dated Nov 19, 2026.')],
  });
  await upsertFinding(c, {
    dedupe_key: 'official-leonida-map', category: 'update', scope: 'GTA_VI', spoiler: 'none', chapter_min: null,
    verification: 'single_report', is_free: true,
    title: 'Official printable Leonida map available',
    summary: 'Rockstar links a downloadable Leonida map from its launch coverage. You may download it for personal reference; embedding or redistributing it is not presumed.',
    why: 'Import your own copy into the Map Room to place private pins.',
    how: ['Open the official source link', 'Download the map for personal use', 'Import it in Map Room → Import my map (stays private to your account)'],
    scouts: ['map_scout', 'rewards_scout'],
    attributes: { seed_note: 'Seeded from the founder build kit; HQ has not yet re-fetched this page itself.' },
    evidence: [ev('Launch coverage links to an official printable Leonida map.')],
  });
  const promo = await upsertFinding(c, {
    dedupe_key: 'official-vintage-vice-city-pack-promo', category: 'reward', scope: 'GTA_VI', spoiler: 'none', chapter_min: null,
    verification: 'single_report', lifecycle: 'stable', is_free: false, availability: 'expired',
    title: 'Vintage Vice City Pack + promotional GTA+ month (ended)',
    summary: 'A launch purchase benefit. Rockstar described November 19, 2026 as the last day to receive it with a qualifying purchase. It was never a general no-purchase free reward, and GTA+ is a subscription.',
    why: 'Kept for the record so nobody mistakes it for a current free claim.',
    scouts: ['rewards_scout'],
    attributes: { ended_on: '2026-11-19', end_time_of_day: 'not confirmed', seed_note: 'Seeded from the founder build kit.' },
    evidence: [ev('Launch article said Nov 19 was the last day to receive these with a qualifying purchase.')],
  });
  await c.query(
    `insert into rewards(finding_id, game_scope, cost_type, status, platforms, ends_at, claim_steps, source_url)
     values ($1,'GTA_VI','included_with_purchase','expired','{}', null, '{}', $2)
     on conflict (finding_id) do nothing`, [promo, ROCKSTAR_ARTICLE]);
}
